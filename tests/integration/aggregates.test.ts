// Evidence identity, aggregate grounding and asset-wide summaries. No database, no provider.
import { describe, expect, it } from 'vitest';
import { MAX_EVIDENCE_ITEMS, deriveSignals, fuseEvidence } from '../../backend/src/evidence.js';
import type { RawEvidence, RetrievalResult } from '../../backend/src/retrieval.js';
import { deterministicAnswer } from '../../backend/src/synthesis.js';
import { validateCitations } from '../../backend/src/rag.js';

const ASSET: RetrievalResult['asset'] = {
  id: 'asset-1', assetCode: 'PEN-T01', assetType: 'wind_turbine', manufacturer: 'Senvion',
  model: 'MM82', status: 'operational', siteId: 'site-1', recordOrigin: 'public_data',
};

function evidenceItem(overrides: Partial<RawEvidence> & Pick<RawEvidence, 'kind' | 'role'>): RawEvidence {
  return {
    title: 'item', excerpt: 'text', assetCode: 'PEN-T01', timestamp: '2023-02-01T00:00:00.000Z',
    recordOrigin: 'public_data', authorityClass: 'HISTORICAL', sourceType: overrides.kind,
    sourceUrl: null, similarity: null, keywordRank: null,
    applicability: { assetType: null, manufacturer: null, model: null }, procedural: false,
    ...overrides,
  };
}

function result(overrides: Partial<RetrievalResult> = {}): RetrievalResult {
  return {
    intent: 'HISTORY', asset: ASSET, event: null, eventCode: 'PEN-100210',
    anchorAt: '2023-02-27T00:00:00.000Z', occurrences: null, assetSummary: null,
    recentWindow: null, fleetAssetCodes: [], evidence: [], notes: [], ...overrides,
  };
}

describe('evidence identity', () => {
  it('counts one record once, however many roles retrieved it', () => {
    // The defect: fingerprinting included the role, so one work order under two roles became two
    // evidence items and an answer reported four maintenance records where the database held two.
    const workOrder = evidenceItem({ kind: 'WORK_ORDER', role: 'SAME_ASSET_HISTORY', sourceId: 'WORK_ORDER:wo-1' });
    const sameOrderOtherRole = evidenceItem({ kind: 'WORK_ORDER', role: 'RECENT_CHANGE', sourceId: 'WORK_ORDER:wo-1' });
    const { raw } = fuseEvidence(result({ evidence: [workOrder, sameOrderOtherRole] }));
    expect(raw).toHaveLength(1);
  });

  it('counts one resolution once across roles', () => {
    const resolution = evidenceItem({ kind: 'RESOLUTION', role: 'SAME_ASSET_HISTORY', sourceId: 'RESOLUTION:r-1' });
    const { raw } = fuseEvidence(result({ evidence: [resolution, { ...resolution, role: 'CONTEXT' }] }));
    expect(raw).toHaveLength(1);
  });

  it('keeps two genuinely different records', () => {
    const first = evidenceItem({ kind: 'MAINTENANCE', role: 'RECENT_CHANGE', sourceId: 'MAINTENANCE:m-1' });
    const second = evidenceItem({ kind: 'MAINTENANCE', role: 'RECENT_CHANGE', sourceId: 'MAINTENANCE:m-2' });
    expect(fuseEvidence(result({ evidence: [first, second] })).raw).toHaveLength(2);
  });

  it('collapses one chunk reached by both keyword and vector search', () => {
    const chunk = evidenceItem({
      kind: 'KNOWLEDGE', role: 'TECHNICAL_REFERENCE', sourceId: 'KNOWLEDGE:c-1',
      sourceKey: 'NREL report', similarity: 0.8,
    });
    const sameChunkByKeyword = { ...chunk, similarity: null, keywordRank: 0.5 };
    expect(fuseEvidence(result({ evidence: [chunk, sameChunkByKeyword] })).raw).toHaveLength(1);
  });

  it('keeps the higher-ranked role when the same record arrives twice', () => {
    const primary = evidenceItem({ kind: 'WORK_ORDER', role: 'SAME_ASSET_HISTORY', sourceId: 'WORK_ORDER:wo-9' });
    const contextual = { ...primary, role: 'CONTEXT' as const };
    const { raw } = fuseEvidence(result({ intent: 'HISTORY', evidence: [contextual, primary] }));
    expect(raw[0].role).toBe('SAME_ASSET_HISTORY');
  });

  it('does not merge distinct records that merely share wording', () => {
    const a = evidenceItem({ kind: 'ASSET_EVENT', role: 'SAME_ASSET_HISTORY', sourceId: 'ASSET_EVENT:e-1', excerpt: 'identical text' });
    const b = evidenceItem({ kind: 'ASSET_EVENT', role: 'SAME_ASSET_HISTORY', sourceId: 'ASSET_EVENT:e-2', excerpt: 'identical text' });
    expect(fuseEvidence(result({ evidence: [a, b] })).raw).toHaveLength(2);
  });
});

describe('aggregate evidence survives the candidate cap', () => {
  const aggregate = evidenceItem({
    kind: 'AGGREGATE', role: 'AGGREGATE_FACT', sourceId: 'AGGREGATE:recurrence:asset-1:PEN-100210',
    title: 'Recurrence total', excerpt: 'PEN-100210 has 71 recorded occurrences on PEN-T01.',
  });
  const samples = Array.from({ length: 40 }, (_, index) => evidenceItem({
    kind: 'ASSET_EVENT', role: 'SAME_ASSET_HISTORY', sourceId: `ASSET_EVENT:e-${index}`,
  }));

  it('is retained even when far more samples compete for slots', () => {
    // Ranked as an ordinary candidate the aggregate scored below the rows it summarises and was
    // pushed out, leaving the exact total with nothing citable behind it.
    const { raw, evidence } = fuseEvidence(result({ evidence: [...samples, aggregate] }));
    expect(raw.some((item) => item.role === 'AGGREGATE_FACT')).toBe(true);
    expect(evidence.length).toBeLessThanOrEqual(MAX_EVIDENCE_ITEMS);
  });

  it('is presented first, so an exact figure cites the first record shown', () => {
    const { raw } = fuseEvidence(result({ evidence: [...samples, aggregate] }));
    expect(raw[0].role).toBe('AGGREGATE_FACT');
  });

  it('never claims procedural authority', () => {
    const { raw } = fuseEvidence(result({ evidence: [aggregate] }));
    expect(raw[0].procedural).toBe(false);
    const signals = deriveSignals(result({ evidence: [aggregate] }), raw);
    expect(signals.authoritativeTechnical).toBe(false);
    expect(signals.authoritativeSafety).toBe(false);
  });
});

describe('exact totals cite evidence containing the total', () => {
  const aggregate = evidenceItem({
    kind: 'AGGREGATE', role: 'AGGREGATE_FACT', sourceId: 'AGGREGATE:recurrence:asset-1:PEN-100210',
    title: 'Recurrence total for PEN-100210 on PEN-T01',
    excerpt: 'PEN-100210 has 71 recorded occurrences on PEN-T01, of which 70 are previous to the selected occurrence.',
  });
  const sample = evidenceItem({ kind: 'ASSET_EVENT', role: 'SAME_ASSET_HISTORY', sourceId: 'ASSET_EVENT:e-1' });

  it('cites the aggregate for a recurrence total, not only sample rows', () => {
    const retrieval = result({
      evidence: [aggregate, sample],
      occurrences: { previousCount: 70, totalIncludingSelected: 71, firstAt: '2023-02-01T00:00:00.000Z', lastAt: '2023-02-26T00:00:00.000Z', byOrigin: {} },
    });
    const { evidence, raw } = fuseEvidence(retrieval);
    const answer = deterministicAnswer(retrieval, evidence, raw);
    const recurrence = answer.findings.find((finding) => /recurrence/i.test(finding.title));
    expect(recurrence).toBeDefined();
    const aggregateId = evidence.find((item) => item.sourceType === 'AGGREGATE')!.id;
    expect(recurrence!.citationIds).toContain(aggregateId);
    // And the cited record actually contains the number the finding states.
    const cited = evidence.find((item) => item.id === aggregateId)!;
    expect(cited.excerpt).toContain('71');
    expect(cited.excerpt).toContain('70');
  });

  it('produces an asset-wide summary from computed totals, not from samples', () => {
    const summaryAggregate = evidenceItem({
      kind: 'AGGREGATE', role: 'AGGREGATE_FACT', sourceId: 'AGGREGATE:asset-summary:asset-1',
      title: 'Recorded event totals for PEN-T01',
      excerpt: 'PEN-T01 has 576 recorded events across 23 distinct event codes.',
    });
    const retrieval = result({
      evidence: [summaryAggregate, sample],
      assetSummary: {
        totalEvents: 576, distinctEventCodes: 23,
        firstAt: '2023-01-01T04:20:33.000Z', lastAt: '2023-02-27T07:36:51.000Z',
        topCodes: [{ eventCode: 'PEN-100130', occurrences: 78, title: 'Automatic start-up' }],
      },
    });
    const { evidence, raw } = fuseEvidence(retrieval);
    const answer = deterministicAnswer(retrieval, evidence, raw);
    expect(answer.summary).toContain('576');
    expect(answer.summary).toContain('23');
    const totals = answer.findings.find((finding) => /totals/i.test(finding.title))!;
    expect(totals.citationIds.length).toBeGreaterThan(0);
    const cited = evidence.find((item) => item.id === totals.citationIds[0])!;
    expect(cited.excerpt).toContain('576');
    // The whole answer must still be citable.
    expect(() => validateCitations({ ...answer, evidenceStrength: 'MODERATE', safetyStatus: 'NORMAL' }, evidence)).not.toThrow();
  });

  it('reports a retrieved maintenance sample as a sample, never as a total', () => {
    const workOrder = evidenceItem({ kind: 'WORK_ORDER', role: 'SAME_ASSET_HISTORY', sourceId: 'WORK_ORDER:wo-1' });
    const resolution = evidenceItem({ kind: 'RESOLUTION', role: 'SAME_ASSET_HISTORY', sourceId: 'RESOLUTION:r-1' });
    const retrieval = result({ evidence: [workOrder, resolution] });
    const { evidence, raw } = fuseEvidence(retrieval);
    const answer = deterministicAnswer(retrieval, evidence, raw);
    const maintenance = answer.findings.find((finding) => /maintenance/i.test(finding.title));
    expect(maintenance?.detail).toMatch(/retrieved sample, not a total/i);
    // Two underlying records, reported as two.
    expect(maintenance?.detail).toMatch(/\b2 retrieved maintenance records\b/);
  });
});

describe('an answer reports what the retrieved sources say', () => {
  const chunk = (overrides: Partial<RawEvidence>): RawEvidence => evidenceItem({
    kind: 'KNOWLEDGE', role: 'TECHNICAL_REFERENCE', sourceType: 'TECHNICAL_REFERENCE',
    recordOrigin: 'public_reference', authorityClass: 'RESEARCH', procedural: true,
    assetCode: null, timestamp: null, ...overrides,
  });

  it('quotes the reference instead of announcing that one exists', () => {
    // The defect: every reference question answered "Reviewed public reference material was
    // retrieved", which states nothing the reader could act on or check.
    const retrieval = result({
      intent: 'TECHNICAL_GUIDANCE',
      evidence: [chunk({
        sourceId: 'KNOWLEDGE:c-1', sourceKey: 'NREL drivetrain report', title: 'NREL drivetrain report — Introduction',
        excerpt: 'Gearbox and generator failures dominate wind plant downtime.',
      })],
    });
    const { evidence, raw } = fuseEvidence(retrieval);
    const answer = deterministicAnswer(retrieval, evidence, raw);
    const finding = answer.findings.find((entry) => /reference/i.test(entry.title))!;
    expect(finding.detail).toContain('Gearbox and generator failures dominate wind plant downtime.');
    expect(finding.detail).toMatch(/does not authorize work/i);
    expect(finding.citationIds.length).toBeGreaterThan(0);
    expect(() => validateCitations({ ...answer, evidenceStrength: 'MODERATE', safetyStatus: 'NORMAL' }, evidence)).not.toThrow();
  });

  it('counts one document once, however many of its passages were retrieved', () => {
    const passages = Array.from({ length: 5 }, (_, index) => chunk({
      sourceId: `KNOWLEDGE:c-${index}`, sourceKey: 'NREL drivetrain report',
      title: `NREL drivetrain report — section ${index}`, excerpt: `passage ${index}`,
    }));
    const retrieval = result({ intent: 'TECHNICAL_GUIDANCE', evidence: passages });
    const { evidence, raw } = fuseEvidence(retrieval);
    const answer = deterministicAnswer(retrieval, evidence, raw);
    expect(answer.summary).toContain('NREL drivetrain report');
    expect(answer.summary).not.toMatch(/\d+ sources/);
    const finding = answer.findings.find((entry) => /reference/i.test(entry.title))!;
    // One quotation from the one document, not the same title restated per passage.
    expect(finding.detail.match(/NREL drivetrain report/g)).toHaveLength(1);
  });
});
