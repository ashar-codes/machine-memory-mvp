// Real local HTTP + PostgreSQL race. Requires idle demo; refuses reset over other user data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { readConfig } from '../../backend/src/config.js';
import { createPool } from '../../backend/src/db.js';
const pool = createPool(readConfig().databaseUrl);
const marker = `VERIFY-CSV-${randomUUID()}`;
const origins = ['user_demo', 'user_import', 'simulation'];
const tables = ['sites', 'assets', 'components', 'asset_events', 'incidents', 'work_orders',
  'maintenance_events', 'technician_notes', 'documents', 'document_chunks', 'investigations', 'resolutions', 'data_sources'];
try {
  assert.ok(pool);
  const snapshot = async () => {
    const result = [];
    for (const table of tables) result.push({ table, rows: (await pool.query(`select record_origin,count(*)::int n,
      md5(string_agg(to_jsonb(t)::text,'|' order by id)) fingerprint from public.${table} t
      where record_origin in ('public_data','public_reference','synthetic_demo') group by record_origin order by record_origin`)).rows });
    return result;
  };
  const before = await snapshot();
  for (const table of tables) assert.equal((await pool.query(`select 1 from public.${table} where record_origin=any($1) limit 1`, [origins])).rowCount, 0, 'Existing user data; refusing test');
  assert.equal((await pool.query('select 1 from public.import_batches limit 1')).rowCount, 0);
  const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:3001/api${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
  });
  try {
    assert.equal((await post('/assets', { assetCode: marker, siteName: marker })).status, 201);
    const form = new FormData(); form.set('importType', 'EVENT_LOG');
    form.set('file', new Blob([`asset_code,event_code,title,occurred_at\n${marker},VERIFY-1,Verification only,2026-09-01T12:00:00Z\n`]), `${marker}.csv`);
    const previewResponse = await fetch('http://127.0.0.1:3001/api/import/preview', { method: 'POST', body: form });
    assert.equal(previewResponse.status, 200);
    const preview = z.object({ dataSourceId: z.string().uuid(), unmappedRequired: z.array(z.string()) }).parse(await previewResponse.json());
    assert.deepEqual(preview.unmappedRequired, []);
    const body = { dataSourceId: preview.dataSourceId, importType: 'EVENT_LOG', simulation: false,
      mapping: { asset_code: 'asset_code', event_code: 'event_code', title: 'title', occurred_at: 'occurred_at' } };
    const results = await Promise.all([post('/import/commit', body), post('/import/commit', body)]);
    const statuses = results.map((response) => response.status).sort();
    const counts = await pool.query(`select count(*)::int n, min(description) description from public.asset_events
      where asset_id=(select id from public.assets where asset_code=$1)`, [marker]);
    console.log(JSON.stringify({ statuses, persistedEvents: counts.rows[0].n }));
    assert.deepEqual(statuses, [201, 409]);
    assert.equal(counts.rows[0].n, 1); assert.equal(counts.rows[0].description, '');
    assert.equal((await post('/import/commit', body)).status, 409, 'Response-loss retry must report already committed');
    assert.equal((await pool.query('select count(*)::int n from public.import_batches where data_source_id=$1', [preview.dataSourceId])).rows[0].n, 1);
    console.log('PASS: preview/optional-description commit, concurrent single import and response-loss retry.');
  } finally {
    for (const table of tables.filter((name) => !['sites', 'assets', 'asset_events', 'data_sources'].includes(name))) {
      assert.equal((await pool.query(`select 1 from public.${table} where record_origin=any($1) limit 1`, [origins])).rowCount, 0, 'Other user data appeared; refusing reset');
    }
    for (const [table, column, value] of [['sites', 'name', marker], ['assets', 'asset_code', marker], ['data_sources', 'name', `${marker}.csv`]]) {
      assert.equal((await pool.query(`select 1 from public.${table} where record_origin=any($1) and ${column}<>$2`, [origins, value])).rowCount, 0);
    }
    assert.equal((await pool.query(`select 1 from public.asset_events e join public.assets a on a.id=e.asset_id
      where e.record_origin=any($1) and a.asset_code<>$2`, [origins, marker])).rowCount, 0);
    assert.equal((await pool.query(`select 1 from public.import_batches b join public.data_sources d on d.id=b.data_source_id where d.name<>$1`, [`${marker}.csv`])).rowCount, 0);
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/data/demo-reset.ts', '--include-imports'], { stdio: 'pipe' });
    assert.deepEqual(await snapshot(), before);
    console.log('Existing safe reset completed; protected fingerprints unchanged.');
  }
} catch {
  console.error('CSV concurrency verification failed; inspect test records if cleanup was refused. Credentials suppressed.');
  process.exitCode = 1;
} finally { await pool?.end(); }
