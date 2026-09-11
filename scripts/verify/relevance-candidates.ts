// Real PostgreSQL candidate admission; all temporary rows roll back. No provider calls.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../../backend/src/config.js';
import { createPool } from '../../backend/src/db.js';
import { searchKnowledge } from '../../backend/src/retrieval.js';

const pool = createPool(readConfig().databaseUrl);
try {
  assert.ok(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const marker = `VERIFY-CANDIDATES-${randomUUID()}`;
    const document = await client.query(`insert into public.documents(title,organization,source_type,authority_class,record_origin)
      values($1,'Verification','TECHNICAL_REFERENCE','UNVERIFIED','user_import') returning id`, [marker]);
    await client.query(`insert into public.document_chunks(document_id,chunk_index,content,metadata,record_origin)
      select $1, i, case when i=250 then 'quartzneedle drivetrain inspection' else 'unrelated filler passage' end,
      jsonb_build_object('assetType',$2::text),'user_import' from generate_series(0,250) i`, [document.rows[0].id, marker]);
    const filter = { authorityClasses: ['UNVERIFIED'], sourceTypes: ['TECHNICAL_REFERENCE'],
      recordOrigins: ['user_import'], assetType: marker, manufacturer: null, model: null, role: 'TECHNICAL_REFERENCE' } as const;
    // Use a unique asset type to isolate the fixture without touching any existing data.
    const search = (question: string) => searchKnowledge(client, { ...filter,
      authorityClasses: [...filter.authorityClasses], sourceTypes: [...filter.sourceTypes], recordOrigins: [...filter.recordOrigins] }, question, null);
    const results = await search('quartzneedle drivetrain inspection');
    assert.equal(results.filter((item) => item.sourceKey === marker).length, 1);
    assert.equal(results.find((item) => item.sourceKey === marker)?.procedural, false);
    assert.equal((await search('sourdough bread')).filter((item) => item.sourceKey === marker).length, 0);
    console.log('PASS: relevant chunk 250 survives 251 candidates; unrelated text excluded; UNVERIFIED remains non-procedural.');
  } finally { await client.query('ROLLBACK'); client.release(); }
  console.log('All candidate fixtures rolled back.');
} catch {
  console.error('Candidate verification failed; database details suppressed.'); process.exitCode = 1;
} finally { await pool?.end(); }
