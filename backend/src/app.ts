import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type pg from 'pg';
import type { HealthResponse, InvestigateRequest, ResolutionResponse } from '@machine-memory/shared';
import { DEFAULT_EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from './config.js';
import { investigate } from './investigate.js';
import type { LlmClient } from './llm.js';
import { indexResolution } from './memoryIndex.js';
import { safetyAnswer } from './rag.js';
import type { Queryable } from './retrieval.js';
import { runAssetCopilot, runFleetCopilot } from './copilot.js';
import { createDynamicRoutes, copilotBody, RouteError } from './routes.js';
import type { GenerationProvider } from './provider.js';
import { ImportError } from './imports.js';
import { KnowledgeError } from './knowledge.js';
import { TabularError } from './tabular.js';
import { UploadError } from './uploads.js';
import type { Table } from './tabular.js';

const code = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const eventCode = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const integerQuery = z.string().regex(/^[0-9]+$/).transform(Number).pipe(z.number().int());
const page = z.strictObject({ limit: integerQuery.pipe(z.number().min(1).max(100)).default(25), offset: integerQuery.pipe(z.number().min(0).max(10000)).default(0) });
const empty = z.strictObject({});
const investigation = z.strictObject({ assetCode: code, eventCode: eventCode.optional(), intent: z.enum(['HISTORY','PREVIOUS_RESOLUTION','SIMILAR_INCIDENTS','RECENT_CHANGES','TECHNICAL_GUIDANCE','GENERAL','SAFETY']), question: z.string().trim().min(1).max(2000) });
const resolution = z.strictObject({ assetCode: code, eventCode, rootCause: z.string().trim().min(1).max(4000), resolutionSummary: z.string().trim().min(1).max(4000), component: z.string().trim().min(1).max(200), downtimeMinutes: z.number().int().min(0).max(525600), notes: z.string().trim().max(4000), validated: z.boolean() });
class ApiError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
function camelRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key,value]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), value]));
}
const assetFields = 'id, site_id, asset_code, asset_type, manufacturer, model, serial_number, status, metadata, record_origin, created_at';
const eventFields = 'id, asset_id, event_code, title, subsystem, severity, occurred_at, cleared_at, description, record_origin';
const incidentFields = 'id, asset_id, event_code, symptoms, root_cause, resolution_summary, opened_at, closed_at, record_origin';

export interface AppOptions {
  pool?: pg.Pool;
  llmConfigured?: boolean;
  /** Injected so tests and offline runs exercise the whole pipeline without network access. */
  llm?: LlmClient | null;
  embeddingModel?: string;
}

export function createApp({ pool, llmConfigured = false, llm = null, embeddingModel = DEFAULT_EMBEDDING_MODEL }: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((_req,res,next) => { res.locals.requestId = randomUUID(); res.set('X-Request-ID', res.locals.requestId as string); next(); });
  app.use(helmet());
  app.use((req,_res,next) => {
    const host = req.hostname;
    if (!['localhost','127.0.0.1','[::1]','::1'].includes(host)) return next(new ApiError(403,'LOCAL_ONLY','This unauthenticated foundation accepts loopback hosts only.'));
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        if (origin.protocol !== 'http:' || !['localhost','127.0.0.1','[::1]'].includes(origin.hostname) || !['5173','3001'].includes(origin.port)) throw new Error();
      } catch { return next(new ApiError(403,'ORIGIN_REJECTED','Origin is not permitted.')); }
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') return next(new ApiError(403,'ORIGIN_REJECTED','Cross-site access is not permitted.'));
    next();
  });
  app.post('/api/admin/ingest', (_req,_res,next) => next(new ApiError(404,'INGEST_DISABLED','HTTP ingestion is disabled. Use the trusted CLI workflow.')));
  app.use(['/api/investigate','/api/resolutions','/api/copilot','/api/assets','/api/events','/api/import/commit'], (req,_res,next) => {
    if (req.method === 'POST' && !req.is('application/json')) return next(new ApiError(415,'UNSUPPORTED_MEDIA_TYPE','POST requests must use application/json.'));
    next();
  });
  // Upload routes parse their own multipart bodies; the JSON parser must not consume them.
  app.use((req,res,next) => req.path.startsWith('/api/import/preview') || req.path.startsWith('/api/knowledge/upload')
    ? next() : express.json({ limit: '32kb', strict: true })(req,res,next));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false, handler: (_req,_res,next) => next(new ApiError(429,'RATE_LIMITED','Too many requests.')) }));
  const aiLimit = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, handler: (_req,_res,next) => next(new ApiError(429,'RATE_LIMITED','Too many investigation requests.')) });
  const db = () => { if (!pool) throw new ApiError(503,'DATABASE_NOT_CONFIGURED','Configure DATABASE_URL and apply the schema and seed.'); return pool; };
  // Narrow adapter so retrieval code depends on a query surface, not on the pg client type.
  const queryable = (client: pg.Pool | pg.PoolClient): Queryable => ({
    query: async (text, values) => client.query(text, values ?? []),
  });
  // Parsed uploads are held between preview and commit only, bounded and TTL-expired in routes.ts.
  const previews = new Map<string, { table: Table; importType: string; filename: string; expiresAt: number }>();
  const dynamicRoutes = createDynamicRoutes({ pool, llm, embeddingModel, embeddingDimensions: EMBEDDING_DIMENSIONS, queryable, previews });
  async function findAsset(assetCode: string) {
    const result = await db().query(`SELECT ${assetFields} FROM public.assets WHERE asset_code=$1`, [assetCode]);
    if (!result.rows[0]) throw new ApiError(404,'ASSET_NOT_FOUND','Asset not found.');
    return result.rows[0] as Record<string, unknown> & {id:string};
  }
  app.get('/api/health', async (req,res) => {
    empty.parse(req.query);
    let database: HealthResponse['database'] = 'not_configured';
    if (pool) { try { await pool.query('SELECT 1'); database = 'connected'; } catch { database = 'unavailable'; } }
    const response: HealthResponse = { status: database === 'connected' ? 'ok' : 'degraded', service: 'machine-memory', database, llm: llmConfigured ? 'configured_unverified' : 'not_configured', phase: 'mvp' };
    res.json(response);
  });
  app.get('/api/assets', async (req,res) => {
    const {limit,offset} = page.parse(req.query);
    const result = await db().query(`SELECT ${assetFields} FROM public.assets ORDER BY asset_code,id LIMIT $1 OFFSET $2`, [limit+1,offset]);
    res.json({ items: result.rows.slice(0,limit).map(camelRow), limit,offset,hasMore:result.rows.length>limit });
  });
  app.get('/api/assets/:assetCode', async (req,res) => {
    empty.parse(req.query);
    res.json({ asset: camelRow(await findAsset(code.parse(req.params.assetCode))) });
  });
  app.get('/api/assets/:assetCode/current-event', async (req,res) => {
    empty.parse(req.query);
    const asset = await findAsset(code.parse(req.params.assetCode));
    const result = await db().query(`SELECT ${eventFields} FROM public.asset_events WHERE asset_id=$1 AND cleared_at IS NULL ORDER BY occurred_at DESC,id DESC LIMIT 1`, [asset.id]);
    res.json({ event: result.rows[0] ? camelRow(result.rows[0]) : null });
  });
  app.get('/api/assets/:assetCode/incidents', async (req,res) => {
    const {limit,offset} = page.parse(req.query);
    const asset = await findAsset(code.parse(req.params.assetCode));
    const result = await db().query(`SELECT ${incidentFields} FROM public.incidents WHERE asset_id=$1 ORDER BY opened_at DESC,id DESC LIMIT $2 OFFSET $3`,[asset.id,limit+1,offset]);
    res.json({ items:result.rows.slice(0,limit).map(camelRow),limit,offset,hasMore:result.rows.length>limit });
  });
  app.get('/api/assets/:assetCode/timeline', async (req,res) => {
    const {limit,offset} = page.parse(req.query);
    const asset = await findAsset(code.parse(req.params.assetCode));
    const result = await db().query(`SELECT * FROM (
      SELECT id,'EVENT' AS kind,title,COALESCE(description,'') AS description,occurred_at AS timestamp,record_origin FROM public.asset_events WHERE asset_id=$1
      UNION ALL SELECT id,'MAINTENANCE',event_type,description,occurred_at,record_origin FROM public.maintenance_events WHERE asset_id=$1
      UNION ALL SELECT id,'NOTE','Technician note',content,created_at,record_origin FROM public.technician_notes WHERE asset_id=$1
      UNION ALL SELECT id,'RESOLUTION','Resolution: ' || event_code,resolution_summary,created_at,record_origin FROM public.resolutions WHERE asset_id=$1
    ) t ORDER BY timestamp DESC,kind,id DESC LIMIT $2 OFFSET $3`, [asset.id,limit+1,offset]);
    res.json({items:result.rows.slice(0,limit).map(camelRow),limit,offset,hasMore:result.rows.length>limit});
  });
  app.post('/api/investigate', aiLimit, async (req,res) => {
    empty.parse(req.query);
    const input = investigation.parse(req.body) as InvestigateRequest;
    // Without a database the only honest answers are the deterministic safety ones.
    if (!pool) {
      const safe = safetyAnswer(input);
      if (safe) { res.json(safe); return; }
      throw new ApiError(503,'DATABASE_NOT_CONFIGURED','Configure DATABASE_URL and apply the schema and seed.');
    }
    const outcome = await investigate(input, {
      db: queryable(pool), llm,
      onDegraded: (stage) => console.warn(`Investigation degraded at stage: ${stage}.`),
    });
    if (outcome.status === 'asset_not_found') throw new ApiError(404,'ASSET_NOT_FOUND','Asset not found.');
    res.json(outcome.response);
  });
  app.post('/api/resolutions', async (req,res) => {
    empty.parse(req.query);
    const input = resolution.parse(req.body);
    const client = await db().connect();
    let saved: { id: string; assetId: string; assetType: string; manufacturer: string | null; model: string | null } | null = null;
    try {
      await client.query('BEGIN');
      const assetResult = await client.query('SELECT id, asset_type, manufacturer, model FROM public.assets WHERE asset_code=$1 FOR KEY SHARE',[input.assetCode]);
      if (!assetResult.rows[0]) throw new ApiError(404,'ASSET_NOT_FOUND','Asset not found.');
      const assetId: string = assetResult.rows[0].id;
      const result = await client.query(`INSERT INTO public.resolutions (asset_id,event_code,root_cause,resolution_summary,component,downtime_minutes,notes,validated,record_origin) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'user_demo') RETURNING id,created_at`,[assetId,input.eventCode,input.rootCause,input.resolutionSummary,input.component,input.downtimeMinutes,input.notes,input.validated]);
      // validated records only the user's assertion; it never elevates authority.
      await client.query('COMMIT');
      saved = { id: result.rows[0].id, assetId, assetType: assetResult.rows[0].asset_type, manufacturer: assetResult.rows[0].manufacturer, model: assetResult.rows[0].model };
      const response: ResolutionResponse = { resolution:{...input,id:result.rows[0].id,assetId,recordOrigin:'user_demo',createdAt:result.rows[0].created_at.toISOString()},timelineRefresh:{assetCode:input.assetCode,url:`/api/assets/${encodeURIComponent(input.assetCode)}/timeline`},memoryStatus:'STRUCTURED_SAVED_SEMANTIC_PENDING' };
      res.status(201).json(response);
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
    // Structured memory is already committed and already retrievable. Semantic indexing is a
    // best-effort follow-up: it runs after the response and can never undo the saved record.
    if (saved && llm && pool) {
      const record = saved;
      const indexPool = pool;
      // Indexing runs in its own transaction, so it needs a dedicated client: BEGIN and COMMIT
      // issued through a pool can land on different connections.
      void (async () => {
        const client = await indexPool.connect();
        try {
          const indexed = await indexResolution(queryable(client), llm, {
            resolutionId: record.id, assetId: record.assetId, assetCode: input.assetCode,
            eventCode: input.eventCode, rootCause: input.rootCause, resolutionSummary: input.resolutionSummary,
            component: input.component, notes: input.notes, assetType: record.assetType,
            manufacturer: record.manufacturer, model: record.model,
            embeddingModel, embeddingDimensions: EMBEDDING_DIMENSIONS,
          });
          if (!indexed) console.warn('Resolution saved; semantic indexing skipped. Structured retrieval is unaffected.');
        } catch {
          console.warn('Resolution saved; semantic indexing failed. Structured retrieval is unaffected.');
        } finally {
          client.release();
        }
      })();
    }
  });
  app.post('/api/copilot', aiLimit, express.json({ limit: '64kb', strict: true }), async (req,res) => {
    empty.parse(req.query);
    const input = copilotBody.parse(req.body);
    if (!pool) {
      // Without a database the only honest answers are the deterministic safety ones.
      const safe = input.scope === 'asset' && input.assetCode
        ? safetyAnswer({ assetCode: input.assetCode, intent: 'GENERAL', question: input.question })
        : null;
      if (safe) { res.json({ ...safe, scope: input.scope, assetCode: input.assetCode ?? null, plan: null, structuredFacts: {} }); return; }
      throw new ApiError(503,'DATABASE_NOT_CONFIGURED','Configure DATABASE_URL and apply the schema and seed.');
    }
    const deps = {
      db: queryable(pool), llm,
      onDegraded: (stage: 'embedding'|'synthesis'|'validation') => console.warn(`Copilot degraded at stage: ${stage}.`),
      onGeneration: (provider: GenerationProvider) => { if (provider !== 'gemini') console.warn(`Copilot answered via ${provider}.`); },
    };
    if (input.scope === 'fleet') { res.json(await runFleetCopilot(input.question, deps)); return; }
    if (!input.assetCode) throw new ApiError(400,'VALIDATION_ERROR','An asset must be selected for asset-scope questions.');
    const outcome = await runAssetCopilot({ assetCode: input.assetCode, eventCode: input.eventCode, question: input.question, history: input.history }, deps);
    if ('status' in outcome) throw new ApiError(404,'ASSET_NOT_FOUND','Asset not found.');
    res.json(outcome);
  });
  app.get('/api/assets/:assetCode/memory-status', async (req,res) => {
    empty.parse(req.query);
    const asset = await findAsset(code.parse(req.params.assetCode));
    // Drives the empty-state prompt for a newly onboarded turbine.
    const counts = await db().query(`select
      (select count(*)::int from public.asset_events where asset_id=$1) as events,
      (select count(*)::int from public.maintenance_events where asset_id=$1) as maintenance,
      (select count(*)::int from public.work_orders where asset_id=$1) as work_orders,
      (select count(*)::int from public.technician_notes where asset_id=$1) as notes,
      (select count(*)::int from public.resolutions where asset_id=$1) as resolutions`, [asset.id]);
    const row = counts.rows[0];
    const total = Number(row.events)+Number(row.maintenance)+Number(row.work_orders)+Number(row.notes)+Number(row.resolutions);
    res.json({ assetCode: asset.asset_code, empty: total === 0, counts: camelRow(row) });
  });
  app.use(dynamicRoutes);
  app.use((_req,_res,next) => next(new ApiError(404,'NOT_FOUND','Route not found.')));
  const errorHandler: ErrorRequestHandler = (error,_req,res,_next) => {
    let status = 500, code = 'INTERNAL_ERROR', message = 'The request could not be completed.';
    if (error instanceof z.ZodError) { status=400;code='VALIDATION_ERROR';message='Request fields are invalid or unsupported.'; }
    else if (error instanceof ApiError || error instanceof RouteError) { status=error.status;code=error.code;message=error.message; }
    // These carry a rule description, never uploaded file contents, so they are safe to return.
    else if (error instanceof UploadError) { status=400;code='UPLOAD_REJECTED';message=error.message; }
    else if (error instanceof TabularError) { status=400;code='FILE_UNREADABLE';message=error.message; }
    else if (error instanceof ImportError) { status=400;code='IMPORT_FAILED';message=error.message; }
    else if (error instanceof KnowledgeError) { status=400;code='DOCUMENT_UNREADABLE';message=error.message; }
    else if (error?.code === 'LIMIT_FILE_SIZE') { status=413;code='PAYLOAD_TOO_LARGE';message='The uploaded file exceeds the size limit.'; }
    else if (error?.type === 'entity.too.large') { status=413;code='PAYLOAD_TOO_LARGE';message='Request body exceeds 32 KB.'; }
    else if (error?.type === 'entity.parse.failed') { status=400;code='INVALID_JSON';message='Invalid JSON body.'; }
    else if (['ECONNREFUSED','ENOTFOUND','ETIMEDOUT','ECONNRESET','57P01','08006'].includes(error?.code)) { status=503;code='DATABASE_UNAVAILABLE';message='Database is unavailable.'; }
    res.status(status).json({error:{code,message,requestId:res.locals.requestId}});
  };
  app.use(errorHandler);
  return app;
}
