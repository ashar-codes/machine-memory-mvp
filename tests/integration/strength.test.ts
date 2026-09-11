// Evidence strength as support for THIS question. Pure functions: no database, no provider.
//
// Strength used to be one formula over the whole bundle, which answered "how much authoritative
// material is present" rather than "how well is this question answered". Both reported failures
// came from that: six dated change records scored INSUFFICIENT because none of them was same-asset
// *history*, and a published-research question reached HIGH by counting unrelated machine history.
import { describe, expect, it } from 'vitest';
import type { Intent } from '@machine-memory/shared';
import { deriveSignals } from '../../backend/src/evidence.js';
import type { RawEvidence, RetrievalResult } from '../../backend/src/retrieval.js';
import { scoreEvidence, type EvidenceSignals } from '../../backend/src/rag.js';

const ASSET: RetrievalResult['asset'] = {
  id: 'asset-1', assetCode: 'PEN-T01', assetType: 'wind_turbine', manufacturer: 'Senvion',
  model: 'MM82', status: 'operational', siteId: 'site-1', recordOrigin: 'public_data',
};

function item(overrides: Partial<RawEvidence> & Pick<RawEvidence, 'kind' | 'role'>): RawEvidence {
  return {
    title: 't', excerpt: 'e', assetCode: 'PEN-T01', timestamp: '2023-02-01T00:00:00.000Z',
    recordOrigin: 'public_data', authorityClass: 'HISTORICAL', sourceType: overrides.kind,
    sourceUrl: null, similarity: null, keywordRank: null,
    applicability: { assetType: null, manufacturer: null, model: null }, procedural: false,
    ...overrides,
  };
}

const reference = (count: number, procedural = true) => Array.from({ length: count }, (_, i) => item({
  kind: 'KNOWLEDGE', role: 'TECHNICAL_REFERENCE', sourceType: 'TECHNICAL_REFERENCE', sourceId: `KNOWLEDGE:k-${i}`,
  recordOrigin: procedural ? 'public_reference' : 'user_import',
  authorityClass: procedural ? 'RESEARCH' : 'UNVERIFIED', procedural, assetCode: null, timestamp: null,
}));

const changes = (count: number, origin: RawEvidence['recordOrigin'] = 'public_data') =>
  Array.from({ length: count }, (_, i) => item({
    kind: 'WORK_ORDER', role: 'RECENT_CHANGE', sourceId: `WORK_ORDER:wo-${i}`, recordOrigin: origin,
  }));

const history = (count: number) => Array.from({ length: count }, (_, i) => item({
  kind: 'ASSET_EVENT', role: 'SAME_ASSET_HISTORY', sourceId: `ASSET_EVENT:e-${i}`,
}));

function strength(intent: Intent, retained: RawEvidence[], occurrences = 0) {
  const result = {
    intent, asset: ASSET, event: null, eventCode: 'PEN-100210',
    anchorAt: '2023-02-27T00:00:00.000Z', assetSummary: null, recentWindow: null,
    occurrences: occurrences
      ? { previousCount: occurrences, totalIncludingSelected: occurrences + 1, firstAt: null, lastAt: null, byOrigin: {} }
      : null,
    fleetAssetCodes: [], evidence: [], notes: [],
  } satisfies RetrievalResult;
  return { label: scoreEvidence(deriveSignals(result, retained)), signals: deriveSignals(result, retained) };
}

describe('strength reflects support for the question asked', () => {
  it('rates several dated change records as real support for a change question', () => {
    // The defect: change records carry the RECENT_CHANGE role, and the old formula only counted
    // same-asset *history*, so six retrieved maintenance records scored INSUFFICIENT.
    expect(strength('RECENT_CHANGES', changes(6)).label).toBe('HIGH');
  });

  it('rates a couple of change records as moderate, not strong', () => {
    expect(strength('RECENT_CHANGES', changes(2)).label).toBe('MODERATE');
  });

  it('never calls a change question strong on demo-only records', () => {
    expect(strength('RECENT_CHANGES', changes(6, 'synthetic_demo')).label).toBe('MODERATE');
  });

  it('scores a research question on its references alone', () => {
    expect(strength('TECHNICAL_GUIDANCE', reference(3)).label).toBe('HIGH');
    expect(strength('TECHNICAL_GUIDANCE', reference(1)).label).toBe('MODERATE');
  });

  it('does not let unrelated machine history strengthen a research question', () => {
    // The defect: history rows were worth four points, so a single loosely related passage plus a
    // busy turbine log reported HIGH support for a question about published literature.
    const thin = strength('TECHNICAL_GUIDANCE', reference(1)).label;
    const thinPlusHistory = strength('TECHNICAL_GUIDANCE', [...reference(1), ...history(8)], 40).label;
    expect(thinPlusHistory).toBe(thin);
  });

  it('does not let unrelated references strengthen a machine question', () => {
    const machineOnly = strength('HISTORY', history(4), 3).label;
    expect(strength('HISTORY', [...history(4), ...reference(4)], 3).label).toBe(machineOnly);
  });

  it('stays moderate when only an unreviewed uploaded source answers the question', () => {
    expect(strength('TECHNICAL_GUIDANCE', reference(4, false)).label).toBe('MODERATE');
  });

  it('reports insufficient when nothing retrieved answers the question', () => {
    expect(strength('TECHNICAL_GUIDANCE', []).label).toBe('INSUFFICIENT');
    expect(strength('HISTORY', []).label).toBe('INSUFFICIENT');
    // Retrieved, but only as background: a reference does not answer a history question.
    expect(strength('HISTORY', reference(3)).label).toBe('INSUFFICIENT');
  });

  it('keeps a thin machine question below moderate', () => {
    // One loose note on the asset: nothing matching the event, no recurrence, no resolution.
    const note = item({ kind: 'TECHNICIAN_NOTE', role: 'SAME_ASSET_HISTORY', sourceId: 'TECHNICIAN_NOTE:n-1' });
    expect(strength('HISTORY', [note]).label).toBe('INSUFFICIENT');
    // One record of the event itself on this exact asset is moderate support, not strong.
    expect(strength('HISTORY', history(1)).label).toBe('MODERATE');
  });

  it('rates a well-corroborated machine question highly', () => {
    const retained = [
      ...history(3),
      item({ kind: 'RESOLUTION', role: 'SAME_ASSET_HISTORY', sourceId: 'RESOLUTION:r-1' }),
      item({ kind: 'ASSET_EVENT', role: 'FLEET_EXACT_CODE', sourceId: 'ASSET_EVENT:f-1', assetCode: 'PEN-T02' }),
    ];
    expect(strength('HISTORY', retained, 12).label).toBe('HIGH');
  });

  it('refuses to score a negative occurrence count', () => {
    const broken = { ...strength('HISTORY', history(2), 1).signals, priorOccurrences: -1 } as EvidenceSignals;
    expect(() => scoreEvidence(broken)).toThrow('Invalid occurrence count');
  });

  it('is deterministic', () => {
    for (const intent of ['HISTORY', 'RECENT_CHANGES', 'TECHNICAL_GUIDANCE'] as Intent[]) {
      expect(strength(intent, changes(3)).label).toBe(strength(intent, changes(3)).label);
    }
  });
});
