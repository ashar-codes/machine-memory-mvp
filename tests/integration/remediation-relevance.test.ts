import { describe, expect, it } from 'vitest';
import { fuseEvidence } from '../../backend/src/evidence.js';
import { retrieveEvidence } from '../../backend/src/retrieval.js';
import { createFakeDatabase } from './fakeDatabase.js';

describe('relevance precedes reference authority', () => {
  it('ranks highly relevant research above weakly relevant regulator evidence', async () => {
    const result = (await retrieveEvidence(createFakeDatabase(), { assetCode: 'WT-07', intent: 'TECHNICAL_GUIDANCE',
      question: 'drivetrain reliability', embedding: null }))!;
    result.evidence = result.evidence.filter((item) => item.kind === 'KNOWLEDGE').map((item) => ({ ...item,
      similarity: item.authorityClass === 'REGULATOR' ? 0.61 : 0.8, keywordRank: 0.1 }));
    expect(fuseEvidence(result).raw[0]?.authorityClass).toBe('RESEARCH');
  });
  it('does not substitute asset history when a general question has no machine context', async () => {
    const db = createFakeDatabase();
    await retrieveEvidence(db, { assetCode: 'WT-07', intent: 'GENERAL', question: 'how to make sourdough bread', embedding: null });
    expect(db.calls.some((call) => call.sql.includes('previous_count') || call.sql.includes(') changes')
      || call.sql.includes('from public.work_orders'))).toBe(false);
  });
});
