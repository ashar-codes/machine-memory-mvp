// Dynamic Machine Memory routes: asset and event creation, structured imports, knowledge
// ingestion, the copilot and fleet queries.
//
// Kept in its own module so app.ts keeps its original shape and the existing contract stays
// readable. Every external input is parsed with Zod; nothing here writes to disk or shells out.
import type { Router } from 'express';
import { createWorkGate, withLazyClient, type WorkGate } from './work.js';
import express from 'express';
import { z } from 'zod';
import type pg from 'pg';
import type { AssetEventSummary, ImportPreview, ImportReport, KnowledgeUploadReport } from '@machine-memory/shared';
import { runAssetCopilot, runFleetCopilot } from './copilot.js';
import { fleetSummary, recurringFaults } from './fleet.js';
import { recordEvent } from './events.js';
import { commitImport, ImportError, refreshAssetStatus } from './imports.js';
import { chunkText, deleteSource, getSource, ingestDocument, KnowledgeError, listSources } from './knowledge.js';
import type { LlmClient } from './llm.js';
import { proposeMapping, validateConfirmedMapping } from './mapping.js';
import type { Queryable } from './retrieval.js';
import {
  fieldsFor, MAX_IMPORT_ROWS, MAX_PREVIEW_ROWS, parseCsv, TabularError, toTable, type Table,
} from './tabular.js';
import { checkUpload, decodeText, uploader, UploadError } from './uploads.js';

export class RouteError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const assetCode = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const eventCode = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const label = z.string().trim().min(1).max(200);
const importType = z.enum(['EVENT_LOG', 'MAINTENANCE_HISTORY', 'WORK_ORDERS', 'TECHNICIAN_NOTES']);
const uuid = z.string().uuid();

const createAsset = z.strictObject({
  assetCode, siteName: label, assetType: label.default('wind_turbine'),
  manufacturer: label.optional(), model: label.optional(), serialNumber: label.optional(),
  ratedPowerKw: z.number().int().min(0).max(100_000).optional(),
  commissionedOn: z.string().trim().date().optional(),
  description: z.string().trim().max(2000).optional(),
});
const createEvent = z.strictObject({
  assetCode, eventCode, title: z.string().trim().min(1).max(500),
  subsystem: label.optional(), severity: z.enum(['critical', 'warning', 'info']),
  occurredAt: z.string().trim().datetime({ offset: true }),
  description: z.string().trim().max(4000).optional(),
  simulation: z.boolean(),
});
const commitBody = z.strictObject({
  dataSourceId: uuid, importType,
  mapping: z.record(z.string().min(1).max(200), z.string().min(1).max(80)),
  simulation: z.boolean().default(false),
});
const copilotBody = z.strictObject({
  scope: z.enum(['asset', 'fleet']),
  assetCode: assetCode.optional(),
  eventCode: eventCode.optional(),
  question: z.string().trim().min(1).max(2000),
  history: z.array(z.strictObject({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(4000) })).max(20).optional(),
});
const knowledgeMeta = z.strictObject({
  title: z.string().trim().min(1).max(400),
  organization: z.string().trim().min(1).max(400),
  sourceType: z.enum(['TECHNICAL_REFERENCE', 'SAFETY_REFERENCE', 'TECHNICIAN_NOTE']).default('TECHNICAL_REFERENCE'),
  assetType: label.optional(), manufacturer: label.optional(), model: label.optional(),
});
const integerQuery = z.string().regex(/^[0-9]+$/).transform(Number).pipe(z.number().int());
const page = z.strictObject({
  limit: integerQuery.pipe(z.number().min(1).max(100)).default(25),
  offset: integerQuery.pipe(z.number().min(0).max(10000)).default(0),
});

export interface RouteDeps {
  work?: WorkGate;
  pool?: pg.Pool;
  llm?: LlmClient | null;
  embeddingModel: string;
  embeddingDimensions: number;
  queryable: (client: pg.Pool | pg.PoolClient) => Queryable;
  /** Parsed uploads, held only for the life of a preview→commit pair. */
  previews: Map<string, { table: Table; importType: string; filename: string; expiresAt: number }>;
}

const PREVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_PREVIEWS = 25;

/** Extracts text from a PDF. Loaded lazily so the dependency never runs at server startup. */
export async function extractPdfText(bytes: Buffer): Promise<string> {
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: bytes });
    try {
      const result = await parser.getText();
      // Page text excludes the library's synthetic page-number separators.
      const text = result.pages.map((page) => page.text).join('\n\n').trim();
      if (!text) throw new RouteError(400, 'PDF_NO_TEXT', 'The PDF contains no extractable text. Scanned PDFs require OCR, which is not supported. Upload a text PDF or .txt file.');
      return text;
    } finally { await parser.destroy(); }
  } catch (error) {
    if (error instanceof RouteError) throw error;
    throw new RouteError(400, 'PDF_UNREADABLE', 'The PDF could not be read as text. It may be a scanned image; upload a text PDF or a .txt file.');
  }
}

export function createDynamicRoutes(deps: RouteDeps): Router {
  const router = express.Router();
  const work = deps.work ?? createWorkGate();
  const db = () => {
    if (!deps.pool) throw new RouteError(503, 'DATABASE_NOT_CONFIGURED', 'Configure DATABASE_URL and apply the schema.');
    return deps.pool;
  };
  const q = () => deps.queryable(db());

  const rememberPreview = (id: string, entry: { table: Table; importType: string; filename: string }) => {
    const now = Date.now();
    for (const [key, value] of deps.previews) if (value.expiresAt < now) deps.previews.delete(key);
    // Bounded: an abandoned preview must not pin parsed file content in memory indefinitely.
    while (deps.previews.size >= MAX_PREVIEWS) deps.previews.delete(deps.previews.keys().next().value as string);
    deps.previews.set(id, { ...entry, expiresAt: now + PREVIEW_TTL_MS });
  };

  router.post('/api/assets', express.json({ limit: '32kb', strict: true }), async (req, res) => {
    const input = createAsset.parse(req.body);
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      // sites.name has no unique constraint, so an upsert cannot be expressed as ON CONFLICT here.
      // Look first, insert only when genuinely absent, or a second turbine on the same farm would
      // silently create a duplicate site and split the fleet in two.
      const existingSite = await client.query('select id from public.sites where lower(name) = lower($1) order by created_at limit 1', [input.siteName]);
      const siteId = existingSite.rows[0]?.id ?? (await client.query(
        `insert into public.sites (name, timezone, metadata, record_origin)
         values ($1,'UTC','{"createdVia":"data_hub"}'::jsonb,'user_import') returning id`, [input.siteName])).rows[0]?.id;
      if (!siteId) throw new RouteError(500, 'SITE_UNAVAILABLE', 'The site could not be created.');
      const existing = await client.query('select 1 from public.assets where asset_code = $1', [input.assetCode]);
      if (existing.rowCount) throw new RouteError(409, 'ASSET_EXISTS', 'An asset with that code already exists.');
      const metadata = {
        ratedPowerKw: input.ratedPowerKw ?? null, commissionedOn: input.commissionedOn ?? null,
        description: input.description ?? null, createdVia: 'data_hub',
      };
      const created = await client.query(
        `insert into public.assets (site_id, asset_code, asset_type, manufacturer, model, serial_number, status, metadata, record_origin)
         values ($1,$2,$3,$4,$5,$6,'operational',$7::jsonb,'user_import')
         returning id, site_id, asset_code, asset_type, manufacturer, model, serial_number, status, metadata, record_origin, created_at`,
        [siteId, input.assetCode, input.assetType, input.manufacturer ?? null, input.model ?? null, input.serialNumber ?? null, JSON.stringify(metadata)]);
      await client.query('COMMIT');
      res.status(201).json({ asset: camel(created.rows[0]) });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  });

  router.post('/api/events', express.json({ limit: '32kb', strict: true }), async (req, res) => {
    const input = createEvent.parse(req.body);
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      // Uses the same event path as the operational-event boundary; CSV has a separate batch path.
      const outcome = await recordEvent(deps.queryable(client), {
        assetCode: input.assetCode, eventCode: input.eventCode, title: input.title,
        subsystem: input.subsystem ?? null, severity: input.severity, occurredAt: input.occurredAt,
        description: input.description ?? null,
        // Simulation provenance is stored on the row itself, so a fabricated fault can never be
        // displayed, cited or exported as if it were real telemetry.
        recordOrigin: input.simulation ? 'simulation' : 'user_demo',
      });
      if (outcome.status === 'asset_not_found') throw new RouteError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
      await client.query('COMMIT');
      res.status(201).json({ event: camel(outcome.event) });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  });

  router.post('/api/import/preview', work.handle(async (req, res) => {
    await new Promise<void>((resolve, reject) => uploader.single('file')(req, res, (error) => error ? reject(error) : resolve()));
    const type = importType.parse(req.body?.importType);
    const upload = checkUpload(req.file, 'tabular');
    const content = decodeText(upload.bytes);
    const matrix = parseCsv(content, MAX_IMPORT_ROWS);
    const table = toTable(matrix);
    if (!table.rows.length) throw new RouteError(400, 'EMPTY_FILE', 'The file has a header but no data rows.');

    const source = await q().query(
      `insert into public.data_sources (name, source_type, original_filename, content_sha256, byte_size, record_origin, status, metadata)
       values ($1,$2,$3,$4,$5,'user_import','received',$6::jsonb) returning id`,
      [upload.filename, type, upload.filename, upload.sha256, upload.bytes.length,
        JSON.stringify({ columns: table.columns, rowCount: table.rows.length })]);
    const dataSourceId = source.rows[0].id as string;
    rememberPreview(dataSourceId, { table, importType: type, filename: upload.filename });

    const proposal = await proposeMapping(table.columns, table.rows, type, deps.llm ?? null);
    const confirmed: Record<string, string> = {};
    for (const entry of proposal.mapping) if (entry.field) confirmed[entry.column] = entry.field;
    const unmappedRequired = fieldsFor(type).filter((field) => field.required && !Object.values(confirmed).includes(field.field)).map((field) => field.field);

    const preview: ImportPreview = {
      dataSourceId, importType: type, originalFilename: upload.filename,
      columns: table.columns,
      sampleRows: table.rows.slice(0, MAX_PREVIEW_ROWS),
      totalRows: table.rows.length,
      truncated: table.rows.length >= MAX_IMPORT_ROWS,
      mapping: proposal.mapping, targetFields: fieldsFor(type),
      unmappedRequired, mappingSource: proposal.source, notes: proposal.notes,
    };
    res.json(preview);
  }));

  router.post('/api/import/commit', express.json({ limit: '64kb', strict: true }), async (req, res) => {
    const input = commitBody.parse(req.body);
    const held = deps.previews.get(input.dataSourceId);
    if (!held || held.expiresAt < Date.now()) {
      deps.previews.delete(input.dataSourceId);
      const source = await q().query('select status from public.data_sources where id=$1', [input.dataSourceId]);
      if (source.rows[0]?.status === 'imported') throw new RouteError(409, 'IMPORT_ALREADY_COMMITTED', 'This preview was already committed; its records were not imported again.');
      throw new RouteError(410, 'PREVIEW_EXPIRED', 'The uploaded file is no longer held for import. Upload it again.');
    }
    if (held.importType !== input.importType) throw new RouteError(400, 'IMPORT_TYPE_MISMATCH', 'The import type does not match the uploaded file.');
    const validated = validateConfirmedMapping(input.mapping, held.table.columns, input.importType);
    if (!validated.ok) throw new RouteError(400, 'INVALID_MAPPING', validated.reason);

    const recordOrigin = input.simulation ? 'simulation' : 'user_import';
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      // Atomic row claim: competing processes wait on this UPDATE and recheck its predicate
      // after the winner commits. A failed import rolls the claim back with its rows.
      const claim = await client.query(`update public.data_sources set status='imported'
        where id=$1 and source_type=$2 and record_origin='user_import' and status in ('received','mapped')
        returning id`, [input.dataSourceId, input.importType]);
      if (!claim.rowCount) throw new RouteError(409, 'IMPORT_ALREADY_COMMITTED', 'This preview is already committed or unavailable; its records were not imported again.');
      const batch = await client.query(
        `insert into public.import_batches (data_source_id, import_type, mapping_json, status)
         values ($1,$2,$3::jsonb,'pending') returning id`,
        [input.dataSourceId, input.importType, JSON.stringify(input.mapping)]);
      const batchId = batch.rows[0].id as string;
      const result = await commitImport(deps.queryable(client), {
        table: held.table, mapping: validated.mapping, importType: input.importType, batchId, recordOrigin,
      });
      await refreshAssetStatus(deps.queryable(client), result.assetsTouched);
      await client.query(
        `update public.import_batches set rows_received=$2, rows_imported=$3, rows_rejected=$4,
           rejection_sample=$5::jsonb, status='committed' where id=$1`,
        [batchId, result.rowsReceived, result.rowsImported, result.rowsRejected, JSON.stringify(result.rejections)]);
      await client.query('COMMIT');
      deps.previews.delete(input.dataSourceId);
      const report: ImportReport = {
        batchId, importType: input.importType, rowsReceived: result.rowsReceived,
        rowsImported: result.rowsImported, rowsRejected: result.rowsRejected,
        rejections: result.rejections, recordOrigin, assetsTouched: result.assetsTouched,
      };
      res.status(201).json(report);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  });

  router.post('/api/knowledge/upload', work.handle(async (req, res) => {
    await new Promise<void>((resolve, reject) => uploader.single('file')(req, res, (error) => error ? reject(error) : resolve()));
    const meta = knowledgeMeta.parse({
      title: req.body?.title, organization: req.body?.organization,
      sourceType: req.body?.sourceType || undefined,
      assetType: req.body?.assetType || undefined,
      manufacturer: req.body?.manufacturer || undefined,
      model: req.body?.model || undefined,
    });
    const upload = checkUpload(req.file, 'document');
    const text = upload.extension === '.pdf' ? await extractPdfText(upload.bytes) : decodeText(upload.bytes);
    const chunks = chunkText(text);

    const source = await q().query(
      `insert into public.data_sources (name, source_type, original_filename, content_sha256, byte_size, record_origin, status, metadata)
       values ($1,$2,$3,$4,$5,'user_import','received',$6::jsonb) returning id`,
      [meta.title, meta.sourceType === 'SAFETY_REFERENCE' ? 'SAFETY_PROCEDURE' : 'TECHNICAL_DOCUMENT',
        upload.filename, upload.sha256, upload.bytes.length, JSON.stringify({ chunks: chunks.length })]);
    const dataSourceId = source.rows[0].id as string;

    const result = await withLazyClient(db(), (indexDb) => ingestDocument(indexDb, deps.llm ?? null, chunks, {
      title: meta.title, organization: meta.organization, sourceType: meta.sourceType,
      assetType: meta.assetType ?? 'wind_turbine', manufacturer: meta.manufacturer ?? null, model: meta.model ?? null,
      dataSourceId, originalFilename: upload.filename, contentSha256: upload.sha256,
      embeddingModel: deps.embeddingModel, embeddingDimensions: deps.embeddingDimensions,
    }));

    await q().query(`update public.data_sources set status=$2 where id=$1`,
      [dataSourceId, result.chunksEmbedded === result.chunksCreated ? 'indexed' : 'imported']);
    const detail = await getSource(q(), result.documentId);
    if (!detail) throw new RouteError(500, 'INDEX_UNAVAILABLE', 'The document was stored but could not be read back.');
    const report: KnowledgeUploadReport = {
      source: detail.source, chunksCreated: result.chunksCreated, chunksEmbedded: result.chunksEmbedded,
      message: result.chunksEmbedded === result.chunksCreated
        ? 'Knowledge indexed successfully. It is searchable now.'
        : `Stored ${result.chunksCreated} passages; ${result.chunksEmbedded} were embedded. Unembedded passages remain keyword searchable.`,
    };
    res.status(201).json(report);
  }));

  router.get('/api/knowledge', async (req, res) => {
    const { limit, offset } = page.parse(req.query);
    const { items, hasMore } = await listSources(q(), limit, offset);
    res.json({ items, limit, offset, hasMore });
  });

  router.get('/api/knowledge/:id', async (req, res) => {
    const detail = await getSource(q(), uuid.parse(req.params.id));
    if (!detail) throw new RouteError(404, 'SOURCE_NOT_FOUND', 'Knowledge source not found.');
    res.json(detail);
  });

  router.delete('/api/knowledge/:id', async (req, res) => {
    const outcome = await deleteSource(q(), uuid.parse(req.params.id));
    if (outcome === 'not_found') throw new RouteError(404, 'SOURCE_NOT_FOUND', 'Knowledge source not found.');
    if (outcome === 'protected') throw new RouteError(403, 'SOURCE_PROTECTED', 'Reviewed public and foundation sources cannot be deleted from the interface.');
    res.json({ status: 'deleted' });
  });

  /**
   * Database-backed facts about an asset's recorded events. Used to describe imported public
   * operational data honestly: every number is a count over rows that were actually imported,
   * and `hasMaintenanceRecords` says plainly whether any resolution data exists at all.
   */
  router.get('/api/assets/:assetCode/event-summary', async (req, res) => {
    const code = assetCode.parse(req.params.assetCode);
    const asset = await q().query('select id, asset_code, record_origin from public.assets where asset_code = $1', [code]);
    if (!asset.rows[0]) throw new RouteError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
    const assetId = asset.rows[0].id as string;

    const totals = await q().query(
      `select count(*)::int total, count(distinct event_code)::int codes,
              min(occurred_at) first_at, max(occurred_at) last_at,
              max(event_source) source, max(source_metadata->>'sourceTurbine') source_turbine
         from public.asset_events where asset_id = $1`, [assetId]);
    const top = await q().query(
      `select event_code, max(source_metadata->>'sourceMessage') message, count(*)::int occurrences
         from public.asset_events where asset_id = $1
        group by event_code order by count(*) desc, event_code limit 8`, [assetId]);
    const recent = await q().query(
      `select id, occurred_at, cleared_at, event_code, title, severity, record_origin,
              source_metadata->>'sourceCode' source_code,
              source_metadata->>'sourceStatus' source_status,
              source_metadata->>'durationText' duration,
              source_metadata->>'iecCategory' iec_category
         from public.asset_events where asset_id = $1
        order by occurred_at desc, id desc limit 25`, [assetId]);
    const maintenance = await q().query(
      `select (select count(*)::int from public.resolutions where asset_id = $1)
            + (select count(*)::int from public.work_orders where asset_id = $1)
            + (select count(*)::int from public.maintenance_events where asset_id = $1) as n`, [assetId]);

    const row = totals.rows[0];
    const summary: AssetEventSummary = {
      assetCode: String(asset.rows[0].asset_code),
      recordOrigin: asset.rows[0].record_origin as AssetEventSummary['recordOrigin'],
      source: (row.source as string | null) ?? null,
      sourceTurbine: (row.source_turbine as string | null) ?? null,
      totalEvents: Number(row.total), distinctEventCodes: Number(row.codes),
      firstEventAt: row.first_at ? new Date(row.first_at as string).toISOString() : null,
      lastEventAt: row.last_at ? new Date(row.last_at as string).toISOString() : null,
      topEventCodes: top.rows.map((item) => ({
        eventCode: String(item.event_code),
        message: (item.message as string | null) ?? null,
        occurrences: Number(item.occurrences),
      })),
      hasMaintenanceRecords: Number(maintenance.rows[0].n) > 0,
      recentEvents: recent.rows.map((item) => ({
        id: String(item.id),
        occurredAt: new Date(item.occurred_at as string).toISOString(),
        clearedAt: item.cleared_at ? new Date(item.cleared_at as string).toISOString() : null,
        eventCode: String(item.event_code),
        sourceCode: (item.source_code as string | null) ?? null,
        title: String(item.title), severity: String(item.severity),
        sourceStatus: (item.source_status as string | null) ?? null,
        duration: (item.duration as string | null) ?? null,
        iecCategory: (item.iec_category as string | null) ?? null,
        recordOrigin: item.record_origin as AssetEventSummary['recordOrigin'],
      })),
    };
    res.json(summary);
  });

  router.get('/api/fleet/summary', async (_req, res) => { res.json(await fleetSummary(q())); });

  router.get('/api/fleet/recurring-faults', async (req, res) => {
    const query = z.strictObject({
      minimumOccurrences: integerQuery.pipe(z.number().min(2).max(100)).optional(),
      days: integerQuery.pipe(z.number().min(1).max(3650)).optional(),
    }).parse(req.query);
    res.json({ items: await recurringFaults(q(), query) });
  });

  return router;
}

export function camel(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), value]));
}

export { copilotBody, runAssetCopilot, runFleetCopilot, ImportError, KnowledgeError, TabularError, UploadError };
