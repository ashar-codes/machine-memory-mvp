// Actual CSV normalization and PostgreSQL constraints. All test inserts roll back together;
// no asset status updates, public-data writes, embeddings or generation calls.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../../backend/src/config.js';
import { createPool } from '../../backend/src/db.js';
import { commitImport } from '../../backend/src/imports.js';
import { fieldsFor, parseCsv, toTable } from '../../backend/src/tabular.js';
import { validateConfirmedMapping } from '../../backend/src/mapping.js';

const pool = createPool(readConfig().databaseUrl);
try {
  assert.ok(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const name = `VERIFY-OPTIONAL-${randomUUID()}`;
    const source = await client.query(`insert into public.data_sources(name,original_filename,source_type,record_origin,status)
      values($1,'verification.csv','EVENT_LOG','user_import','received') returning id`, [name]);
    for (const importType of ['EVENT_LOG', 'MAINTENANCE_HISTORY', 'WORK_ORDERS', 'TECHNICIAN_NOTES'] as const) {
      const columns = fieldsFor(importType).filter((field) => field.required).map((field) => field.field);
      const values: Record<string, string> = { asset_code: 'WT-07', event_code: 'OPTIONAL-VERIFY',
        title: name, occurred_at: '2026-09-01T12:00:00Z', event_type: 'inspection', summary: name, content: name };
      const table = toTable(parseCsv(`${columns.join(',')}\n${columns.map((column) => values[column]).join(',')}\n`));
      const mapping = validateConfirmedMapping(Object.fromEntries(columns.map((column) => [column, column])), columns, importType);
      assert.ok(mapping.ok);
      const batch = await client.query(`insert into public.import_batches(data_source_id,import_type,status)
        values($1,$2,'pending') returning id`, [source.rows[0].id, importType]);
      const report = await commitImport(client, { table, mapping: mapping.mapping, importType,
        batchId: batch.rows[0].id, recordOrigin: 'user_import' });
      assert.equal(report.rowsImported, 1); assert.equal(report.rowsRejected, 0);
      if (importType === 'EVENT_LOG') {
        const event = await client.query('select description,subsystem,cleared_at from public.asset_events where import_batch_id=$1', [batch.rows[0].id]);
        assert.equal(event.rows[0].description, '');
        assert.equal(event.rows[0].subsystem, null); assert.equal(event.rows[0].cleared_at, null);
      }
    }
    console.log('PASS: all four import types accept required-only CSVs against real PostgreSQL constraints.');
  } finally { await client.query('ROLLBACK'); client.release(); }
  console.log('All verification inserts rolled back; no persistent changes.');
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  console.error(`Optional-field verification failed (${ /^[0-9A-Z]{5}$/.test(code) ? code : 'assertion' }); database details suppressed.`);
  process.exitCode = 1;
} finally { await pool?.end(); }
