// Actual pgvector CASE boundary. Temporary user-import chunks are rolled back, never committed.
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
    const existing = await client.query(`select embedding::text,metadata from public.document_chunks
      where record_origin='public_reference' and embedding is not null limit 1`);
    assert.equal(existing.rowCount, 1);
    const vector = JSON.parse(existing.rows[0].embedding as string) as number[];
    const marker = `VERIFY-SPACE-${randomUUID()}`;
    const document = await client.query(`insert into public.documents(title,organization,source_type,authority_class,record_origin)
      values($1,'Verification','TECHNICAL_REFERENCE','UNVERIFIED','user_import') returning id`, [marker]);
    const variants = [
      { name: 'compatible', embeddingModel: 'gemini-embedding-001', embeddingDimensions: 1536, ingestionFormatVersion: 1 },
      { name: 'wrong-model', embeddingModel: 'other-model', embeddingDimensions: 1536, ingestionFormatVersion: 1 },
      { name: 'wrong-dimensions', embeddingModel: 'gemini-embedding-001', embeddingDimensions: 768, ingestionFormatVersion: 1 },
      { name: 'unknown-version', embeddingModel: 'gemini-embedding-001', embeddingDimensions: 1536, ingestionFormatVersion: 2 },
    ];
    for (const [index, metadata] of variants.entries()) {
      await client.query(`insert into public.document_chunks(document_id,chunk_index,content,section,embedding,metadata,record_origin)
        values($1,$2,'Turbine drivetrain inspection evidence',$3,$4::extensions.vector,$5::jsonb,'user_import')`,
      [document.rows[0].id, index, metadata.name, JSON.stringify(vector), JSON.stringify(metadata)]);
    }
    const results = await searchKnowledge(client, { authorityClasses: ['UNVERIFIED'], sourceTypes: ['TECHNICAL_REFERENCE'],
      recordOrigins: ['user_import'], assetType: 'wind_turbine', manufacturer: null, model: null, role: 'TECHNICAL_REFERENCE' }, 'Turbine drivetrain inspection', vector);
    const own = results.filter((item) => item.title.startsWith(marker));
    assert.equal(own.length, 4);
    for (const item of own) {
      if (item.title.endsWith(' — compatible')) assert.ok((item.similarity ?? 0) > 0.999);
      else assert.equal(item.similarity, null);
      assert.equal(item.authorityClass, 'UNVERIFIED');
    }
    const corpus = await client.query(`select count(*)::int n from public.document_chunks where record_origin='public_reference'
      and embedding is not null and metadata->>'embeddingModel'='gemini-embedding-001'
      and metadata->>'embeddingDimensions'='1536' and metadata->>'ingestionFormatVersion'='1'`);
    assert.equal(corpus.rows[0].n, 21);
    console.log('PASS: 21 corpus vectors compatible; wrong model/dimension/version use no cosine comparison, remain keyword evidence.');
  } finally { await client.query('ROLLBACK'); client.release(); }
  console.log('All temporary embedding-space fixtures rolled back.');
} catch {
  console.error('Embedding-space verification failed; database details suppressed.'); process.exitCode = 1;
} finally { await pool?.end(); }
