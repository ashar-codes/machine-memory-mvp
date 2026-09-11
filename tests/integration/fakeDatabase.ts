// A fake `Queryable` for the retrieval tests.
//
// It does not parse SQL. It identifies each repository-owned statement by a distinctive fragment
// and then applies the *actual bind parameters* to fixture rows in JavaScript. That is what makes
// these tests meaningful: they verify the parameters the pipeline passes (current-event exclusion,
// date windows, asset exclusion, authority filters), which is where retrieval logic goes wrong.
// SQL text correctness itself requires a live PostgreSQL run; see docs/DATABASE.md.
import type { Queryable } from '../../backend/src/retrieval.js';

export const WT07 = '20000000-0000-4000-8000-000000000007';
export const WT03 = '20000000-0000-4000-8000-000000000003';
export const CURRENT_EVENT = '40000000-0000-4000-8000-000000000003';
export const EVENT_CODE = 'PITCH-HYD-214';

type Row = Record<string, unknown>;

export const assets: Row[] = [
  { id: WT07, site_id: 'site-1', asset_code: 'WT-07', asset_type: 'wind_turbine', manufacturer: 'Fictional Demo OEM', model: 'Demo 2MW', status: 'fault', record_origin: 'synthetic_demo' },
  { id: WT03, site_id: 'site-1', asset_code: 'WT-03', asset_type: 'wind_turbine', manufacturer: 'Fictional Demo OEM', model: 'Demo 2MW', status: 'operational', record_origin: 'synthetic_demo' },
];

export const events: Row[] = [
  { id: '40000000-0000-4000-8000-000000000001', asset_id: WT07, event_code: EVENT_CODE, title: 'Pitch hydraulic pressure alert', subsystem: 'Pitch', severity: 'warning', occurred_at: '2026-07-03T08:00:00.000Z', cleared_at: '2026-07-03T09:10:00.000Z', description: 'Synthetic pressure alert used to demonstrate recurrence.', record_origin: 'synthetic_demo' },
  { id: '40000000-0000-4000-8000-000000000002', asset_id: WT07, event_code: EVENT_CODE, title: 'Pitch hydraulic pressure alert', subsystem: 'Pitch', severity: 'warning', occurred_at: '2026-08-15T10:00:00.000Z', cleared_at: '2026-08-15T10:47:00.000Z', description: 'Synthetic repeat alert after intermittent pressure indication.', record_origin: 'synthetic_demo' },
  { id: CURRENT_EVENT, asset_id: WT07, event_code: EVENT_CODE, title: 'Pitch hydraulic pressure alert', subsystem: 'Pitch', severity: 'critical', occurred_at: '2026-09-09T08:20:00.000Z', cleared_at: null, description: 'Current synthetic alert; no approved troubleshooting procedure is attached.', record_origin: 'synthetic_demo' },
  { id: '40000000-0000-4000-8000-000000000004', asset_id: WT03, event_code: EVENT_CODE, title: 'Pitch hydraulic pressure alert', subsystem: 'Pitch', severity: 'warning', occurred_at: '2026-08-02T11:00:00.000Z', cleared_at: '2026-08-02T12:00:00.000Z', description: 'Synthetic fleet comparison event.', record_origin: 'synthetic_demo' },
];

export const incidents: Row[] = [
  { id: 'i1', asset_id: WT07, event_code: EVENT_CODE, symptoms: 'Intermittent pressure indication', root_cause: 'Synthetic diagnosis: sensor connector deterioration', resolution_summary: 'Historical demo account: connector replaced by authorized team.', opened_at: '2026-07-03T08:00:00.000Z', closed_at: '2026-07-03T09:10:00.000Z', record_origin: 'synthetic_demo' },
  { id: 'i2', asset_id: WT07, event_code: EVENT_CODE, symptoms: 'Repeated hydraulic pressure alert', root_cause: 'Synthetic diagnosis: sensor drift', resolution_summary: 'Historical demo account: pressure sensor replaced by authorized team.', opened_at: '2026-08-15T10:00:00.000Z', closed_at: '2026-08-15T10:47:00.000Z', record_origin: 'synthetic_demo' },
  { id: 'i3', asset_id: WT03, event_code: EVENT_CODE, symptoms: 'Pressure indication intermittently unavailable', root_cause: 'Synthetic diagnosis: wiring defect', resolution_summary: 'Historical demo account: wiring defect corrected.', opened_at: '2026-08-02T11:00:00.000Z', closed_at: '2026-08-02T12:00:00.000Z', record_origin: 'synthetic_demo' },
];

export const workOrders: Row[] = [
  { id: 'w1', asset_id: WT07, event_code: EVENT_CODE, summary: 'Synthetic pressure sensor replacement', root_cause: 'Synthetic sensor drift', resolution: 'Sensor replaced; fictional historical account, not a procedure.', status: 'completed', completed_at: '2026-08-15T10:47:00.000Z', created_at: '2026-08-15T10:00:00.000Z', record_origin: 'synthetic_demo' },
];

export const maintenance: Row[] = [
  { id: 'm1', asset_id: WT07, event_type: 'component_replacement', description: 'Synthetic record: pressure sensor replacement on pitch hydraulic assembly.', occurred_at: '2026-08-15T10:47:00.000Z', record_origin: 'synthetic_demo' },
  { id: 'm2', asset_id: WT07, event_type: 'inspection', description: 'Synthetic recent inspection note: no visible leak recorded.', occurred_at: '2026-09-07T09:00:00.000Z', record_origin: 'synthetic_demo' },
  { id: 'm3', asset_id: WT07, event_type: 'lubrication', description: 'Synthetic record well outside the change window.', occurred_at: '2026-01-05T09:00:00.000Z', record_origin: 'synthetic_demo' },
];

export const notes: Row[] = [
  { id: 'n1', asset_id: WT07, incident_id: 'i2', content: 'Synthetic technician memory: indication stabilized after the historical sensor replacement.', created_at: '2026-08-15T11:00:00.000Z', record_origin: 'synthetic_demo' },
];

export const resolutions: Row[] = [
  { id: 'r1', asset_id: WT07, event_code: EVENT_CODE, root_cause: 'Synthetic sensor drift', resolution_summary: 'Historical sensor replacement recorded in demo work order.', component: 'Pressure sensor', downtime_minutes: 47, notes: 'Fictional historical narrative.', validated: false, created_at: '2026-08-15T11:00:00.000Z', record_origin: 'synthetic_demo' },
];

export const knowledgeChunks: Row[] = [
  {
    id: 'k1', content: 'Paraphrase of published guidance on hazardous energy control for wind turbine servicing.',
    page_number: null, section: 'Lockout/Tagout', metadata: { assetType: 'wind_turbine', manufacturer: null, model: null },
    record_origin: 'public_reference', event_code: null, title: 'Wind Energy: Lockout/Tagout',
    organization: 'OSHA', source_url: 'https://www.osha.gov/green-jobs/wind-energy/lockout-tagout',
    source_type: 'SAFETY_REFERENCE', authority_class: 'REGULATOR', similarity: 0.72, keyword_rank: 0.2,
  },
  {
    id: 'k2', content: 'Paraphrase of published research on pitch bearing reliability and wind plant maintenance.',
    page_number: 5, section: 'Pitch bearing reliability', metadata: { assetType: 'wind_turbine', manufacturer: null, model: null },
    record_origin: 'public_reference', event_code: null, title: 'Wind Turbine Drivetrain Reliability',
    organization: 'NREL', source_url: 'https://www.nrel.gov/docs/fy21osti/80195.pdf',
    source_type: 'TECHNICAL_REFERENCE', authority_class: 'RESEARCH', similarity: 0.66, keyword_rank: 0.1,
  },
  {
    id: 'k3', content: 'Synthetic narrative note about a pressure indication that stabilized after a component change.',
    page_number: null, section: 'Narrative', metadata: { assetType: 'wind_turbine', manufacturer: null, model: null },
    record_origin: 'synthetic_demo', event_code: EVENT_CODE, title: 'Demo technician narrative',
    organization: 'Machine Memory demo', source_url: null,
    source_type: 'TECHNICIAN_NOTE', authority_class: 'UNVERIFIED', similarity: 0.91, keyword_rank: 0.4,
  },
];

export interface FakeDatabase extends Queryable {
  /** Every statement executed, with its bind parameters, for assertions about retrieval scope. */
  calls: { sql: string; values: unknown[] }[];
}

export interface FakeOptions {
  /** Omit the public corpus to exercise the empty-semantic-corpus degraded state. */
  knowledge?: Row[];
  extraResolutions?: Row[];
  assetCodes?: string[];
  /** Additional events on the fixture assets, for questions that name a second code. */
  extraEvents?: Row[];
}

const time = (value: unknown) => new Date(String(value)).getTime();

export function createFakeDatabase(options: FakeOptions = {}): FakeDatabase {
  const knowledge = options.knowledge ?? knowledgeChunks;
  const allResolutions = [...resolutions, ...(options.extraResolutions ?? [])];
  const visibleAssets = options.assetCodes
    ? assets.filter((asset) => options.assetCodes?.includes(String(asset.asset_code)))
    : assets;
  const calls: FakeDatabase['calls'] = [];
  const allEvents = [...events, ...(options.extraEvents ?? [])];

  return {
    calls,
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      const has = (fragment: string) => sql.includes(fragment);

      // Checked before the fleet statement below, which shares its join clause.
      if (has('select distinct e.event_code')) {
        const asset = visibleAssets.find((row) => row.asset_code === values[0]);
        const codes = [...new Set(allEvents.filter((row) => row.asset_id === asset?.id).map((row) => row.event_code))];
        return { rows: codes.map((event_code) => ({ event_code })) };
      }
      // Asset-wide totals: counted over every code on the asset, never over the selected one.
      if (has('count(distinct event_code)')) {
        const rows = allEvents.filter((row) => row.asset_id === values[0]);
        const sorted = [...rows].sort((a, b) => time(a.occurred_at) - time(b.occurred_at));
        return { rows: [{
          total: rows.length, codes: new Set(rows.map((row) => row.event_code)).size,
          first_at: sorted[0]?.occurred_at ?? null, last_at: sorted[sorted.length - 1]?.occurred_at ?? null,
        }] };
      }
      if (has('group by event_code order by count(*) desc')) {
        const byCode = new Map<string, Row[]>();
        for (const row of allEvents.filter((item) => item.asset_id === values[0])) {
          byCode.set(String(row.event_code), [...(byCode.get(String(row.event_code)) ?? []), row]);
        }
        return { rows: [...byCode.entries()]
          .sort((a, b) => (b[1].length - a[1].length) || a[0].localeCompare(b[0]))
          .slice(0, 8)
          .map(([event_code, rows]) => ({ event_code, occurrences: rows.length, title: rows[0].title })) };
      }
      // The copilot's "does this asset have any memory at all" probe.
      if (has('as asset_exists')) {
        const asset = visibleAssets.find((row) => row.asset_code === values[0]);
        return { rows: [{
          events: allEvents.filter((row) => row.asset_id === asset?.id).length,
          maintenance: maintenance.filter((row) => row.asset_id === asset?.id).length,
          work_orders: workOrders.filter((row) => row.asset_id === asset?.id).length,
          notes: notes.filter((row) => row.asset_id === asset?.id).length,
          resolutions: allResolutions.filter((row) => row.asset_id === asset?.id).length,
          asset_exists: asset ? 1 : 0,
        }] };
      }
      if (has('from public.assets where asset_code')) {
        return { rows: visibleAssets.filter((row) => row.asset_code === values[0]) };
      }
      if (has('order by (cleared_at is null) desc')) {
        const [assetId, eventCode] = values;
        const matching = allEvents
          .filter((row) => row.asset_id === assetId && (eventCode == null || row.event_code === eventCode))
          .sort((a, b) => (Number(b.cleared_at === null) - Number(a.cleared_at === null))
            || (time(b.occurred_at) - time(a.occurred_at)));
        return { rows: matching.slice(0, 1) };
      }
      if (has('previous_count')) {
        const [assetId, eventCode, selectedId, anchor] = values;
        const previous = allEvents.filter((row) => row.asset_id === assetId && row.event_code === eventCode
          && time(row.occurred_at) <= time(anchor) && (selectedId == null || row.id !== selectedId));
        const sorted = [...previous].sort((a, b) => time(a.occurred_at) - time(b.occurred_at));
        return {
          rows: [{
            previous_count: previous.length,
            first_at: sorted[0]?.occurred_at ?? null,
            last_at: sorted[sorted.length - 1]?.occurred_at ?? null,
            public_data: 0,
            synthetic_demo: previous.filter((row) => row.record_origin === 'synthetic_demo').length,
            user_demo: previous.filter((row) => row.record_origin === 'user_demo').length,
          }],
        };
      }
      if (has('from public.asset_events') && has('order by occurred_at desc, id desc')) {
        const [assetId, eventCode, selectedId, anchor] = values;
        // Asset-wide retrieval binds the asset alone; event-scoped history also binds the code.
        const scoped = has('and event_code = $2')
          ? allEvents.filter((row) => row.event_code === eventCode
            && time(row.occurred_at) <= time(anchor) && (selectedId == null || row.id !== selectedId))
          : allEvents;
        return {
          rows: scoped.filter((row) => row.asset_id === assetId)
            .sort((a, b) => time(b.occurred_at) - time(a.occurred_at)),
        };
      }
      if (has('from public.incidents where asset_id')) {
        const [assetId, eventCode] = values;
        return { rows: incidents.filter((row) => row.asset_id === assetId && row.event_code === eventCode) };
      }
      if (has('from public.work_orders where asset_id') && !has(') changes')) {
        const [assetId, eventCode] = values;
        return { rows: workOrders.filter((row) => row.asset_id === assetId && (eventCode == null || row.event_code === eventCode)) };
      }
      if (has('from public.resolutions where asset_id') && !has(') changes')) {
        const [assetId, eventCode] = values;
        return {
          rows: allResolutions.filter((row) => row.asset_id === assetId && row.event_code === eventCode)
            .sort((a, b) => time(b.created_at) - time(a.created_at)),
        };
      }
      if (has('from public.technician_notes n')) {
        const [assetId, eventCode] = values;
        return {
          rows: notes.filter((row) => row.asset_id === assetId
            && (row.incident_id == null
              || incidents.some((incident) => incident.id === row.incident_id && incident.event_code === eventCode))),
        };
      }
      if (has('join public.assets a on a.id = e.asset_id')) {
        const [eventCode, assetId] = values;
        return {
          rows: allEvents.filter((row) => row.event_code === eventCode && row.asset_id !== assetId).map((row) => {
            const asset = assets.find((candidate) => candidate.id === row.asset_id) ?? {};
            const incident = incidents.find((candidate) => candidate.asset_id === row.asset_id && candidate.event_code === eventCode) ?? {};
            return { ...row, asset_code: asset.asset_code, asset_type: asset.asset_type, manufacturer: asset.manufacturer, model: asset.model, symptoms: incident.symptoms ?? null, root_cause: incident.root_cause ?? null, resolution_summary: incident.resolution_summary ?? null };
          }),
        };
      }
      if (has(') changes')) {
        const [assetId, start, end] = values;
        const rows = [
          ...maintenance.filter((row) => row.asset_id === assetId).map((row) => ({ id: row.id, kind: 'MAINTENANCE', title: row.event_type, description: row.description, at: row.occurred_at, record_origin: row.record_origin })),
          ...workOrders.filter((row) => row.asset_id === assetId).map((row) => ({ id: row.id, kind: 'WORK_ORDER', title: row.summary, description: row.resolution, at: row.completed_at ?? row.created_at, record_origin: row.record_origin })),
          ...allResolutions.filter((row) => row.asset_id === assetId).map((row) => ({ id: row.id, kind: 'RESOLUTION', title: `Resolution: ${String(row.event_code)}`, description: row.resolution_summary, at: row.created_at, record_origin: row.record_origin })),
          ...allEvents.filter((row) => row.asset_id === assetId).map((row) => ({ id: row.id, kind: 'ASSET_EVENT', title: `${String(row.event_code)} — ${String(row.title)}`, description: row.description, at: row.occurred_at, record_origin: row.record_origin })),
        ];
        return {
          rows: rows.filter((row) => time(row.at) >= time(start) && time(row.at) <= time(end))
            .sort((a, b) => (time(b.at) - time(a.at)) || String(a.kind).localeCompare(String(b.kind))),
        };
      }
      if (has('from public.document_chunks c')) {
        const [authorityClasses, sourceTypes, recordOrigins, assetType, vector] = values;
        return {
          rows: knowledge.filter((row) => (authorityClasses as string[]).includes(String(row.authority_class))
            && (sourceTypes as string[]).includes(String(row.source_type))
            && (recordOrigins as string[]).includes(String(row.record_origin))
            && (assetType == null || (row.metadata as Row | undefined)?.assetType === assetType))
            .map((row) => ({ ...row, similarity: vector == null ? null : row.similarity })),
        };
      }
      if (has('begin') || has('commit') || has('rollback')) return { rows: [] };
      throw new Error(`Unhandled statement in fake database: ${sql.slice(0, 80)}`);
    },
  };
}
