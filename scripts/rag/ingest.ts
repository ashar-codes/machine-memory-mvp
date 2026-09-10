import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import OpenAI from 'openai';
import { openDatabase, rootPath } from '../db.js';
import {
  documentIdentity, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, MAX_FILE_BYTES,
  validateEmbedding, validateManifest,
} from './manifest.js';

class SafeIngestionError extends Error {}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({ args, options: {
    file: { type: 'string' }, 'dry-run': { type: 'boolean', default: false },
  }, strict: true, allowPositionals: false });
  if (!values.file) throw new SafeIngestionError('Required: --file <local.json> [--dry-run]');
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(values.file)) {
    throw new SafeIngestionError('--file accepts a local file, not a URL.');
  }
  const file = await open(resolve(rootPath, values.file), 'r');
  let bytes: Buffer;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
      throw new SafeIngestionError('Input must be a regular JSON file no larger than 2 MiB.');
    }
    // Bounded read also handles a file growing after stat without unbounded allocation.
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await file.read(buffer, offset, buffer.length - offset, null);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset > MAX_FILE_BYTES) throw new SafeIngestionError('Input exceeds 2 MiB.');
    bytes = buffer.subarray(0, offset);
  } finally {
    await file.close();
  }
  let document;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    document = validateManifest(JSON.parse(text));
  } catch {
    throw new SafeIngestionError('Invalid knowledge JSON. Check the frozen schema, provenance and size limits.');
  }
  const identity = documentIdentity(document);
  if (values['dry-run']) {
    console.log(JSON.stringify({ status: 'validated_only', documentId: identity.id,
      chunks: document.chunks.length, recordOrigin: document.recordOrigin,
      embeddingModel: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS }));
    return;
  }
  const db = await openDatabase();
  let transactionOpen = false;
  try {
    const existing = await db.query('select id, metadata from public.documents where id = $1', [identity.id]);
    if (existing.rowCount) {
      if (existing.rows[0].metadata?.contentSha256 !== identity.sha256) {
        throw new SafeIngestionError('Document identity collision; ingestion stopped.');
      }
      console.log(JSON.stringify({ status: 'already_ingested', documentId: identity.id }));
      return;
    }
    if (!process.env.OPENAI_API_KEY) throw new SafeIngestionError('Set OPENAI_API_KEY before live ingestion.');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 2 });
    const embeddings: number[][] = [];
    for (let start = 0; start < document.chunks.length; start += 16) {
      const batch = document.chunks.slice(start, start + 16);
      const response = await openai.embeddings.create({ model: EMBEDDING_MODEL,
        input: batch.map((chunk) => chunk.content), dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: 'float' });
      const ordered = [...response.data].sort((a, b) => a.index - b.index);
      if (ordered.length !== batch.length || ordered.some((item, index) =>
        item.index !== index || !validateEmbedding(item.embedding))) {
        throw new SafeIngestionError('Embedding response failed dimension/index validation; nothing saved.');
      }
      embeddings.push(...ordered.map((item) => item.embedding));
    }
    // All network embedding work finishes before holding a DB transaction/lock.
    await db.query('begin');
    transactionOpen = true;
    await db.query('select pg_advisory_xact_lock(hashtextextended($1::text, 0))', [identity.id]);
    const concurrent = await db.query('select id, metadata from public.documents where id = $1', [identity.id]);
    if (concurrent.rowCount) {
      if (concurrent.rows[0].metadata?.contentSha256 !== identity.sha256) {
        throw new SafeIngestionError('Document identity collision; ingestion stopped.');
      }
      await db.query('commit');
      transactionOpen = false;
      console.log(JSON.stringify({ status: 'already_ingested', documentId: identity.id }));
      return;
    }
    const metadata = { assetType: document.assetType, manufacturer: document.manufacturer,
      model: document.model, contentSha256: identity.sha256, embeddingModel: EMBEDDING_MODEL,
      embeddingDimensions: EMBEDDING_DIMENSIONS, ingestionFormatVersion: 1 };
    await db.query(`insert into public.documents
      (id, title, organization, source_url, source_type, authority_class, record_origin, metadata)
      values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [identity.id, document.title,
      document.organization, document.sourceUrl, document.sourceType, document.authorityClass,
      document.recordOrigin, JSON.stringify(metadata)]);
    for (const [index, chunk] of document.chunks.entries()) {
      await db.query(`insert into public.document_chunks
        (document_id, chunk_index, content, embedding, page_number, section, metadata, record_origin)
        values ($1,$2,$3,$4::extensions.vector,$5,$6,$7::jsonb,$8)`,
      [identity.id, index, chunk.content, JSON.stringify(embeddings[index]),
        chunk.pageNumber, chunk.section, JSON.stringify(metadata), document.recordOrigin]);
    }
    await db.query('commit');
    transactionOpen = false;
    console.log(JSON.stringify({ status: 'ingested', documentId: identity.id, chunks: document.chunks.length }));
  } finally {
    if (transactionOpen) await db.query('rollback').catch(() => undefined);
    await db.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    // Do not print SDK/DB error objects: they may include connection details or supplied content.
    console.error(error instanceof SafeIngestionError ? error.message
      : 'Ingestion failed. Check local file/options, backend credentials and migrated database; no secrets were logged.');
    process.exitCode = 1;
  });
}
