import { describe, expect, it, vi } from 'vitest';
import { classifyIntent } from '../../backend/src/copilot.js';
import { investigate } from '../../backend/src/investigate.js';
import { retrieveEvidence } from '../../backend/src/retrieval.js';
import { createFakeDatabase, EVENT_CODE } from './fakeDatabase.js';

describe('recent-change remediation', () => {
  it.each(['What changed recently?', 'What changed recently before this event?',
    'What changed before this fault?', 'What maintenance happened before this?',
    'What changed in the last 7 days?', 'What changed in the last 30 days?',
    'What changed in the last 90 days?'])('classifies %s specifically', (question) => {
    expect(classifyIntent(question)).toBe('RECENT_CHANGES');
  });
  it.each([7, 30, 90])('retrieves exactly %i days and the latest inspection', async (days) => {
    const result = await retrieveEvidence(createFakeDatabase(), { assetCode: 'WT-07',
      eventCode: EVENT_CODE, intent: 'RECENT_CHANGES', embedding: null,
      question: `What changed in the last ${days} days?` });
    expect(result?.recentWindow).not.toBeNull();
    const window = result!.recentWindow!;
    expect(Date.parse(window.endIso) - Date.parse(window.startIso)).toBe(days * 86_400_000);
    const inspections = result!.evidence.filter((item) => item.kind === 'MAINTENANCE');
    expect(inspections[0]?.timestamp).toBe('2026-09-07T09:00:00.000Z');
    expect(inspections.some((item) => item.timestamp?.startsWith('2026-08-15'))).toBe(days !== 7);
  });
  it.each(['14 days', '2 weeks', 'seven days', '7 months', '7 days or 90 days'])('clarifies unsupported/ambiguous window %s without provider work', async (window) => {
    const embed = vi.fn(async () => null);
    const synthesize = vi.fn(async () => null);
    const result = await investigate({ assetCode: 'WT-07', intent: 'RECENT_CHANGES',
      question: `What changed in the last ${window}?` }, { db: createFakeDatabase(), llm: { embed, synthesize } });
    expect(embed).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.response.answer.summary).toMatch(/7, 30 or 90 days/);
    expect(result.response.answer.evidenceStrength).toBe('INSUFFICIENT');
    expect(result.response.evidence).toEqual([]);
  });
});
