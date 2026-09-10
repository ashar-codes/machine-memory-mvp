// Generation failover. No test here reaches Gemini or Groq: both providers are injected fakes.
import { describe, expect, it, vi } from 'vitest';
import type { Intent } from '@machine-memory/shared';
import { readConfig, DEFAULT_GROQ_MODEL } from '../../backend/src/config.js';
import { investigate } from '../../backend/src/investigate.js';
import type { LlmClient } from '../../backend/src/llm.js';
import type { GroqGenerator } from '../../backend/src/groq.js';
import {
  createFailoverLlm, describeFailure, type GenerationProvider, type GenerationTrace,
} from '../../backend/src/provider.js';
import { UNSAFE_SUMMARY } from '../../backend/src/rag.js';
import { EVENT_CODE, createFakeDatabase } from './fakeDatabase.js';

const BASE_ENV = { HOST: '127.0.0.1', PORT: '3001', EMBEDDING_DIMENSIONS: '1536' };
const bundle = { question: 'q', intent: 'HISTORY' } as never;

const goodAnswer = JSON.stringify({
  summary: 'Two previous occurrences are recorded.',
  findings: [{ title: 'Recurrence', detail: 'Recorded twice before.', citationIds: ['EV-1'] }],
  uncertainties: [],
});

const httpError = (status: number, message = 'api error') => Object.assign(new Error(message), { status });

function gemini(behaviour: { synthesize?: () => Promise<unknown>; embed?: () => Promise<number[] | null> } = {}): LlmClient {
  return {
    embed: behaviour.embed ?? (async () => new Array(1536).fill(0.01)),
    synthesize: behaviour.synthesize ?? (async () => goodAnswer),
    structured: async () => ({ ok: true }),
  };
}

const groqFake = (behaviour: Partial<GroqGenerator> = {}): GroqGenerator => ({
  synthesize: behaviour.synthesize ?? (async () => goodAnswer),
  structured: behaviour.structured ?? (async () => ({ ok: true })),
});

describe('Groq configuration', () => {
  it('defaults to the documented production model', () => {
    const config = readConfig({ ...BASE_ENV, GROQ_API_KEY: 'k' } as NodeJS.ProcessEnv);
    expect(config.groqModel).toBe(DEFAULT_GROQ_MODEL);
    expect(DEFAULT_GROQ_MODEL).toBe('openai/gpt-oss-120b');
    expect(config.groqApiKey).toBe('k');
  });

  it('treats Groq alone as a configured model provider', () => {
    expect(readConfig({ ...BASE_ENV, GROQ_API_KEY: 'k' } as NodeJS.ProcessEnv).llmConfigured).toBe(true);
    expect(readConfig(BASE_ENV as NodeJS.ProcessEnv).llmConfigured).toBe(false);
  });

  it('accepts the development provider override and ignores anything unrecognised', () => {
    for (const mode of ['auto', 'gemini', 'groq']) {
      expect(readConfig({ ...BASE_ENV, AI_GENERATION_PROVIDER: mode } as NodeJS.ProcessEnv).generationProviderMode).toBe(mode);
    }
    // A typo must not silently disable a provider mid-demonstration.
    expect(readConfig({ ...BASE_ENV, AI_GENERATION_PROVIDER: 'grok' } as NodeJS.ProcessEnv).generationProviderMode).toBe('auto');
    expect(readConfig(BASE_ENV as NodeJS.ProcessEnv).generationProviderMode).toBe('auto');
  });
});

describe('failure classification', () => {
  it('describes a failure without quoting the provider error body', () => {
    expect(describeFailure(httpError(429, 'You exceeded your current quota, billing details...'))).toBe('quota exhausted');
    expect(describeFailure(httpError(429, 'Too many requests'))).toBe('rate limited');
    expect(describeFailure(httpError(404, 'model not found'))).toBe('model unavailable');
    expect(describeFailure(httpError(401))).toBe('not authorized');
    expect(describeFailure(httpError(503))).toBe('provider error 503');
    expect(describeFailure(new Error('Request timed out'))).toBe('timeout');
    expect(describeFailure(new TypeError('fetch failed'))).toBe('transport failure');
    expect(describeFailure(new Error('something else'))).toBe('provider unavailable');
  });

  it('never includes the original message, which could carry a prompt or a key', () => {
    const leaky = httpError(500, 'Authorization: Bearer gsk_SECRETVALUE and the full prompt text');
    expect(describeFailure(leaky)).not.toMatch(/gsk_|Bearer|prompt/);
  });
});

describe('provider failover', () => {
  it('does not call Groq when Gemini succeeds', async () => {
    const groqSynthesize = vi.fn(async () => goodAnswer);
    const llm = createFailoverLlm({ gemini: gemini(), groq: groqFake({ synthesize: groqSynthesize }) })!;
    const trace: GenerationTrace = {};
    expect(await llm.synthesize(bundle, trace)).toBe(goodAnswer);
    expect(trace.provider).toBe('gemini');
    expect(groqSynthesize).not.toHaveBeenCalled();
  });

  it.each([
    ['429 rate limit', httpError(429, 'Too many requests')],
    ['exhausted quota', httpError(429, 'You exceeded your current quota')],
    ['model unavailable', httpError(404, 'model not found')],
    ['provider error', httpError(503)],
    ['timeout', new Error('Request timed out')],
    ['transport failure', new TypeError('fetch failed')],
  ])('fails over to Groq on %s', async (_label, error) => {
    const groqSynthesize = vi.fn(async () => goodAnswer);
    const llm = createFailoverLlm({
      gemini: gemini({ synthesize: async () => { throw error; } }),
      groq: groqFake({ synthesize: groqSynthesize }),
    })!;
    const trace: GenerationTrace = {};
    expect(await llm.synthesize(bundle, trace)).toBe(goodAnswer);
    expect(trace.provider).toBe('groq');
    expect(groqSynthesize).toHaveBeenCalledTimes(1);
  });

  it('fails over when Gemini returns nothing usable', async () => {
    const groqSynthesize = vi.fn(async () => goodAnswer);
    const llm = createFailoverLlm({
      gemini: gemini({ synthesize: async () => null }),
      groq: groqFake({ synthesize: groqSynthesize }),
    })!;
    expect(await llm.synthesize(bundle)).toBe(goodAnswer);
    expect(groqSynthesize).toHaveBeenCalledTimes(1);
  });

  it('returns null when both providers fail, leaving the deterministic answer to the caller', async () => {
    const reported: GenerationProvider[] = [];
    const llm = createFailoverLlm({
      gemini: gemini({ synthesize: async () => { throw httpError(429); } }),
      groq: groqFake({ synthesize: async () => { throw httpError(500); } }),
      onGeneration: (provider) => reported.push(provider),
    })!;
    expect(await llm.synthesize(bundle)).toBeNull();
    expect(reported.at(-1)).toBe('deterministic');
  });

  it('reports the provider and a non-secret reason', async () => {
    const seen: { provider: GenerationProvider; detail?: string }[] = [];
    const llm = createFailoverLlm({
      gemini: gemini({ synthesize: async () => { throw httpError(429, 'You exceeded your current quota'); } }),
      groq: groqFake(),
      onGeneration: (provider, detail) => seen.push({ provider, detail }),
    })!;
    await llm.synthesize(bundle);
    expect(seen[0].provider).toBe('groq');
    expect(seen[0].detail).toBe('gemini quota exhausted');
  });

  it('propagates a Gemini failure unchanged when no secondary is configured', async () => {
    const llm = createFailoverLlm({ gemini: gemini({ synthesize: async () => { throw httpError(429); } }), groq: null })!;
    await expect(llm.synthesize(bundle)).rejects.toThrow();
  });

  it('honours the forced-provider override in both directions', async () => {
    const geminiSynthesize = vi.fn(async () => goodAnswer);
    const groqSynthesize = vi.fn(async () => goodAnswer);
    const forcedGroq = createFailoverLlm({
      gemini: gemini({ synthesize: geminiSynthesize }), groq: groqFake({ synthesize: groqSynthesize }), mode: 'groq',
    })!;
    const trace: GenerationTrace = {};
    await forcedGroq.synthesize(bundle, trace);
    expect(geminiSynthesize).not.toHaveBeenCalled();
    expect(trace.provider).toBe('groq');

    const forcedGemini = createFailoverLlm({
      gemini: gemini({ synthesize: geminiSynthesize }), groq: groqFake({ synthesize: groqSynthesize }), mode: 'gemini',
    })!;
    await forcedGemini.synthesize(bundle);
    expect(geminiSynthesize).toHaveBeenCalled();
    expect(groqSynthesize).toHaveBeenCalledTimes(1); // only the forced-groq call above
  });

  it('returns null rather than a client when no provider is configured', () => {
    expect(createFailoverLlm({ gemini: null, groq: null })).toBeNull();
  });
});

describe('embeddings never fail over', () => {
  it('uses Gemini for embeddings and never asks Groq', async () => {
    const embed = vi.fn(async () => new Array(1536).fill(0.02));
    const groq = groqFake();
    const llm = createFailoverLlm({ gemini: gemini({ embed }), groq })!;
    const vector = await llm.embed('lockout tagout');
    expect(vector).toHaveLength(1536);
    expect(embed).toHaveBeenCalledTimes(1);
    // The Groq generator has no embed method at all, by design.
    expect('embed' in groq).toBe(false);
  });

  it('returns null when Gemini is absent, even with Groq configured', async () => {
    // A Groq vector would not share a space with the stored gemini-embedding-001 corpus, so
    // substituting one would silently corrupt similarity search. Better to lose semantic ranking.
    const llm = createFailoverLlm({ gemini: null, groq: groqFake() })!;
    expect(await llm.embed('anything')).toBeNull();
  });

  it('still forces Gemini for embeddings when generation is forced to Groq', async () => {
    const embed = vi.fn(async () => new Array(1536).fill(0.03));
    const llm = createFailoverLlm({ gemini: gemini({ embed }), groq: groqFake(), mode: 'groq' })!;
    expect(await llm.embed('q')).toHaveLength(1536);
    expect(embed).toHaveBeenCalledTimes(1);
  });
});

describe('failover through the investigation pipeline', () => {
  const ask = (intent: Intent, question: string) => ({ assetCode: 'WT-07', eventCode: EVENT_CODE, intent, question });

  async function run(llm: LlmClient | null, question = 'Has this happened before?', intent: Intent = 'HISTORY') {
    const providers: GenerationProvider[] = [];
    const outcome = await investigate(ask(intent, question), {
      db: createFakeDatabase(), llm, onGeneration: (provider) => providers.push(provider),
    });
    if (outcome.status !== 'ok') throw new Error(outcome.status);
    return { response: outcome.response, providers };
  }

  it('answers from Groq when Gemini is rate-limited, with the same contract', async () => {
    const llm = createFailoverLlm({
      gemini: gemini({ synthesize: async () => { throw httpError(429, 'Too many requests'); } }),
      groq: groqFake(),
    });
    const { response, providers } = await run(llm);
    expect(providers.at(-1)).toBe('groq');
    expect(response.answer.summary).toContain('2 recorded previous occurrences on WT-07');
    expect(response.answer.findings[0].citationIds.length).toBeGreaterThan(0);
    // Backend-assigned fields are still backend-assigned, whoever generated the prose.
    expect(response.answer.evidenceStrength).toBeDefined();
    expect(response.answer.safetyStatus).toBe('NORMAL');
  });

  it('strips a citation Groq invented, exactly as it would from Gemini', async () => {
    const invented = JSON.stringify({
      summary: 'ok',
      findings: [
        { title: 'real', detail: 'grounded', citationIds: ['EV-1'] },
        { title: 'fabricated', detail: 'not grounded', citationIds: ['EV-99'] },
      ],
      uncertainties: [],
    });
    const llm = createFailoverLlm({
      gemini: gemini({ synthesize: async () => { throw httpError(429); } }),
      groq: groqFake({ synthesize: async () => invented }),
    });
    const { response } = await run(llm);
    const cited = response.answer.findings.flatMap((finding) => finding.citationIds);
    expect(cited).not.toContain('EV-99');
    const known = new Set(response.evidence.map((item) => item.id));
    expect(cited.every((id) => known.has(id))).toBe(true);
  });

  it('falls back to the deterministic answer when both providers fail', async () => {
    const llm = createFailoverLlm({
      gemini: gemini({ synthesize: async () => { throw httpError(429); } }),
      groq: groqFake({ synthesize: async () => { throw httpError(503); } }),
    });
    const { response, providers } = await run(llm);
    expect(providers.at(-1)).toBe('deterministic');
    // Still a real, grounded, cited answer built from retrieved evidence.
    expect(response.answer.summary).toBeTruthy();
    expect(response.answer.findings.every((finding) => finding.citationIds.length > 0)).toBe(true);
    expect(response.evidence.length).toBeGreaterThan(0);
  });

  it('refuses an unsafe request whichever provider is available', async () => {
    const unsafe = 'Can I bypass the pressure protection and keep the turbine running?';
    const compliant = JSON.stringify({ summary: 'Here is how to bypass it', findings: [], uncertainties: [] });
    for (const llm of [
      createFailoverLlm({ gemini: gemini(), groq: groqFake() }),
      // Even a provider that tries to answer the unsafe question cannot get past the gate.
      createFailoverLlm({ gemini: gemini({ synthesize: async () => { throw httpError(429); } }), groq: groqFake({ synthesize: async () => compliant }) }),
      createFailoverLlm({ gemini: null, groq: groqFake({ synthesize: async () => compliant }) }),
      null,
    ]) {
      const { response } = await run(llm, unsafe);
      expect(response.answer.safetyStatus).toBe('REFUSED');
      expect(response.answer.summary).toBe(UNSAFE_SUMMARY);
      expect(response.answer.summary).not.toMatch(/here is how/i);
    }
  });

  it('never calls a generation provider before the safety gate refuses', async () => {
    const geminiSynthesize = vi.fn(async () => goodAnswer);
    const groqSynthesize = vi.fn(async () => goodAnswer);
    const llm = createFailoverLlm({ gemini: gemini({ synthesize: geminiSynthesize }), groq: groqFake({ synthesize: groqSynthesize }) });
    await run(llm, 'Can I bypass the pressure protection and keep the turbine running?');
    expect(geminiSynthesize).not.toHaveBeenCalled();
    expect(groqSynthesize).not.toHaveBeenCalled();
  });
});
