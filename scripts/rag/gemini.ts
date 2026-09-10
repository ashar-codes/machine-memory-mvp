// Offline document embedding through Gemini. Kept separate from the ingester so the batching,
// retry and validation rules can be tested without a network call or an API key.
import { GoogleGenAI } from '@google/genai';
import { EMBEDDING_DIMENSIONS, normalizeVector, validateEmbedding } from './manifest.js';

/** One provider call for a batch of chunk texts. Injected so tests never reach the network. */
export type EmbedCall = (inputs: string[]) => Promise<unknown>;

export class EmbeddingError extends Error {}

// Free-tier friendly: small batches, modest serial concurrency, bounded retries.
export const BATCH_SIZE = 8;
const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 429 and 5xx are transient; 4xx of any other kind means the request itself is wrong. */
export function isTransient(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  if (typeof status === 'number') return status === 429 || (status >= 500 && status < 600);
  // No HTTP status at all means the request never reached the service: a transport failure such as
  // `fetch failed`, a reset socket or a DNS blip. Those deserve the same bounded retry as a 429.
  return TRANSPORT_FAILURE.test(String((error as { message?: unknown })?.message ?? ''));
}

const TRANSPORT_FAILURE = /fetch failed|network|socket|terminated|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i;

export function createGeminiEmbedCall(apiKey: string, model: string): EmbedCall {
  const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: 60_000 } });
  return (inputs) => client.models.embedContent({
    model,
    contents: inputs,
    // Document side of the retrieval pair; queries are embedded as RETRIEVAL_QUERY.
    config: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: EMBEDDING_DIMENSIONS },
  });
}

/** Reads the vectors out of an embedContent response, rejecting anything that is not 1536 finite numbers. */
export function readEmbeddings(response: unknown, expected: number): number[][] {
  const embeddings = (response as { embeddings?: unknown })?.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== expected) {
    throw new EmbeddingError('Embedding response returned the wrong number of vectors; nothing saved.');
  }
  return embeddings.map((entry) => {
    const values = (entry as { values?: unknown })?.values;
    // Truncated gemini-embedding-001 output is not unit length; normalize before validating.
    const unit = Array.isArray(values) && values.every((v) => typeof v === 'number' && Number.isFinite(v))
      ? normalizeVector(values as number[]) : null;
    if (!validateEmbedding(unit)) {
      throw new EmbeddingError('Embedding response failed dimension/finiteness validation; nothing saved.');
    }
    return unit;
  });
}

/**
 * Embeds every chunk in order. Batches are sent one at a time — the free tier is rate limited by
 * requests per minute, so concurrency buys nothing and only provokes 429s.
 */
export async function embedDocumentChunks(
  contents: string[], call: EmbedCall,
  options: { batchSize?: number; maxAttempts?: number; delay?: (ms: number) => Promise<unknown> } = {},
): Promise<number[][]> {
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const wait = options.delay ?? sleep;
  const vectors: number[][] = [];

  for (let start = 0; start < contents.length; start += batchSize) {
    const batch = contents.slice(start, start + batchSize);
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        vectors.push(...readEmbeddings(await call(batch), batch.length));
        break;
      } catch (error) {
        // A bad vector is a defect, not congestion: never retry it, and never fall through to a write.
        if (error instanceof EmbeddingError || !isTransient(error) || attempt >= maxAttempts) {
          throw error instanceof EmbeddingError ? error
            : new EmbeddingError(`Embedding request failed after ${attempt} attempt(s); nothing saved.`);
        }
        await wait(BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }
  }
  return vectors;
}
