// Structured import commit. Rows are validated deterministically, then written through
// parameterized SQL inside one transaction with the batch that produced them.
//
// Everything written here carries record_origin 'user_import' (or 'simulation' when the user
// explicitly marks the batch as simulated), so no imported row can ever be mistaken for reviewed
// public data or for the synthetic hero history.
import type { ImportRejection, ImportType, RecordOrigin } from '@machine-memory/shared';
import type { Queryable } from './retrieval.js';
import {
  ASSET_CODE_PATTERN, EVENT_CODE_PATTERN, normalizeSeverity, parseTimestamp, type Table,
} from './tabular.js';

const MAX_REJECTION_SAMPLE = 25;
const MAX_TEXT = 4000;
const MAX_TITLE = 500;

export class ImportError extends Error {}

export interface CommitResult {
  rowsReceived: number;
  rowsImported: number;
  rowsRejected: number;
  rejections: ImportRejection[];
  assetsTouched: string[];
}

interface PreparedRow { assetCode: string; values: Record<string, string | null> }

const text = (value: string | undefined, max = MAX_TEXT): string | null => {
  const trimmed = (value ?? '').trim().slice(0, max);
  return trimmed ? trimmed : null;
};

/**
 * Turns mapped cells into validated rows. A row that fails is rejected with a reason and never
 * silently coerced: an unparseable timestamp is not quietly replaced with "now".
 */
function prepare(table: Table, mapping: Map<string, string>, importType: ImportType): {
  prepared: PreparedRow[]; rejections: ImportRejection[];
} {
  const prepared: PreparedRow[] = [];
  const rejections: ImportRejection[] = [];
  const columnFor = new Map<string, string>();
  for (const [column, field] of mapping) columnFor.set(field, column);
  const read = (row: Record<string, string>, field: string): string | undefined => {
    const column = columnFor.get(field);
    return column === undefined ? undefined : row[column];
  };

  table.rows.forEach((row, index) => {
    const rowNumber = index + 2; // +1 for the header, +1 because humans count from one.
    const reject = (reason: string) => {
      if (rejections.length < MAX_REJECTION_SAMPLE) rejections.push({ row: rowNumber, reason });
    };
    const assetCode = (read(row, 'asset_code') ?? '').trim();
    if (!assetCode) { reject('Missing asset code.'); return; }
    if (!ASSET_CODE_PATTERN.test(assetCode)) { reject('Asset code contains unsupported characters.'); return; }

    const values: Record<string, string | null> = {};
    const timestamp = (field: string, required: boolean): boolean => {
      const raw = read(row, field);
      if (raw === undefined || !raw.trim()) {
        if (required) { reject(`Missing ${field}.`); return false; }
        values[field] = null;
        return true;
      }
      const iso = parseTimestamp(raw);
      if (!iso) { reject(`Could not read ${field} as a date or time.`); return false; }
      values[field] = iso;
      return true;
    };
    const required = (field: string, max = MAX_TEXT): boolean => {
      const value = text(read(row, field), max);
      if (!value) { reject(`Missing ${field}.`); return false; }
      values[field] = value;
      return true;
    };

    switch (importType) {
      case 'EVENT_LOG': {
        const eventCode = (read(row, 'event_code') ?? '').trim();
        if (!eventCode) { reject('Missing event code.'); return; }
        if (!EVENT_CODE_PATTERN.test(eventCode)) { reject('Event code contains unsupported characters.'); return; }
        values.event_code = eventCode;
        if (!required('title', MAX_TITLE)) return;
        if (!timestamp('occurred_at', true)) return;
        if (!timestamp('cleared_at', false)) return;
        values.subsystem = text(read(row, 'subsystem'), 200);
        values.severity = normalizeSeverity(read(row, 'severity') ?? '');
        // Match recordEvent(): an absent optional description persists as empty text.
        values.description = text(read(row, 'description')) ?? '';
        break;
      }
      case 'MAINTENANCE_HISTORY': {
        if (!required('event_type', 200)) return;
        if (!timestamp('occurred_at', true)) return;
        values.component = text(read(row, 'component'), 200);
        values.description = text(read(row, 'description'));
        break;
      }
      case 'WORK_ORDERS': {
        if (!required('summary', MAX_TITLE)) return;
        const eventCode = (read(row, 'event_code') ?? '').trim();
        if (eventCode && !EVENT_CODE_PATTERN.test(eventCode)) { reject('Event code contains unsupported characters.'); return; }
        values.event_code = eventCode || null;
        values.root_cause = text(read(row, 'root_cause'));
        values.resolution = text(read(row, 'resolution'));
        if (!timestamp('completed_at', false)) return;
        break;
      }
      case 'TECHNICIAN_NOTES': {
        if (!required('content')) return;
        if (!timestamp('created_at', false)) return;
        break;
      }
      default:
        throw new ImportError('Unsupported import type.');
    }
    prepared.push({ assetCode, values });
  });

  return { prepared, rejections };
}

/**
 * Writes prepared rows. The caller supplies a client already inside a transaction, so a failure
 * anywhere leaves the database exactly as it was and the batch is never marked committed.
 */
export async function commitImport(db: Queryable, options: {
  table: Table; mapping: Map<string, string>; importType: ImportType;
  batchId: string; recordOrigin: RecordOrigin;
}): Promise<CommitResult> {
  const { prepared, rejections } = prepare(options.table, options.mapping, options.importType);

  // Resolve every asset code once rather than per row.
  const codes = [...new Set(prepared.map((row) => row.assetCode))];
  const assetRows = codes.length
    ? (await db.query('select id, asset_code from public.assets where asset_code = any($1::text[])', [codes])).rows
    : [];
  const assetIds = new Map<string, string>(assetRows.map((row) => [row.asset_code as string, row.id as string]));

  let imported = 0;
  const touched = new Set<string>();
  for (const [index, row] of prepared.entries()) {
    const assetId = assetIds.get(row.assetCode);
    if (!assetId) {
      if (rejections.length < MAX_REJECTION_SAMPLE) {
        rejections.push({ row: index + 2, reason: `No asset "${row.assetCode}" exists. Add the turbine first, then re-import.` });
      }
      continue;
    }
    const v = row.values;
    switch (options.importType) {
      case 'EVENT_LOG':
        await db.query(`insert into public.asset_events
          (asset_id, event_code, title, subsystem, severity, occurred_at, cleared_at, description, record_origin, import_batch_id)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [assetId, v.event_code, v.title, v.subsystem, v.severity, v.occurred_at, v.cleared_at, v.description, options.recordOrigin, options.batchId]);
        break;
      case 'MAINTENANCE_HISTORY':
        await db.query(`insert into public.maintenance_events
          (asset_id, event_type, description, occurred_at, record_origin, import_batch_id)
          values ($1,$2,$3,$4,$5,$6)`,
        [assetId, v.event_type, [v.component ? `Component: ${v.component}.` : '', v.description ?? ''].filter(Boolean).join(' ') || v.event_type, v.occurred_at, options.recordOrigin, options.batchId]);
        break;
      case 'WORK_ORDERS':
        await db.query(`insert into public.work_orders
          (asset_id, event_code, summary, root_cause, resolution, status, completed_at, record_origin, import_batch_id)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [assetId, v.event_code, v.summary, v.root_cause, v.resolution, v.completed_at ? 'completed' : 'open', v.completed_at, options.recordOrigin, options.batchId]);
        break;
      case 'TECHNICIAN_NOTES':
        await db.query(`insert into public.technician_notes
          (asset_id, content, created_at, record_origin, import_batch_id)
          values ($1,$2,coalesce($3::timestamptz, now()),$4,$5)`,
        [assetId, v.content, v.created_at, options.recordOrigin, options.batchId]);
        break;
      default:
        throw new ImportError('Unsupported import type.');
    }
    imported += 1;
    touched.add(row.assetCode);
  }

  return {
    rowsReceived: options.table.rows.length,
    rowsImported: imported,
    rowsRejected: options.table.rows.length - imported,
    rejections,
    assetsTouched: [...touched].sort(),
  };
}

/** Recomputes asset status from its open events, so an imported fault shows on the asset rail. */
export async function refreshAssetStatus(db: Queryable, assetCodes: string[]): Promise<void> {
  if (!assetCodes.length) return;
  await db.query(`update public.assets a set status = case
      when exists (select 1 from public.asset_events e where e.asset_id = a.id and e.cleared_at is null and e.severity = 'critical') then 'fault'
      when exists (select 1 from public.asset_events e where e.asset_id = a.id and e.cleared_at is null and e.severity = 'warning') then 'warning'
      else 'operational' end
    where a.asset_code = any($1::text[])`, [assetCodes]);
}
