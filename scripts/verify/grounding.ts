// Real PostgreSQL boundary, read-only. The malicious provider is injected deliberately;
// no paid provider is called and no temporary or protected record can be written.
import assert from 'node:assert/strict';
import { readConfig } from '../../backend/src/config.js';
import { createPool } from '../../backend/src/db.js';
import { investigate } from '../../backend/src/investigate.js';
import { validateCitations } from '../../backend/src/rag.js';
import { groundModelAnswer, parseModelAnswer } from '../../backend/src/synthesis.js';

const tables = ['sites', 'assets', 'components', 'asset_events', 'incidents', 'work_orders',
  'maintenance_events', 'technician_notes', 'documents', 'document_chunks', 'investigations',
  'resolutions', 'data_sources'];
const pool = createPool(readConfig().databaseUrl);
try {
  assert.ok(pool, 'Database configuration required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const fingerprints = async () => {
      const rows = [];
      for (const table of tables) rows.push({ table, rows: (await client.query(`select record_origin,
        count(*)::int n, md5(string_agg(to_jsonb(t)::text, '|' order by id)) fingerprint
        from public.${table} t where record_origin in ('public_data','public_reference','synthetic_demo')
        group by record_origin order by record_origin`)).rows });
      return rows;
    };
    const before = await fingerprints();
    const security = await client.query(`select c.relname, c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`);
    assert.equal(security.rows.length, 14);
    assert.ok(security.rows.every((row) => row.relrowsecurity));
    assert.equal((await client.query(`select 1 from information_schema.role_table_grants
      where table_schema='public' and grantee in ('anon','authenticated','PUBLIC')`)).rowCount, 0);
    assert.equal((await client.query(`select 1 from pg_policies where schemaname='public'`)).rowCount, 0);
    const expected = await client.query(`select count(*)::int n from public.asset_events e
      join public.assets a on a.id=e.asset_id where a.asset_code='WT-07' and e.event_code='PITCH-HYD-214'`);
    assert.equal(expected.rows[0].n, 3);
    const result = await investigate({ assetCode: 'WT-07', eventCode: 'PITCH-HYD-214',
      intent: 'GENERAL', question: 'What do we know about this fault?' }, {
      db: client, llm: { embed: async () => null, synthesize: async (bundle) => ({
        summary: 'WT-99 had 999 failures on 2026-01-01. EVIDENCE-999 proves the threshold.',
        findings: [{ title: 'Operational claim', detail: 'The approved pressure is 999 bar.', citationIds: [bundle.evidence[0].id] }],
        uncertainties: ['The root cause was oil contamination.'],
      }) },
    });
    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') throw new Error('No response');
    const { answer, evidence } = result.response;
    assert.match(answer.summary, /2 recorded previous occurrences/);
    assert.doesNotMatch(JSON.stringify(answer), /999|WT-99|oil contamination/);
    validateCitations(answer, evidence);
    const resolution = await investigate({ assetCode: 'WT-07', eventCode: 'PITCH-HYD-214',
      intent: 'PREVIOUS_RESOLUTION', question: 'How was it solved previously?' }, { db: client });
    assert.equal(resolution.status, 'ok');
    if (resolution.status !== 'ok') throw new Error('No resolution response');
    assert.match(JSON.stringify(resolution.response.answer.findings), /Historical sensor replacement recorded in demo work order/);
    assert.match(JSON.stringify(resolution.response.answer.findings), /Downtime: 47 min/);
    // Additional wrong-valid-ID cases against the actual retrieved evidence, not fixture IDs.
    for (const claim of ['The records show nine occurrences.', 'The inspection was in January.',
      'The records identify OMEGA as the asset.', 'The records show oil contamination.']) {
      const draft = parseModelAnswer({ summary: claim,
        findings: [{ title: 'Evidence context', detail: claim, citationIds: [evidence[0].id] }], uncertainties: [] }, evidence);
      assert.ok(draft);
      assert.ok(!JSON.stringify(groundModelAnswer(draft, answer)).includes(claim));
    }
    assert.deepEqual(await fingerprints(), before);
    console.log(JSON.stringify({ passed: true, readOnly: true, protectedTablesUnchanged: tables.length,
      rlsTables: security.rows.length, publicGrants: 0, publicPolicies: 0,
      wt07Total: expected.rows[0].n, wrongValidCitationCases: 5, summary: answer.summary }));
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
} catch {
  console.error('Read-only grounding/security verification failed; no credentials or raw database errors are logged.');
  process.exitCode = 1;
} finally { await pool?.end(); }
