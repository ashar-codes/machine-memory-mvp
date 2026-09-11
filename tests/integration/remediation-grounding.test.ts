import { describe, expect, it } from 'vitest';
import { investigate } from '../../backend/src/investigate.js';
import { runFleetCopilot } from '../../backend/src/copilot.js';
import { createFakeDatabase } from './fakeDatabase.js';
import { validateCitations } from '../../backend/src/rag.js';

const qualitative = 'The records describe history rather than authorization to perform work.';
async function attack(detail: string, summary = detail) {
  const result = await investigate({ assetCode: 'WT-07', eventCode: 'PITCH-HYD-214', intent: 'GENERAL', question: 'What do we know about this fault?' }, {
    db: createFakeDatabase(), llm: {
      embed: async () => null,
      synthesize: async () => ({ summary, findings: [{ title: 'Evidence context', detail, citationIds: ['EV-1'] }], uncertainties: [] }),
    },
  });
  if (result.status !== 'ok') throw new Error('expected response');
  validateCitations(result.response.answer, result.response.evidence);
  return result.response;
}

describe('P1-03 exact operational facts are not generated', () => {
  it.each([
    'There were 999 previous occurrences.',
    'There were nine previous occurrences.',
    'The inspection happened on 2026-01-01.',
    'The inspection happened in January.',
    'The approved pressure threshold is 999 bar.',
    'This event belongs to WT-99.',
    'This event belongs to OTHER-ASSET.',
    'The root cause was oil contamination.',
    'The records show oil contamination.',
    'The records identify OMEGA as the asset.',
    'The sources are approved procedures.',
    'No records are available.',
    'The gearbox was replaced.',
    'Downtime was 999 minutes.',
    'Consult EVIDENCE-999.',
  ])('rejects a wrong claim despite a real EV-1 citation: %s', async (claim) => {
    const response = await attack(claim);
    expect(JSON.stringify(response.answer)).not.toContain(claim);
    expect(response.answer.summary).not.toContain('999');
    expect(response.answer.summary).toContain('2');
  });

  it('cannot hide a false fact in summary with an otherwise qualitative finding', async () => {
    const response = await attack(qualitative, 'WT-99 has 999 failures. EVIDENCE-999 proves this.');
    expect(response.answer.summary).not.toMatch(/WT-99|999/);
    expect(response.answer.findings.some((f) => f.detail === qualitative)).toBe(true);
  });

  it('retains supported qualitative synthesis alongside deterministic facts', async () => {
    const response = await attack(qualitative);
    expect(response.answer.findings.some((f) => f.detail === qualitative)).toBe(true);
    expect(response.answer.findings.some((f) => f.detail.includes('2 earlier occurrences'))).toBe(true);
  });

  it('renders recorded root cause/outcome/date directly even without a provider', async () => {
    const result = await investigate({ assetCode: 'WT-07', eventCode: 'PITCH-HYD-214', intent: 'PREVIOUS_RESOLUTION', question: 'How was it solved previously?' }, { db: createFakeDatabase() });
    if (result.status !== 'ok') throw new Error('expected response');
    const text = JSON.stringify(result.response.answer);
    expect(text).toContain('Synthetic sensor drift');
    expect(text).toContain('Historical sensor replacement recorded in demo work order.');
    expect(text).toContain('2026-08-15');
    expect(text).toContain('Downtime: 47 min');
    validateCitations(result.response.answer, result.response.evidence);
  });

  it('does not admit false exact facts through generated uncertainties', async () => {
    const result = await investigate({ assetCode: 'WT-07', intent: 'HISTORY', question: 'Has this happened before?' }, {
      db: createFakeDatabase(), llm: { embed: async () => null, synthesize: async () => ({ summary: qualitative,
        findings: [{ title: 'Evidence context', detail: qualitative, citationIds: ['EV-1'] }], uncertainties: ['Pressure should be 999 bar.'] }) },
    });
    expect(JSON.stringify(result)).not.toContain('999');
  });

  it('keeps fleet row facts deterministic rather than accepting an invented summary', async () => {
    const response = await runFleetCopilot('Which turbines have recurring faults?', {
      db: { query: async () => ({ rows: [{ asset_code: 'WT-07', event_code: 'PITCH-HYD-214', occurrences: 3,
        first_at: '2026-07-03T08:00:00Z', last_at: '2026-09-09T08:20:00Z', origins: ['synthetic_demo'], open_now: true }] }) },
      llm: { embed: async () => null, synthesize: async () => null,
        structured: async () => ({ summary: 'WT-99 has 999 failures.', findings: [{ title: 'Faults', detail: '999 failures.' }], uncertainties: ['Pressure 999 bar.'] }) },
    });
    expect(JSON.stringify(response.answer)).not.toMatch(/999|WT-99/);
    expect(JSON.stringify(response.answer)).toContain('WT-07');
  });
});
