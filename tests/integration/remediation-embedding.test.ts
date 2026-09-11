import { describe, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ embedContent: vi.fn(async () => ({ embeddings: [{ values: new Array<number>(1536).fill(1) }] })) }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = sdk; } }));
import { createLlm } from '../../backend/src/llm.js';
import { ingestDocument } from '../../backend/src/knowledge.js';
import { indexResolution } from '../../backend/src/memoryIndex.js';
import { readConfig } from '../../backend/src/config.js';
import { createFailoverLlm } from '../../backend/src/provider.js';

describe('embedding roles and contract', () => {
  it('sends document role through the actual SDK boundary', async () => {
    const llm = createLlm({ apiKey: 'test-only', model: 'generation-test', embeddingModel: 'gemini-embedding-001', embeddingDimensions: 1536 })!;
    await llm.embed('search question');
    expect(sdk.embedContent).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'gemini-embedding-001', config: { taskType: 'RETRIEVAL_QUERY', outputDimensionality: 1536 } }));
    const vector = await llm.embed('document passage', 'RETRIEVAL_DOCUMENT');
    expect(sdk.embedContent).toHaveBeenLastCalledWith(expect.objectContaining({ config: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 1536 } }));
    expect(vector).toHaveLength(1536); expect(Math.hypot(...vector!)).toBeCloseTo(1, 10);
  });
  it('runtime document and resolution indexing request document embeddings', async () => {
    const embed = vi.fn(async () => new Array<number>(1536).fill(0.01));
    const llm = { embed, synthesize: async () => null };
    const db = { query: async () => ({ rows: [{ id: 'test-document' }] }) };
    await ingestDocument(db, llm, [{ content: 'Uploaded document passage', section: null }], {
      title: 'test', organization: 'test', sourceType: 'TECHNICAL_REFERENCE', assetType: 'wind_turbine',
      manufacturer: null, model: null, dataSourceId: 'source', originalFilename: 'test.txt', contentSha256: '',
      embeddingModel: 'gemini-embedding-001', embeddingDimensions: 1536,
    });
    expect(embed).toHaveBeenLastCalledWith('Uploaded document passage', 'RETRIEVAL_DOCUMENT');
    await indexResolution(db, llm, { resolutionId: 'resolution', assetId: 'asset', assetCode: 'WT-07', eventCode: 'TEST-1',
      rootCause: 'Stored cause', resolutionSummary: 'Stored outcome', component: 'test',
      notes: '', assetType: 'wind_turbine', manufacturer: null, model: null,
      embeddingModel: 'gemini-embedding-001', embeddingDimensions: 1536 });
    expect(embed).toHaveBeenLastCalledWith(expect.any(String), 'RETRIEVAL_DOCUMENT');
  });
  it('refuses another model space despite identical dimension', () => {
    expect(() => readConfig({ GEMINI_EMBEDDING_MODEL: 'different-model', EMBEDDING_DIMENSIONS: '1536' })).toThrow();
  });
  it('forwards document role to Gemini through failover, never Groq', async () => {
    const embed = vi.fn(async () => null);
    const groq = { synthesize: vi.fn(async () => null), structured: vi.fn(async () => null) };
    const composite = createFailoverLlm({ gemini: { embed, synthesize: async () => null }, groq, mode: 'groq' })!;
    await composite.embed('document', 'RETRIEVAL_DOCUMENT');
    expect(embed).toHaveBeenCalledWith('document', 'RETRIEVAL_DOCUMENT');
    expect(groq.synthesize).not.toHaveBeenCalled(); expect(groq.structured).not.toHaveBeenCalled();
  });
});
