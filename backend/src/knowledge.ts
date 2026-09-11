// Dynamic knowledge ingestion and the knowledge catalogue.
//
// An uploaded technical document goes through the same destination as the reviewed public corpus —
// documents + document_chunks + pgvector — so retrieval needs no special case. What it does not
// get is authority: an uploaded file is stored as UNVERIFIED with record_origin 'user_import', and
// `procedural` in retrieval.ts still requires a public origin, so it can be cited but never quoted
// as approved guidance.
import type { KnowledgeChunkPreview, KnowledgeSource } from '@machine-memory/shared';
import type { LlmClient } from './llm.js';
import type { Queryable } from './retrieval.js';

export const MAX_CHUNKS = 120;
export const TARGET_CHUNK_CHARS = 1200;
export const MIN_CHUNK_CHARS = 60;
export const MAX_CHUNK_CHARS = 7000;

export class KnowledgeError extends Error {}

/** Foundation corpora a normal delete action must never be able to remove. */
export const PROTECTED_ORIGINS = ['public_data', 'public_reference', 'synthetic_demo'];

/**
 * Paragraph-aware chunking. Splits on blank lines and packs paragraphs up to a target size so a
 * chunk stays a coherent passage; an oversized paragraph is split on sentence boundaries.
 */
export function chunkText(content: string): { content: string; section: string | null }[] {
  const normalized = content.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) throw new KnowledgeError('The document contains no readable text.');

  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const pieces: string[] = [];
  let buffer = '';
  const flush = () => { if (buffer.trim()) pieces.push(buffer.trim()); buffer = ''; };

  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_CHUNK_CHARS) {
      flush();
      // Sentence-boundary split keeps an oversized block readable rather than cutting mid-word.
      let carry = '';
      for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
        if ((carry + ' ' + sentence).trim().length > TARGET_CHUNK_CHARS && carry) { pieces.push(carry.trim()); carry = ''; }
        carry = `${carry} ${sentence}`.trim().slice(0, MAX_CHUNK_CHARS);
      }
      if (carry.trim()) pieces.push(carry.trim());
      continue;
    }
    if ((buffer + '\n\n' + paragraph).trim().length > TARGET_CHUNK_CHARS && buffer) flush();
    buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
  }
  flush();

  const kept = pieces.filter((piece) => piece.length >= MIN_CHUNK_CHARS).slice(0, MAX_CHUNKS);
  if (!kept.length) throw new KnowledgeError('The document has no passage long enough to index.');
  return kept.map((piece) => {
    // Use a short leading line as a section label when the passage clearly starts with a heading.
    const firstLine = piece.split('\n')[0].trim();
    const section = firstLine.length <= 120 && firstLine.length >= 3 && !/[.!?]$/.test(firstLine) ? firstLine : null;
    return { content: piece.slice(0, MAX_CHUNK_CHARS), section };
  });
}

function isFiniteVector(value: unknown, dimensions: number): value is number[] {
  return Array.isArray(value) && value.length === dimensions
    && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

export interface IngestOptions {
  title: string; organization: string; sourceType: 'TECHNICAL_REFERENCE' | 'SAFETY_REFERENCE' | 'TECHNICIAN_NOTE';
  assetType: string | null; manufacturer: string | null; model: string | null;
  dataSourceId: string; originalFilename: string; contentSha256: string;
  embeddingModel: string; embeddingDimensions: number;
}

export interface IngestResult { documentId: string; chunksCreated: number; chunksEmbedded: number }

/**
 * Creates the document and its chunks in one transaction. Embeddings are computed before the
 * transaction opens so a slow provider never holds a database lock, and a chunk whose vector fails
 * validation is stored with a null embedding rather than a fabricated one: it stays keyword
 * searchable and the catalogue reports the document as only partially indexed.
 */
export async function ingestDocument(
  db: Queryable, llm: LlmClient | null, chunks: { content: string; section: string | null }[], options: IngestOptions,
): Promise<IngestResult> {
  const vectors: (number[] | null)[] = [];
  for (const chunk of chunks) {
    if (!llm) { vectors.push(null); continue; }
    try {
      const vector = await llm.embed(chunk.content, 'RETRIEVAL_DOCUMENT');
      vectors.push(isFiniteVector(vector, options.embeddingDimensions) ? vector : null);
    } catch {
      vectors.push(null);
    }
  }

  const metadata = {
    assetType: options.assetType, manufacturer: options.manufacturer, model: options.model,
    contentSha256: options.contentSha256, originalFilename: options.originalFilename,
    embeddingModel: options.embeddingModel, embeddingDimensions: options.embeddingDimensions,
    ingestionFormatVersion: 1,
  };

  await db.query('begin');
  try {
    const document = await db.query(`insert into public.documents
      (title, organization, source_url, source_type, authority_class, record_origin, metadata, data_source_id)
      values ($1,$2,null,$3,'UNVERIFIED','user_import',$4::jsonb,$5) returning id`,
    [options.title, options.organization, options.sourceType, JSON.stringify(metadata), options.dataSourceId]);
    const documentId = document.rows[0].id as string;

    for (const [index, chunk] of chunks.entries()) {
      const vector = vectors[index];
      await db.query(`insert into public.document_chunks
        (document_id, chunk_index, content, embedding, section, metadata, record_origin)
        values ($1,$2,$3,$4::extensions.vector,$5,$6::jsonb,'user_import')`,
      [documentId, index, chunk.content, vector ? JSON.stringify(vector) : null, chunk.section, JSON.stringify(metadata)]);
    }
    await db.query('commit');
    return { documentId, chunksCreated: chunks.length, chunksEmbedded: vectors.filter(Boolean).length };
  } catch (error) {
    await db.query('rollback').catch(() => undefined);
    throw error;
  }
}

const SOURCE_COLUMNS = `d.id, d.title, d.organization, d.source_type, d.authority_class, d.record_origin,
  d.source_url, d.created_at, d.metadata,
  (select count(*)::int from public.document_chunks c where c.document_id = d.id) as chunks,
  (select count(*)::int from public.document_chunks c where c.document_id = d.id and c.embedding is not null) as embedded_chunks`;

function toSource(row: Record<string, unknown>): KnowledgeSource {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const chunks = Number(row.chunks ?? 0);
  const embedded = Number(row.embedded_chunks ?? 0);
  return {
    id: String(row.id), title: String(row.title), organization: String(row.organization),
    sourceType: String(row.source_type), authorityClass: row.authority_class as KnowledgeSource['authorityClass'],
    recordOrigin: row.record_origin as KnowledgeSource['recordOrigin'],
    sourceUrl: (row.source_url as string | null) ?? null,
    chunks, embeddedChunks: embedded, indexed: chunks > 0 && embedded === chunks,
    createdAt: new Date(row.created_at as string).toISOString(),
    assetType: (metadata.assetType as string | null) ?? null,
    manufacturer: (metadata.manufacturer as string | null) ?? null,
    model: (metadata.model as string | null) ?? null,
    // Only what a user added here may be removed from the interface.
    deletable: !PROTECTED_ORIGINS.includes(String(row.record_origin)),
  };
}

export async function listSources(db: Queryable, limit: number, offset: number): Promise<{ items: KnowledgeSource[]; hasMore: boolean }> {
  const result = await db.query(
    `select ${SOURCE_COLUMNS} from public.documents d order by d.created_at desc, d.id limit $1 offset $2`,
    [limit + 1, offset]);
  return { items: result.rows.slice(0, limit).map(toSource), hasMore: result.rows.length > limit };
}

export async function getSource(db: Queryable, id: string): Promise<{ source: KnowledgeSource; chunkPreviews: KnowledgeChunkPreview[] } | null> {
  const result = await db.query(`select ${SOURCE_COLUMNS} from public.documents d where d.id = $1`, [id]);
  if (!result.rows[0]) return null;
  const chunks = await db.query(
    `select chunk_index, section, page_number, left(content, 400) as excerpt, embedding is not null as embedded
     from public.document_chunks where document_id = $1 order by chunk_index limit 20`, [id]);
  return {
    source: toSource(result.rows[0]),
    chunkPreviews: chunks.rows.map((row) => ({
      chunkIndex: Number(row.chunk_index), section: (row.section as string | null) ?? null,
      pageNumber: row.page_number === null ? null : Number(row.page_number),
      excerpt: String(row.excerpt), embedded: Boolean(row.embedded),
    })),
  };
}

/** Deletes a user-added source only. The public and synthetic corpora are refused outright. */
export async function deleteSource(db: Queryable, id: string): Promise<'deleted' | 'not_found' | 'protected'> {
  const found = await db.query('select record_origin from public.documents where id = $1', [id]);
  if (!found.rows[0]) return 'not_found';
  if (PROTECTED_ORIGINS.includes(String(found.rows[0].record_origin))) return 'protected';
  // Chunks cascade through the (document_id, record_origin) foreign key.
  await db.query('delete from public.documents where id = $1', [id]);
  return 'deleted';
}
