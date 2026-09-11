// Semantic indexing of a saved resolution. Deliberately separate from the resolution transaction:
// the structured record is already committed and must never be rolled back by an embedding failure.
// Success is not reported back to the client, because the frozen contract returns
// STRUCTURED_SAVED_SEMANTIC_PENDING and must not claim indexing that may still be in flight.
import type { LlmClient } from './llm.js';
import type { Queryable } from './retrieval.js';

export interface ResolutionIndexInput {
  resolutionId: string;
  assetId: string;
  assetCode: string;
  eventCode: string;
  rootCause: string;
  resolutionSummary: string;
  component: string;
  notes: string;
  assetType: string;
  manufacturer: string | null;
  model: string | null;
  embeddingModel: string;
  embeddingDimensions: number;
}

export function resolutionNarrative(input: ResolutionIndexInput): string {
  return [
    `Asset ${input.assetCode}, event ${input.eventCode}.`,
    `Recorded root cause: ${input.rootCause}.`,
    `Recorded resolution: ${input.resolutionSummary}.`,
    input.component ? `Component: ${input.component}.` : '',
    input.notes ? `Technician notes: ${input.notes}` : '',
    'User-entered demonstration record. Not an approved procedure.',
  ].filter(Boolean).join(' ');
}

/**
 * Returns true only when a chunk with a real embedding was committed.
 * Any failure returns false; the caller logs it and moves on.
 */
export async function indexResolution(
  db: Queryable, llm: LlmClient | null, input: ResolutionIndexInput,
): Promise<boolean> {
  if (!llm) return false;
  const content = resolutionNarrative(input);
  const embedding = await llm.embed(content, 'RETRIEVAL_DOCUMENT');
  if (!embedding || embedding.length !== input.embeddingDimensions) return false;

  const metadata = {
    assetType: input.assetType, manufacturer: input.manufacturer, model: input.model,
    resolutionId: input.resolutionId, embeddingModel: input.embeddingModel,
    embeddingDimensions: input.embeddingDimensions, ingestionFormatVersion: 1,
  };
  await db.query('begin');
  try {
    const document = await db.query(
      `insert into public.documents (title, organization, source_url, source_type, authority_class, record_origin, metadata)
       values ($1, $2, null, 'TECHNICIAN_NOTE', 'UNVERIFIED', 'user_demo', $3::jsonb)
       returning id`,
      [`Logged resolution ${input.assetCode} ${input.eventCode}`, 'Machine Memory user entry', JSON.stringify(metadata)]);
    const documentId = document.rows[0]?.id;
    if (!documentId) throw new Error('Document insert returned no identifier.');
    await db.query(
      `insert into public.document_chunks
        (document_id, asset_id, event_code, chunk_index, content, embedding, page_number, section, metadata, record_origin)
       values ($1, $2, $3, 0, $4, $5::extensions.vector, null, 'Logged resolution', $6::jsonb, 'user_demo')`,
      [documentId, input.assetId, input.eventCode, content, JSON.stringify(embedding), JSON.stringify(metadata)]);
    await db.query('commit');
    return true;
  } catch (error) {
    await db.query('rollback').catch(() => undefined);
    throw error;
  }
}
