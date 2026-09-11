// Imports genuine Penmanshiel public data.
//
// Two stages, both optional and both idempotent:
//   default        turbine identity and siting from the verified static file
//   --events       real status/event history from the official Greenbyte status exports
//
// What the public dataset does and does not contain matters here. It has operational events with
// source codes, messages and durations. It has NO work orders, NO confirmed root causes and NO
// repair narratives, so imported Penmanshiel turbines have real history and no resolutions. That
// absence is preserved rather than filled in: resolutions in this MVP come only from the clearly
// labelled synthetic demo farm and from what a user enters.
//
// The public site is a separate site row with its own asset codes (PEN-T01 ...). It is never merged
// with the fictional Demonstration Wind Farm. The real dataset has no WT03; the synthetic farm's
// WT-03 is fictional and unrelated.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openDatabase, rootPath } from '../db.js';
import {
  DOI, EXPECTED_MD5, LICENSE, PUBLISHER, RECORD_URL, SITE_ID, SOURCE_FILE, SOURCE_URL,
  parseStaticCsv,
} from './penmanshiel-csv.js';
import {
  eventCodeFor, mapSeverity, parseStatusCsv, STATUS_ARCHIVE, STATUS_ARCHIVE_SHA256, STATUS_SOURCE,
  type StatusRow,
} from './penmanshiel-status.js';

const STATUS_DIR = 'data/raw/penmanshiel';
const DERIVED_DIR = 'data/derived/penmanshiel';

async function main(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({ args, options: {
    'dry-run': { type: 'boolean', default: false },
    events: { type: 'boolean', default: false },
    'emit-derived': { type: 'boolean', default: false },
  }, strict: true, allowPositionals: false });
  if (values.events) { await importEvents(Boolean(values['dry-run']), Boolean(values['emit-derived'])); return; }
  const bytes = await readFile(resolve(rootPath, SOURCE_FILE));
  const md5 = createHash('md5').update(bytes).digest('hex');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (md5 !== EXPECTED_MD5) {
    throw new Error(`Checksum mismatch for ${SOURCE_FILE}. Re-download from ${RECORD_URL} before importing.`);
  }
  const turbines = parseStaticCsv(bytes.toString('utf8'));

  if (values['dry-run']) {
    console.log(JSON.stringify({ status: 'parsed_only', file: SOURCE_FILE, md5, sha256, turbines: turbines.length, assetCodes: turbines.map((row) => row.assetCode), sqlExecuted: false }, null, 2));
    return;
  }

  const db = await openDatabase();
  try {
    await db.query('begin');
    await db.query(
      `insert into public.sites (id, name, timezone, metadata, record_origin)
       values ($1, 'Penmanshiel Wind Farm', 'Europe/London', $2::jsonb, 'public_data')
       on conflict (id) do nothing`,
      [SITE_ID, JSON.stringify({
        publisher: PUBLISHER, license: LICENSE,
        doi: DOI, recordUrl: RECORD_URL, sourceUrl: SOURCE_URL,
        sourceFile: SOURCE_FILE, sourceMd5: md5, sourceSha256: sha256,
        scope: 'static turbine identity and siting only; no SCADA or event history imported',
        note: 'The published dataset contains no turbine WT03.',
      })]);
    let inserted = 0;
    for (const turbine of turbines) {
      const result = await db.query(
        `insert into public.assets (site_id, asset_code, asset_type, manufacturer, model, serial_number, status, metadata, record_origin)
         values ($1, $2, 'wind_turbine', $3, $4, $5, 'operational', $6::jsonb, 'public_data')
         on conflict (asset_code) do nothing
         returning id`,
        [SITE_ID, turbine.assetCode, turbine.manufacturer, turbine.model, turbine.identity,
          JSON.stringify({
            sourceTitle: turbine.title, ratedPowerKw: turbine.ratedPowerKw,
            hubHeightM: turbine.hubHeightM, rotorDiameterM: turbine.rotorDiameterM,
            latitude: turbine.latitude, longitude: turbine.longitude, elevationM: turbine.elevationM,
            country: turbine.country, commercialOperationsDate: turbine.commercialOperationsDate,
            license: LICENSE, attribution: `${PUBLISHER} via Zenodo record 16807304`,
            eventHistoryImported: false,
          })]);
      inserted += result.rowCount ?? 0;
    }
    await db.query('commit');
    console.log(JSON.stringify({ status: 'imported', parsed: turbines.length, inserted, alreadyPresent: turbines.length - inserted, eventsImported: 0 }));
    console.log('Static identity only. No public event history was imported and none was fabricated.');
  } catch (error) {
    await db.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}


/**
 * Imports the official status/event exports for whichever turbines are present in
 * `data/raw/penmanshiel`. The turbines must already exist as assets, which the default import
 * creates from the verified static file.
 */
async function importEvents(dryRun: boolean, emitDerived: boolean): Promise<void> {
  const directory = resolve(rootPath, STATUS_DIR);
  const files = (await readdir(directory)).filter((name) => /^Status_Penmanshiel_.*\.csv$/i.test(name)).sort();
  if (!files.length) {
    throw new Error(`No official status exports found in ${STATUS_DIR}. See docs/PENMANSHIEL_DATA.md for the download step.`);
  }

  const parsedFiles = [];
  let rowsRead = 0;
  let rowsRejected = 0;
  for (const file of files) {
    const bytes = await readFile(resolve(directory, file));
    const parsed = parseStatusCsv(bytes.toString('utf8'));
    parsedFiles.push({
      file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, parsed,
    });
    rowsRead += parsed.rows.length + parsed.rejected.length;
    rowsRejected += parsed.rejected.length;
  }
  const allRows: StatusRow[] = parsedFiles.flatMap((entry) => entry.parsed.rows);
  const timestamps = allRows.map((row) => row.startedAt).sort();
  const codes = [...new Set(allRows.map((row) => row.sourceCode))].sort((a, b) => Number(a) - Number(b));
  const statuses = [...new Set(allRows.map((row) => row.sourceStatus))].sort();

  if (emitDerived) {
    // A normalized, inspectable view of exactly what will be imported. The raw files stay
    // authoritative; this is derived output and is regenerated, never hand-edited.
    await mkdir(resolve(rootPath, DERIVED_DIR), { recursive: true });
    const header = 'asset_code,source_turbine,started_at,ended_at,duration,source_status,severity,source_code,event_code,message,iec_category,external_event_id';
    const lines = allRows.map((row) => [
      row.assetCode, row.sourceTurbine, row.startedAt, row.endedAt ?? '', row.duration ?? '',
      row.sourceStatus, mapSeverity(row.sourceStatus), row.sourceCode, eventCodeFor(row.sourceCode),
      JSON.stringify(row.message), row.iecCategory ?? '', row.externalEventId,
    ].join(','));
    await writeFile(resolve(rootPath, DERIVED_DIR, 'penmanshiel_status_events.csv'), `${[header, ...lines].join('\n')}\n`, 'utf8');
  }

  const summary = {
    files: parsedFiles.map((entry) => ({ file: entry.file, sha256: entry.sha256, bytes: entry.bytes, rows: entry.parsed.rows.length, rejected: entry.parsed.rejected.length })),
    sourceArchive: STATUS_ARCHIVE, sourceArchiveSha256: STATUS_ARCHIVE_SHA256,
    assets: [...new Set(allRows.map((row) => row.assetCode))].sort(),
    rowsRead, rowsAccepted: allRows.length, rowsRejected,
    period: { first: timestamps[0] ?? null, last: timestamps.at(-1) ?? null },
    distinctSourceCodes: codes.length, distinctSourceStatuses: statuses,
  };

  if (dryRun) {
    console.log(JSON.stringify({ status: 'parsed_only', ...summary, sqlExecuted: false }, null, 2));
    return;
  }

  const db = await openDatabase();
  try {
    await db.query('begin');
    const assetRows = await db.query(
      'select id, asset_code from public.assets where asset_code = any($1::text[]) and record_origin = $2',
      [summary.assets, 'public_data']);
    const assetIds = new Map<string, string>(assetRows.rows.map((row) => [row.asset_code as string, row.id as string]));
    const missing = summary.assets.filter((code) => !assetIds.has(code));
    if (missing.length) {
      throw new Error(`Public assets not found: ${missing.join(', ')}. Run "npm run data:penmanshiel" first to import turbine identities.`);
    }

    // Batched multi-row inserts. One statement per row is ~1200 round trips to a remote database,
    // which turned a small import into minutes; chunking keeps it to a handful of round trips.
    const CHUNK = 200;
    const COLUMNS = 12;
    let inserted = 0;
    const buildMetadata = (row: StatusRow) => ({
        source: STATUS_SOURCE, sourceTurbine: row.sourceTurbine, sourceCode: row.sourceCode,
        sourceStatus: row.sourceStatus, sourceMessage: row.message,
        durationText: row.duration, sourceComment: row.comment,
        serviceContractCategory: row.serviceContractCategory, iecCategory: row.iecCategory,
        globalContractCategory: row.globalContractCategory, customContractCategory: row.customContractCategory,
        license: LICENSE, attribution: `${PUBLISHER} via Zenodo record 16807304`,
        sourceArchive: STATUS_ARCHIVE, sourceTimeZone: 'UTC',
        severityDerivedFrom: 'source Status column; the published data has no "critical" class',
      });

    for (let start = 0; start < allRows.length; start += CHUNK) {
      const chunk = allRows.slice(start, start + CHUNK);
      const values: unknown[] = [];
      const tuples = chunk.map((row, index) => {
        const base = index * COLUMNS;
        values.push(
          assetIds.get(row.assetCode), eventCodeFor(row.sourceCode), row.message, null,
          mapSeverity(row.sourceStatus), row.startedAt, row.endedAt,
          // The description is the source message verbatim; nothing is written that the file does
          // not say. No root cause and no resolution is inferred, because there is none.
          row.message, JSON.stringify(buildMetadata(row)), 'public_data',
          STATUS_SOURCE, row.externalEventId);
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9}::jsonb,$${base + 10},$${base + 11},$${base + 12})`;
      });
      const result = await db.query(
        `insert into public.asset_events
           (asset_id, event_code, title, subsystem, severity, occurred_at, cleared_at, description,
            source_metadata, record_origin, event_source, external_event_id)
         values ${tuples.join(',')}
         on conflict (event_source, external_event_id)
           where event_source is not null and external_event_id is not null
           do nothing`,
        values);
      inserted += result.rowCount ?? 0;
    }
    await db.query('commit');
    console.log(JSON.stringify({
      status: 'imported', ...summary,
      eventsInserted: inserted, alreadyPresent: allRows.length - inserted, scadaRowsInserted: 0,
    }, null, 2));
    console.log('Real public operational events only. No work order, root cause or resolution exists in this dataset, and none was fabricated.');
  } catch (error) {
    await db.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

if (process.argv[1]?.includes('import-penmanshiel')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Penmanshiel import failed; credentials are not logged.');
    process.exitCode = 1;
  });
}
