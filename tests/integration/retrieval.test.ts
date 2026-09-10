import { describe, expect, it } from 'vitest';
import { RECENT_CHANGE_WINDOW_DAYS, retrieveEvidence } from '../../backend/src/retrieval.js';
import { CURRENT_EVENT, EVENT_CODE, WT03, WT07, createFakeDatabase } from './fakeDatabase.js';

const base = { assetCode: 'WT-07', eventCode: EVENT_CODE, embedding: null };

describe('HISTORY retrieval', () => {
  it('excludes the current occurrence from the previous-occurrence count', async () => {
    const db = createFakeDatabase();
    const result = await retrieveEvidence(db, { ...base, intent: 'HISTORY', question: 'Has this happened before?' });
    // Three PITCH-HYD-214 events exist on WT-07; the open one is the selected occurrence.
    expect(result?.occurrences?.previousCount).toBe(2);
    expect(result?.occurrences?.totalIncludingSelected).toBe(3);
    expect(result?.event?.id).toBe(CURRENT_EVENT);
  });

  it('passes the selected event id and anchor timestamp to the counting statement', async () => {
    const db = createFakeDatabase();
    await retrieveEvidence(db, { ...base, intent: 'HISTORY', question: 'Has this happened before?' });
    const counting = db.calls.find((call) => call.sql.includes('previous_count'));
    expect(counting?.values[0]).toBe(WT07);
    expect(counting?.values[1]).toBe(EVENT_CODE);
    expect(counting?.values[2]).toBe(CURRENT_EVENT);
    expect(counting?.values[3]).toBe('2026-09-09T08:20:00.000Z');
  });

  it('reports the exact first and last previous timestamps and their provenance', async () => {
    const db = createFakeDatabase();
    const result = await retrieveEvidence(db, { ...base, intent: 'HISTORY', question: 'Has this happened before?' });
    expect(result?.occurrences?.firstAt).toBe('2026-07-03T08:00:00.000Z');
    expect(result?.occurrences?.lastAt).toBe('2026-08-15T10:00:00.000Z');
    expect(result?.occurrences?.byOrigin).toEqual({ synthetic_demo: 2 });
  });

  it('never returns the current occurrence as history evidence', async () => {
    const db = createFakeDatabase();
    const result = await retrieveEvidence(db, { ...base, intent: 'HISTORY', question: 'Has this happened before?' });
    const history = result?.evidence.filter((item) => item.role === 'SAME_ASSET_HISTORY' && item.kind === 'ASSET_EVENT') ?? [];
    expect(history).toHaveLength(2);
    expect(history.some((item) => item.timestamp === '2026-09-09T08:20:00.000Z')).toBe(false);
  });

  it('returns null for an unknown asset instead of guessing', async () => {
    const db = createFakeDatabase();
    expect(await retrieveEvidence(db, { ...base, assetCode: 'WT-99', intent: 'HISTORY', question: 'x' })).toBeNull();
  });
});

describe('PREVIOUS_RESOLUTION retrieval', () => {
  it('returns linked previous resolutions and work orders for the asset and event code', async () => {
    const db = createFakeDatabase();
    const result = await retrieveEvidence(db, { ...base, intent: 'PREVIOUS_RESOLUTION', question: 'How was it solved previously?' });
    const kinds = new Set(result?.evidence.map((item) => item.kind));
    expect(kinds.has('RESOLUTION')).toBe(true);
    expect(kinds.has('WORK_ORDER')).toBe(true);
    expect(kinds.has('INCIDENT')).toBe(true);
  });

  it('finds a resolution logged after the selected event, which is the machine-memory loop', async () => {
    const db = createFakeDatabase({
      extraResolutions: [{
        id: 'r-new', asset_id: WT07, event_code: EVENT_CODE, root_cause: 'Session-entered cause',
        resolution_summary: 'Session-entered outcome', component: 'Pitch accumulator', downtime_minutes: 30,
        notes: '', validated: true, created_at: '2026-09-10T09:00:00.000Z', record_origin: 'user_demo',
      }],
    });
    const result = await retrieveEvidence(db, { ...base, intent: 'PREVIOUS_RESOLUTION', question: 'How was it solved previously?' });
    const fresh = result?.evidence.find((item) => item.excerpt.includes('Session-entered outcome'));
    expect(fresh).toBeDefined();
    expect(fresh?.recordOrigin).toBe('user_demo');
  });

  it('keeps user-entered records labelled as demonstration data, never as authority', async () => {
    const db = createFakeDatabase({
      extraResolutions: [{
        id: 'r-new', asset_id: WT07, event_code: EVENT_CODE, root_cause: 'c', resolution_summary: 'Session-entered outcome',
        component: 'x', downtime_minutes: 1, notes: '', validated: true, created_at: '2026-09-10T09:00:00.000Z', record_origin: 'user_demo',
      }],
    });
    const result = await retrieveEvidence(db, { ...base, intent: 'PREVIOUS_RESOLUTION', question: 'How was it solved previously?' });
    const fresh = result?.evidence.find((item) => item.excerpt.includes('Session-entered outcome'));
    expect(fresh?.authorityClass).toBe('HISTORICAL');
    expect(fresh?.procedural).toBe(false);
  });
});

describe('SIMILAR_INCIDENTS retrieval', () => {
  it('excludes the selected asset from fleet matches', async () => {
    const db = createFakeDatabase();
    const result = await retrieveEvidence(db, { ...base, intent: 'SIMILAR_INCIDENTS', question: 'Find similar fleet cases' });
    const fleet = result?.evidence.filter((item) => item.role === 'FLEET_EXACT_CODE') ?? [];
    expect(fleet.length).toBeGreaterThan(0);
    expect(fleet.every((item) => item.assetCode !== 'WT-07')).toBe(true);
    expect(result?.fleetAssetCodes).toEqual(['WT-03']);
    const fleetCall = db.calls.find((call) => call.sql.includes('join public.assets a on a.id = e.asset_id'));
    expect(fleetCall?.values[1]).toBe(WT07);
  });

  it('labels semantically similar narratives separately from exact code matches', async () => {
    const db = createFakeDatabase();
    const result = await retrieveEvidence(db, {
      ...base, intent: 'SIMILAR_INCIDENTS', question: 'Find similar fleet cases', embedding: new Array(1536).fill(0.01),
    });
    const roles = new Set(result?.evidence.map((item) => item.role));
    expect(roles.has('FLEET_EXACT_CODE')).toBe(true);
    expect(roles.has('FLEET_SEMANTIC')).toBe(true);
  });

  it('reports honestly when no other asset has recorded the code', async () => {
    const db = createFakeDatabase({ assetCodes: ['WT-07', 'WT-03'] });
    const result = await retrieveEvidence(db, { ...base, assetCode: 'WT-03', intent: 'SIMILAR_INCIDENTS', question: 'similar cases' });
    const fleetCall = db.calls.find((call) => call.sql.includes('join public.assets a on a.id = e.asset_id'));
    expect(fleetCall?.values[1]).toBe(WT03);
    expect(result?.fleetAssetCodes).toEqual(['WT-07']);
  });
});

describe('RECENT_CHANGES retrieval', () => {
  it('uses a bounded window of exactly 30 days ending at the selected occurrence', async () => {
    const db = createFakeDatabase();
    const result = await retrieveEvidence(db, { ...base, intent: 'RECENT_CHANGES', question: 'What changed recently?' });
    expect(result?.recentWindow?.endIso).toBe('2026-09-09T08:20:00.000Z');
    expect(result?.recentWindow?.startIso).toBe('2026-08-10T08:20:00.000Z');
    const span = new Date(result!.recentWindow!.endIso).getTime() - new Date(result!.recentWindow!.startIso).getTime();
    expect(span).toBe(RECENT_CHANGE_WINDOW_DAYS * 86_400_000);
  });

  it('excludes records outside the window and orders the rest newest first', async () => {
    const db = createFakeDatabase();
    const result = await retrieveEvidence(db, { ...base, intent: 'RECENT_CHANGES', question: 'What changed recently?' });
    const changes = result?.evidence.filter((item) => item.role === 'RECENT_CHANGE') ?? [];
    expect(changes.some((item) => item.excerpt.includes('well outside the change window'))).toBe(false);
    const timestamps = changes.map((item) => new Date(item.timestamp ?? 0).getTime());
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });
});

describe('TECHNICAL_GUIDANCE retrieval', () => {
  it('filters knowledge to reviewed public references with acceptable authority', async () => {
    const db = createFakeDatabase();
    await retrieveEvidence(db, { ...base, intent: 'TECHNICAL_GUIDANCE', question: 'Show technical guidance' });
    const knowledgeCall = db.calls.find((call) => call.sql.includes('from public.document_chunks c'));
    expect(knowledgeCall?.values[0]).toEqual(['OEM', 'REGULATOR', 'RESEARCH']);
    expect(knowledgeCall?.values[2]).toEqual(['public_data', 'public_reference']);
    expect(knowledgeCall?.values[3]).toBe('wind_turbine');
  });

  it('never marks synthetic or user records as quotable guidance', async () => {
    const db = createFakeDatabase();
    const result = await retrieveEvidence(db, { ...base, intent: 'TECHNICAL_GUIDANCE', question: 'Show technical guidance' });
    const procedural = result?.evidence.filter((item) => item.procedural) ?? [];
    expect(procedural.length).toBeGreaterThan(0);
    expect(procedural.every((item) => ['public_data', 'public_reference'].includes(item.recordOrigin))).toBe(true);
    const demo = result?.evidence.filter((item) => item.recordOrigin === 'synthetic_demo') ?? [];
    expect(demo.every((item) => item.procedural === false)).toBe(true);
  });

  it('demotes historical maintenance to context rather than procedural authority', async () => {
    const db = createFakeDatabase();
    const result = await retrieveEvidence(db, { ...base, intent: 'TECHNICAL_GUIDANCE', question: 'Show technical guidance' });
    const workOrder = result?.evidence.find((item) => item.kind === 'WORK_ORDER');
    expect(workOrder?.role).toBe('CONTEXT');
  });

  it('states plainly when no reviewed public reference is ingested', async () => {
    const db = createFakeDatabase({ knowledge: [] });
    const result = await retrieveEvidence(db, { ...base, intent: 'TECHNICAL_GUIDANCE', question: 'Show technical guidance' });
    expect(result?.notes.some((note) => note.includes('No reviewed public technical reference'))).toBe(true);
  });
});
