// Fleet-level structured queries.
//
// Every operation here is a hand-written parameterized statement. The model may choose *which*
// operation runs and supply bounded parameters; it never supplies SQL, a table name or a column.
import type { FleetSummary, RecurringFault, RecordOrigin } from '@machine-memory/shared';
import type { Queryable } from './retrieval.js';

export const FLEET_OPERATIONS = [
  'fault_recurrence', 'open_incidents', 'event_code_assets', 'frequent_faults', 'faults_after_maintenance',
] as const;
export type FleetOperation = typeof FLEET_OPERATIONS[number];

export const DEFAULT_RECURRENCE_MINIMUM = 2;
export const DEFAULT_WINDOW_DAYS = 365;
const MAX_WINDOW_DAYS = 3650;
const MAX_ROWS = 50;

export interface FleetPlan { operation: FleetOperation; eventCode: string | null; minimumOccurrences: number; days: number }

const EVENT_CODE_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

/**
 * Coerces an untrusted plan object into a safe one. An unknown operation is refused outright
 * rather than defaulted, so a model cannot smuggle in an operation the backend does not implement.
 */
export function validatePlan(raw: unknown): FleetPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  const operation = typeof body.operation === 'string' ? body.operation : '';
  if (!(FLEET_OPERATIONS as readonly string[]).includes(operation)) return null;
  const rawCode = typeof body.eventCode === 'string' ? body.eventCode.trim() : '';
  // A malformed code is dropped, never passed through: the query simply runs unfiltered by code.
  const eventCode = rawCode && EVENT_CODE_PATTERN.test(rawCode) ? rawCode : null;
  return {
    operation: operation as FleetOperation,
    eventCode,
    minimumOccurrences: clampInt(body.minimumOccurrences, DEFAULT_RECURRENCE_MINIMUM, 2, 100),
    days: clampInt(body.days, DEFAULT_WINDOW_DAYS, 1, MAX_WINDOW_DAYS),
  };
}

export async function recurringFaults(db: Queryable, options: { minimumOccurrences?: number; days?: number; eventCode?: string | null } = {}): Promise<RecurringFault[]> {
  const minimum = clampInt(options.minimumOccurrences, DEFAULT_RECURRENCE_MINIMUM, 2, 100);
  const days = clampInt(options.days, DEFAULT_WINDOW_DAYS, 1, MAX_WINDOW_DAYS);
  const result = await db.query(
    `select a.asset_code, e.event_code, count(*)::int as occurrences,
            min(e.occurred_at) as first_at, max(e.occurred_at) as last_at,
            bool_or(e.cleared_at is null) as open_now,
            array_agg(distinct e.record_origin::text) as origins
     from public.asset_events e
     join public.assets a on a.id = e.asset_id
     where e.occurred_at >= now() - ($1::int * interval '1 day')
       and ($2::text is null or e.event_code = $2::text)
     group by a.asset_code, e.event_code
     having count(*) >= $3::int
     order by count(*) desc, max(e.occurred_at) desc, a.asset_code
     limit ${MAX_ROWS}`,
    [days, options.eventCode ?? null, minimum]);
  return result.rows.map((row) => ({
    assetCode: String(row.asset_code), eventCode: String(row.event_code),
    occurrences: Number(row.occurrences),
    firstAt: new Date(row.first_at as string).toISOString(),
    lastAt: new Date(row.last_at as string).toISOString(),
    openNow: Boolean(row.open_now),
    recordOrigins: (row.origins as string[]).sort() as RecordOrigin[],
  }));
}

/** Runs one allowlisted operation. `plan.operation` has already been checked by validatePlan. */
export async function runPlan(db: Queryable, plan: FleetPlan): Promise<{ label: string; rows: Record<string, unknown>[] }> {
  switch (plan.operation) {
    case 'fault_recurrence': {
      const rows = await recurringFaults(db, plan);
      return { label: `Assets with at least ${plan.minimumOccurrences} occurrences of the same event code in the last ${plan.days} days`, rows: rows as unknown as Record<string, unknown>[] };
    }
    case 'open_incidents': {
      const result = await db.query(
        `select a.asset_code, i.event_code, i.symptoms, i.opened_at, i.record_origin
         from public.incidents i join public.assets a on a.id = i.asset_id
         where i.closed_at is null
         order by i.opened_at desc, a.asset_code limit ${MAX_ROWS}`, []);
      return { label: 'Incidents with no recorded closure', rows: result.rows };
    }
    case 'event_code_assets': {
      const result = await db.query(
        `select a.asset_code, count(*)::int as occurrences, max(e.occurred_at) as last_at,
                bool_or(e.cleared_at is null) as open_now
         from public.asset_events e join public.assets a on a.id = e.asset_id
         where ($1::text is null or e.event_code = $1::text)
           and e.occurred_at >= now() - ($2::int * interval '1 day')
         group by a.asset_code order by count(*) desc, a.asset_code limit ${MAX_ROWS}`,
        [plan.eventCode, plan.days]);
      return { label: plan.eventCode ? `Assets that recorded ${plan.eventCode}` : 'Assets by recorded event volume', rows: result.rows };
    }
    case 'frequent_faults': {
      const result = await db.query(
        `select e.event_code, count(*)::int as occurrences, count(distinct e.asset_id)::int as assets,
                max(e.occurred_at) as last_at
         from public.asset_events e
         where e.occurred_at >= now() - ($1::int * interval '1 day')
         group by e.event_code order by count(*) desc, e.event_code limit ${MAX_ROWS}`,
        [plan.days]);
      return { label: `Most frequently recorded event codes in the last ${plan.days} days`, rows: result.rows };
    }
    case 'faults_after_maintenance': {
      // Co-occurrence inside a window. This is an ordering observation, never a causal claim.
      const result = await db.query(
        `select a.asset_code, e.event_code, e.occurred_at as fault_at,
                m.event_type, m.occurred_at as maintenance_at,
                round(extract(epoch from (e.occurred_at - m.occurred_at)) / 86400.0)::int as days_after
         from public.asset_events e
         join public.assets a on a.id = e.asset_id
         join public.maintenance_events m on m.asset_id = e.asset_id
          and m.occurred_at < e.occurred_at
          and m.occurred_at >= e.occurred_at - ($1::int * interval '1 day')
         where e.occurred_at >= now() - ($2::int * interval '1 day')
         order by e.occurred_at desc limit ${MAX_ROWS}`,
        [Math.min(plan.days, 90), plan.days]);
      return { label: 'Faults recorded after maintenance on the same asset (ordering only, not causation)', rows: result.rows };
    }
    default:
      throw new Error('Unsupported fleet operation.');
  }
}

export async function fleetSummary(db: Queryable): Promise<FleetSummary> {
  // One round trip for the counters rather than a query per tile.
  const totals = await db.query(`select
      (select count(*)::int from public.assets) as assets,
      (select count(*)::int from public.assets where status = 'operational') as healthy,
      (select count(*)::int from public.assets where status = 'warning') as warning,
      (select count(*)::int from public.assets where status = 'fault') as faulted,
      (select count(*)::int from public.incidents where closed_at is null) as open_incidents,
      (select count(*)::int from public.documents) as knowledge_sources,
      (select count(*)::int from public.document_chunks) as knowledge_chunks`, []);
  const recurring = await recurringFaults(db, { minimumOccurrences: DEFAULT_RECURRENCE_MINIMUM, days: DEFAULT_WINDOW_DAYS });
  const row = totals.rows[0];
  const assets = Number(row.assets);
  const healthy = Number(row.healthy);
  const warning = Number(row.warning);
  const faulted = Number(row.faulted);

  const recent = await db.query(`select * from (
      select 'RESOLUTION' as kind, 'Resolution logged' as title, r.resolution_summary as detail,
             r.created_at as timestamp, r.record_origin::text as record_origin, a.asset_code
        from public.resolutions r join public.assets a on a.id = r.asset_id
      union all
      select 'EVENT', 'Event recorded', e.title, e.occurred_at, e.record_origin::text, a.asset_code
        from public.asset_events e join public.assets a on a.id = e.asset_id
      union all
      select 'MAINTENANCE', 'Maintenance recorded', m.description, m.occurred_at, m.record_origin::text, a.asset_code
        from public.maintenance_events m join public.assets a on a.id = m.asset_id
      union all
      select 'DOCUMENT', 'Knowledge indexed', d.title, d.created_at, d.record_origin::text, null
        from public.documents d
    ) t order by timestamp desc limit 12`, []);

  return {
    totals: {
      assets, healthy, warning, faulted,
      other: Math.max(0, assets - healthy - warning - faulted),
      openIncidents: Number(row.open_incidents),
      recurringFaults: recurring.length,
      knowledgeSources: Number(row.knowledge_sources),
      knowledgeChunks: Number(row.knowledge_chunks),
    },
    recentMemory: recent.rows.map((item) => ({
      kind: String(item.kind), title: String(item.title),
      detail: String(item.detail ?? '').slice(0, 300),
      timestamp: new Date(item.timestamp as string).toISOString(),
      recordOrigin: item.record_origin as RecordOrigin,
      assetCode: (item.asset_code as string | null) ?? null,
    })),
  };
}
