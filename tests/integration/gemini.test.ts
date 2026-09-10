// Provider-layer tests. Nothing here reaches the Gemini API: every call is injected.
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EMBEDDING_MODEL, DEFAULT_MODEL, EMBEDDING_DIMENSIONS, readConfig } from '../../backend/src/config.js';
import { createLlm } from '../../backend/src/llm.js';
import { parseModelAnswer } from '../../backend/src/synthesis.js';
import {
  EmbeddingError, embedDocumentChunks, isTransient, readEmbeddings,
} from '../../scripts/rag/gemini.js';
import { EMBEDDING_MODEL, normalizeVector, validateEmbedding } from '../../scripts/rag/manifest.js';

const BASE_ENV = { HOST: '127.0.0.1', PORT: '3001', EMBEDDING_DIMENSIONS: '1536' };
const vector = (length: number, value = 0.01) => new Array<number>(length).fill(value);
const embeddingsResponse = (vectors: number[][]) => ({ embeddings: vectors.map((values) => ({ values })) });
const httpError = (status: number) => Object.assign(new Error('api'), { status });

describe('gemini environment configuration', () => {
  it('reads the Gemini contract and defaults to the selected free-tier models', () => {
    const config = readConfig({ ...BASE_ENV, GEMINI_API_KEY: 'test-key' } as NodeJS.ProcessEnv);
    expect(config.llmConfigured).toBe(true);
    expect(config.geminiApiKey).toBe('test-key');
    expect(config.model).toBe(DEFAULT_MODEL);
    expect(config.embeddingModel).toBe(DEFAULT_EMBEDDING_MODEL);
    expect(config.embeddingDimensions).toBe(1536);
  });

  it('honours explicit model overrides without touching the migrated vector size', () => {
    const config = readConfig({
      ...BASE_ENV, GEMINI_API_KEY: 'k', GEMINI_MODEL: ' gemini-3.7-flash ',
      GEMINI_EMBEDDING_MODEL: ' gemini-embedding-2-preview ',
    } as NodeJS.ProcessEnv);
    expect(config.model).toBe('gemini-3.7-flash');
    expect(config.embeddingModel).toBe('gemini-embedding-2-preview');
    expect(config.embeddingDimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  it('runs unconfigured rather than half-configured when no key is present', () => {
    const config = readConfig(BASE_ENV as NodeJS.ProcessEnv);
    expect(config.llmConfigured).toBe(false);
    expect(createLlm({ apiKey: config.geminiApiKey, model: config.model,
      embeddingModel: config.embeddingModel, embeddingDimensions: 1536 })).toBeNull();
  });

  it('rejects an embedding size that would not fit the migrated vector column', () => {
    expect(() => readConfig({ ...BASE_ENV, EMBEDDING_DIMENSIONS: '768' } as NodeJS.ProcessEnv)).toThrow();
  });

  it('embeds documents and queries with the same model and dimensionality', () => {
    expect(EMBEDDING_MODEL).toBe(DEFAULT_EMBEDDING_MODEL);
  });
});

describe('embedding validation', () => {
  it('accepts exactly 1536 finite values and rejects everything else', () => {
    expect(validateEmbedding(normalizeVector(vector(1536)))).toBe(true);
    expect(validateEmbedding(vector(1535))).toBe(false);
    expect(validateEmbedding(vector(1537))).toBe(false);
    expect(validateEmbedding([...vector(1535), Number.NaN])).toBe(false);
    expect(validateEmbedding([...vector(1535), Number.POSITIVE_INFINITY])).toBe(false);
  });

  it('normalizes a truncated vector to unit length and refuses a zero vector', () => {
    const unit = normalizeVector(vector(1536));
    expect(unit).not.toBeNull();
    expect(Math.hypot(...unit!)).toBeCloseTo(1, 10);
    expect(normalizeVector(vector(1536, 0))).toBeNull();
    expect(normalizeVector([Number.NaN, 1])).toBeNull();
  });

  it('rejects a response whose vector is the wrong length before anything is saved', () => {
    expect(() => readEmbeddings(embeddingsResponse([vector(768)]), 1)).toThrow(EmbeddingError);
    expect(() => readEmbeddings(embeddingsResponse([[...vector(1535), Number.NaN]]), 1)).toThrow(EmbeddingError);
    expect(() => readEmbeddings({ embeddings: [{}] }, 1)).toThrow(EmbeddingError);
  });

  it('rejects a response that returns the wrong number of vectors', () => {
    expect(() => readEmbeddings(embeddingsResponse([vector(1536)]), 2)).toThrow(EmbeddingError);
    expect(() => readEmbeddings({}, 1)).toThrow(EmbeddingError);
    expect(() => readEmbeddings(null, 1)).toThrow(EmbeddingError);
  });
});

describe('free-tier rate limiting', () => {
  it('classifies 429 and 5xx as transient and other statuses as permanent', () => {
    expect(isTransient(httpError(429))).toBe(true);
    expect(isTransient(httpError(503))).toBe(true);
    expect(isTransient(httpError(400))).toBe(false);
    expect(isTransient(httpError(403))).toBe(false);
    expect(isTransient(httpError(404))).toBe(false);
  });

  it('does not retry a 429 that reports an exhausted quota', () => {
    // A daily quota does not clear inside a backoff window; retrying just adds latency.
    const exhausted = Object.assign(new Error('429 You exceeded your current quota, please check your plan and billing details.'), { status: 429 });
    expect(isTransient(exhausted)).toBe(false);
    const perMinute = Object.assign(new Error('429 Too many requests, retry shortly.'), { status: 429 });
    expect(isTransient(perMinute)).toBe(true);
  });

  it('treats a transport failure that never got a status as transient', () => {
    // Observed in real ingestion: undici raises `TypeError: fetch failed` with no HTTP status.
    expect(isTransient(new TypeError('fetch failed'))).toBe(true);
    expect(isTransient(new Error('read ECONNRESET'))).toBe(true);
    expect(isTransient(new Error('other side closed'))).toBe(false);
  });

  it('retries a transport failure rather than abandoning the manifest', async () => {
    const call = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(embeddingsResponse([vector(1536)]));
    await expect(embedDocumentChunks(['chunk'], call, { delay: async () => undefined }))
      .resolves.toHaveLength(1);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('retries a 429 with backoff and then succeeds', async () => {
    const delay = vi.fn(async () => undefined);
    const call = vi.fn()
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValueOnce(embeddingsResponse([vector(1536)]));
    const result = await embedDocumentChunks(['chunk'], call, { delay });
    expect(result).toHaveLength(1);
    expect(call).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it('stops retrying instead of hammering the free tier forever', async () => {
    const call = vi.fn().mockRejectedValue(httpError(429));
    await expect(embedDocumentChunks(['chunk'], call, { maxAttempts: 3, delay: async () => undefined }))
      .rejects.toThrow(EmbeddingError);
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('does not retry a permanent error or a malformed vector', async () => {
    const permanent = vi.fn().mockRejectedValue(httpError(400));
    await expect(embedDocumentChunks(['chunk'], permanent, { delay: async () => undefined }))
      .rejects.toThrow(EmbeddingError);
    expect(permanent).toHaveBeenCalledTimes(1);

    const malformed = vi.fn().mockResolvedValue(embeddingsResponse([vector(10)]));
    await expect(embedDocumentChunks(['chunk'], malformed, { delay: async () => undefined }))
      .rejects.toThrow(EmbeddingError);
    expect(malformed).toHaveBeenCalledTimes(1);
  });

  it('batches chunks in order without concurrency', async () => {
    const seen: string[][] = [];
    const call = vi.fn(async (inputs: string[]) => {
      seen.push(inputs);
      return embeddingsResponse(inputs.map((_, index) => vector(1536, 0.01 * (index + 1))));
    });
    const contents = ['a', 'b', 'c', 'd', 'e'];
    const result = await embedDocumentChunks(contents, call, { batchSize: 2 });
    expect(result).toHaveLength(5);
    expect(seen).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
    expect(result.every((item) => validateEmbedding(item))).toBe(true);
  });
});

describe('malformed model output', () => {
  const evidence = [{ id: 'EVIDENCE-1' }] as unknown as Parameters<typeof parseModelAnswer>[1];

  it('rejects output that is not a JSON object', () => {
    expect(parseModelAnswer('not json at all', evidence)).toBeNull();
    expect(parseModelAnswer('[1,2,3]', evidence)).toBeNull();
    expect(parseModelAnswer('', evidence)).toBeNull();
    expect(parseModelAnswer(null, evidence)).toBeNull();
  });

  it('rejects a truncated JSON response rather than forwarding it', () => {
    expect(parseModelAnswer('{"summary":"partial","findings":[', evidence)).toBeNull();
  });

  it('unwraps a fenced JSON block the model was told not to emit', () => {
    const fenced = '```json\n{"summary":"ok","findings":[{"title":"t","detail":"d","citationIds":["EVIDENCE-1"]}],"uncertainties":[]}\n```';
    expect(parseModelAnswer(fenced, evidence)?.summary).toBe('ok');
  });

  it('drops a finding whose only citation was invented', () => {
    const invented = { summary: 'ok', uncertainties: [], findings: [
      { title: 'real', detail: 'd', citationIds: ['EVIDENCE-1'] },
      { title: 'fabricated', detail: 'd', citationIds: ['EVIDENCE-99'] },
    ] };
    const parsed = parseModelAnswer(invented, evidence);
    expect(parsed?.findings).toHaveLength(1);
    expect(parsed?.findings[0].title).toBe('real');
  });

  it('ignores a backend-owned field the model tried to set', () => {
    const overreach = { summary: 'ok', uncertainties: [], evidenceStrength: 'STRONG', safetyStatus: 'NORMAL',
      findings: [{ title: 't', detail: 'd', citationIds: ['EVIDENCE-1'] }] };
    expect(parseModelAnswer(overreach, evidence)).not.toHaveProperty('evidenceStrength');
    expect(parseModelAnswer(overreach, evidence)).not.toHaveProperty('safetyStatus');
  });
});
