// Live Gemini query embeddings + read-only PostgreSQL retrieval. No generation calls or writes.
import assert from 'node:assert/strict';
import { readConfig } from '../../backend/src/config.js';
import { createPool } from '../../backend/src/db.js';
import { createLlm } from '../../backend/src/llm.js';
import { retrieveEvidence } from '../../backend/src/retrieval.js';
import { fuseEvidence } from '../../backend/src/evidence.js';
import { investigate } from '../../backend/src/investigate.js';
const config = readConfig();
const pool = createPool(config.databaseUrl);
const llm = createLlm({ apiKey: config.geminiApiKey, model: config.model,
  embeddingModel: config.embeddingModel, embeddingDimensions: config.embeddingDimensions });
try {
  assert.ok(pool && llm);
  for (const [question, expected] of [
    ['lockout tagout hazardous energy during wind turbine maintenance', 'REGULATOR'],
    ['wind turbine drivetrain reliability maintenance', 'RESEARCH'],
    ['gearbox durability and drivetrain maintenance', 'RESEARCH'],
    ['research on extending gearbox service life in wind farms', 'RESEARCH'],
    ['isolating hazardous energy before servicing wind power equipment', 'REGULATOR'],
    ['how to make sourdough bread', 'NONE'],
  ]) {
    const embedding = await llm.embed(question);
    assert.ok(embedding, 'Live embedding required');
    const result = await retrieveEvidence(pool, { assetCode: 'WT-07', intent: 'TECHNICAL_GUIDANCE', question, embedding });
    assert.ok(result);
    const fused = fuseEvidence(result);
    const references = fused.raw.filter((item) => item.kind === 'KNOWLEDGE');
    if (expected === 'NONE') {
      assert.equal(fused.raw.length, 0);
      const general = await investigate({ assetCode: 'WT-07', intent: 'GENERAL', question }, {
        db: pool, llm: { embed: async () => embedding, synthesize: async () => { throw new Error('Unexpected synthesis'); } },
      });
      assert.equal(general.status, 'ok');
      if (general.status === 'ok') {
        assert.equal(general.response.evidence.length, 0);
        assert.equal(general.response.answer.evidenceStrength, 'INSUFFICIENT');
      }
    } else {
      assert.equal(references[0]?.authorityClass, expected);
      assert.ok(references.slice(0, 3).filter((item) => item.authorityClass === expected).length >= 2);
    }
    console.log(JSON.stringify({ question, passed: true, admitted: references.length,
      top: references.slice(0, 3).map((item) => ({ source: item.sourceKey, similarity: item.similarity, authority: item.authorityClass })) }));
  }
} catch {
  console.error('Live relevance verification failed; provider/database details suppressed.'); process.exitCode = 1;
} finally { await pool?.end(); }
