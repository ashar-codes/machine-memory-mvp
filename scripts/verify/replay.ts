// Real PostgreSQL replay identity, including conflicting asset/payload. Always rolled back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../../backend/src/config.js';
import { createPool } from '../../backend/src/db.js';
import { recordEvent } from '../../backend/src/events.js';
const pool = createPool(readConfig().databaseUrl);
try {
  assert.ok(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const input = { assetCode: 'WT-07', eventCode: 'VERIFY-REPLAY', title: 'Verification event', severity: 'warning',
      occurredAt: new Date().toISOString(), recordOrigin: 'simulation' as const,
      source: `VERIFY-REPLAY-${randomUUID()}`, externalEventId: 'same-id' };
    const first = await recordEvent(client, input);
    assert.equal(first.status, 'created');
    const replay = await recordEvent(client, { ...input, assetCode: 'PEN-T01', title: 'Conflicting title', severity: 'critical', eventCode: 'DIFFERENT' });
    assert.equal(replay.status, 'duplicate');
    if (first.status === 'created' && replay.status === 'duplicate') assert.deepEqual(replay.event, { ...first.event, asset_code: input.assetCode });
    const count = await client.query('select count(*)::int n from public.asset_events where event_source=$1', [input.source]);
    assert.equal(count.rows[0].n, 1);
    console.log('PASS: conflicting replay returns original persisted asset and all event fields; exactly one row.');
  } finally { await client.query('ROLLBACK'); client.release(); }
  console.log('Replay fixture and derived status changes rolled back.');
} catch {
  console.error('Replay verification failed; database details suppressed.'); process.exitCode = 1;
} finally { await pool?.end(); }
