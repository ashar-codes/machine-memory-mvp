// The single path by which an asset event enters Machine Memory.
//
// Manual entry (Scenario Lab), CSV import and the read-only operational-event boundary all end up
// here. There is deliberately no second way to write an asset_events row: a fault must be stored,
// provenanced and reflected in asset status identically whatever delivered it.
import type { RecordOrigin } from '@machine-memory/shared';
import { refreshAssetStatus } from './imports.js';
import type { Queryable } from './retrieval.js';

export const EVENT_FIELDS =
  'id, asset_id, event_code, title, subsystem, severity, occurred_at, cleared_at, description, record_origin, event_source, external_event_id';

export interface RecordEventInput {
  assetCode: string;
  eventCode: string;
  title: string;
  subsystem?: string | null;
  severity: string;
  occurredAt: string;
  clearedAt?: string | null;
  description?: string | null;
  recordOrigin: RecordOrigin;
  /** Which adapter delivered this, when it came from outside. */
  source?: string | null;
  /** The upstream system's own id, used for idempotency. */
  externalEventId?: string | null;
}

export type RecordEventOutcome =
  | { status: 'created'; event: Record<string, unknown> }
  | { status: 'duplicate'; event: Record<string, unknown> }
  | { status: 'asset_not_found' };

/**
 * Persists one event and recomputes the asset's status, inside the caller's transaction.
 *
 * Replays are resolved by the partial unique index on (event_source, external_event_id) rather
 * than by a read-then-write check, so two deliveries racing each other cannot both insert.
 */
export async function recordEvent(db: Queryable, input: RecordEventInput): Promise<RecordEventOutcome> {
  const asset = await db.query('select id from public.assets where asset_code = $1 for key share', [input.assetCode]);
  if (!asset.rows[0]) return { status: 'asset_not_found' };
  const assetId = asset.rows[0].id as string;

  const values = [
    assetId, input.eventCode, input.title, input.subsystem ?? null, input.severity,
    input.occurredAt, input.clearedAt ?? null, input.description ?? null, input.recordOrigin,
    input.source ?? null, input.externalEventId ?? null,
  ];
  const inserted = await db.query(
    `insert into public.asset_events
       (asset_id, event_code, title, subsystem, severity, occurred_at, cleared_at, description,
        record_origin, event_source, external_event_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (event_source, external_event_id)
       where event_source is not null and external_event_id is not null
       do nothing
     returning ${EVENT_FIELDS}`, values);

  if (!inserted.rows[0]) {
    // The index rejected it: this exact upstream event is already recorded. Return the stored row
    // so the caller can report the event without creating a second copy of the same fault.
    const existing = await db.query(
      `select ${EVENT_FIELDS} from public.asset_events
        where event_source = $1 and external_event_id = $2`,
      [input.source, input.externalEventId]);
    return { status: 'duplicate', event: existing.rows[0] ?? {} };
  }

  await refreshAssetStatus(db, [input.assetCode]);
  return { status: 'created', event: inserted.rows[0] };
}
