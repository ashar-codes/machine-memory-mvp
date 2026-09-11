// Real HTTP/PDF/Gemini/PostgreSQL boundary. Requires an idle demo with no user data.
// Cleanup uses the existing reset operator path, only after checking exclusive test ownership.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readConfig } from '../../backend/src/config.js';
import { createPool } from '../../backend/src/db.js';
import { pdfFixture } from '../../tests/integration/pdfFixture.js';

const tables = ['sites', 'assets', 'components', 'asset_events', 'incidents', 'work_orders',
  'maintenance_events', 'technician_notes', 'documents', 'document_chunks', 'investigations', 'resolutions', 'data_sources'];
const pool = createPool(readConfig().databaseUrl);
const marker = `VERIFY-PDF-${randomUUID()}`;
const origins = ['user_demo', 'user_import', 'simulation'];
let cleanupAllowed = false;
try {
  assert.ok(pool, 'Database required');
  const snapshot = async () => {
    const result = [];
    for (const table of tables) result.push({ table, rows: (await pool.query(`select record_origin,
      count(*)::int n, md5(string_agg(to_jsonb(t)::text,'|' order by id)) fingerprint from public.${table} t
      where record_origin in ('public_data','public_reference','synthetic_demo') group by record_origin order by record_origin`)).rows });
    return result;
  };
  const before = await snapshot();
  for (const table of tables) assert.equal((await pool.query(`select 1 from public.${table} where record_origin=any($1) limit 1`, [origins])).rowCount, 0, 'Existing user data; refusing reset-based verification');
  assert.equal((await pool.query('select 1 from public.import_batches limit 1')).rowCount, 0);
  cleanupAllowed = true;
  try {
    const upload = async (bytes: Buffer, filename: string) => {
      const form = new FormData();
      form.set('title', marker); form.set('organization', 'Remediation verification');
      form.set('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), filename);
      return fetch('http://127.0.0.1:3001/api/knowledge/upload', { method: 'POST', body: form, signal: AbortSignal.timeout(90_000) });
    };
    for (const [bytes, filename] of [[pdfFixture(), 'textless.pdf'], [Buffer.from('%PDF-1.4\ncorrupt'), 'corrupt.pdf'],
      [Buffer.from('not PDF'), 'fake.pdf']] as const) {
      assert.equal((await upload(bytes, filename)).status, 400);
    }
    const response = await upload(pdfFixture('A turbine drivetrain inspection narrative uploaded solely for verification. This unverified historical description is not an approved maintenance procedure.'), 'valid.pdf');
    assert.equal(response.status, 201, 'Real PDF upload failed');
    const report = z.object({ chunksCreated: z.number(), chunksEmbedded: z.number(),
      source: z.object({ id: z.string().uuid(), authorityClass: z.string(), recordOrigin: z.string() }) }).parse(await response.json());
    assert.equal(report.chunksCreated, 1);
    assert.equal(report.chunksEmbedded, 1, 'Embedding did not succeed; do not claim indexed');
    assert.equal(report.source.authorityClass, 'UNVERIFIED');
    assert.equal(report.source.recordOrigin, 'user_import');
    const stored = await pool.query(`select count(*)::int n, count(embedding)::int embedded
      from public.document_chunks where document_id=$1 and record_origin='user_import'`, [report.source.id]);
    assert.equal(stored.rows[0].n, 1); assert.equal(stored.rows[0].embedded, 1);
    console.log(JSON.stringify({ passed: true, validPdfChunks: 1, embedded: 1, rejectedInvalidPdfs: 3, authority: 'UNVERIFIED' }));
  } finally {
    // Refuse broad reset if another operator created any non-test data during the check.
    for (const table of tables.filter((name) => !['documents', 'document_chunks', 'data_sources'].includes(name))) {
      assert.equal((await pool.query(`select 1 from public.${table} where record_origin=any($1) limit 1`, [origins])).rowCount, 0, 'Other user data appeared; cleanup refused');
    }
    assert.equal((await pool.query(`select 1 from public.documents where record_origin=any($1) and title<>$2`, [origins, marker])).rowCount, 0);
    assert.equal((await pool.query(`select 1 from public.data_sources where record_origin=any($1) and name<>$2`, [origins, marker])).rowCount, 0);
    assert.equal((await pool.query('select 1 from public.import_batches limit 1')).rowCount, 0);
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/data/demo-reset.ts', '--include-imports'], { stdio: 'pipe' });
    assert.deepEqual(await snapshot(), before);
    console.log('Existing safe reset completed; protected fingerprints unchanged.');
  }
} catch {
  console.error(`PDF verification failed; credentials suppressed. ${cleanupAllowed ? 'Inspect verification records before retrying if cleanup was refused.' : 'No test writes were started.'}`);
  process.exitCode = 1;
} finally { await pool?.end(); }
