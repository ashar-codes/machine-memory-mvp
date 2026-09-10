// Real retrieval and synthesis against PostgreSQL; read-only, no provider quota.
import assert from 'node:assert/strict';
import { readConfig } from '../../backend/src/config.js';
import { createPool } from '../../backend/src/db.js';
import { classifyIntent } from '../../backend/src/copilot.js';
import { investigate } from '../../backend/src/investigate.js';
import { retrieveEvidence } from '../../backend/src/retrieval.js';
import { validateCitations } from '../../backend/src/rag.js';

const pool = createPool(readConfig().databaseUrl);
try {
  assert.ok(pool, 'Database configuration required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const expected = await client.query(`select occurred_at, description from public.maintenance_events
      where asset_id=(select id from public.assets where asset_code='WT-07')
      order by occurred_at desc limit 1`);
    const latest: unknown = expected.rows[0]?.occurred_at;
    assert.ok(latest instanceof Date);
    assert.equal(latest.toISOString().slice(0, 10), '2026-09-07');
    for (const question of ['What changed recently before this event?',
      'What changed before this fault?', 'What maintenance happened before this?',
      ...[7, 30, 90].map((days) => `What changed in the last ${days} days?`)]) {
      const input = { assetCode: 'WT-07', eventCode: 'PITCH-HYD-214', question, intent: classifyIntent(question) };
      assert.equal(input.intent, 'RECENT_CHANGES');
      const retrieved = await retrieveEvidence(client, { ...input, embedding: null });
      assert.ok(retrieved?.recentWindow);
      const days = Number(/last (\d+)/.exec(question)?.[1] ?? 30);
      assert.equal(Date.parse(retrieved.recentWindow.endIso) - Date.parse(retrieved.recentWindow.startIso), days * 86_400_000);
      assert.equal(retrieved.evidence.find((item) => item.kind === 'MAINTENANCE')?.timestamp, latest.toISOString());
      const response = await investigate(input, { db: client });
      assert.equal(response.status, 'ok');
      if (response.status !== 'ok') throw new Error('No answer');
      assert.match(JSON.stringify(response.response.answer), /2026-09-07/);
      assert.ok(response.response.evidence.some((item) => item.excerpt === expected.rows[0].description));
      validateCitations(response.response.answer, response.response.evidence);
    }
    console.log(JSON.stringify({ passed: true, readOnly: true, cases: 6, latestInspection: latest.toISOString() }));
  } finally { await client.query('ROLLBACK').catch(() => undefined); client.release(); }
} catch {
  console.error('Read-only recent-change verification failed; database details suppressed.');
  process.exitCode = 1;
} finally { await pool?.end(); }
