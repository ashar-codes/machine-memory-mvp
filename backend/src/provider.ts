// Generation failover.
//
//   Gemini ──failure──▶ Groq ──failure──▶ deterministic answer (assembled upstream from evidence)
//
// This is a composite LlmClient, so nothing downstream changes: investigate.ts, copilot.ts and
// mapping.ts already take an injected LlmClient and keep working unmodified.
//
// Embeddings never fail over. The pgvector corpus was built with gemini-embedding-001, and two
// embedding models do not share a vector space just because they share a dimension count — a Groq
// vector compared against Gemini vectors would return confident nonsense. `embed` therefore calls
// Gemini and only Gemini, and returns null rather than substituting another provider.
import type { EvidenceBundle } from './synthesis.js';
import type { GroqGenerator } from './groq.js';
import type { LlmClient } from './llm.js';

export type GenerationProvider = 'gemini' | 'groq' | 'deterministic';
export type ProviderMode = 'auto' | 'gemini' | 'groq';

/** Per-call sink for which provider answered. A fresh object per call, so it cannot race. */
export interface GenerationTrace { provider?: GenerationProvider }

export interface FailoverConfig {
  gemini: LlmClient | null;
  groq: GroqGenerator | null;
  /** Development override. 'auto' is the only value used in normal operation. */
  mode?: ProviderMode;
  /** Non-secret diagnostics: which provider was used, and why the primary was abandoned. */
  onGeneration?: (provider: GenerationProvider, detail?: string) => void;
  /** Clock injection, so the primary-cooldown breaker is testable without waiting ten minutes. */
  now?: () => number;
}

/**
 * A short, non-secret description of why a provider failed. Deliberately built from the status
 * code and a normalized reason rather than the raw error, so a provider error body can never carry
 * a key, a prompt or a stack trace into a log line.
 */
export function describeFailure(error: unknown): string {
  const status = (error as { status?: unknown })?.status;
  const message = String((error as { message?: unknown })?.message ?? '');
  if (status === 429) return /exceeded your current quota|quota_exceeded|billing/i.test(message) ? 'quota exhausted' : 'rate limited';
  if (status === 404) return 'model unavailable';
  if (status === 401 || status === 403) return 'not authorized';
  if (typeof status === 'number' && status >= 500) return `provider error ${status}`;
  if (/timeout|timed out|aborted|deadline/i.test(message)) return 'timeout';
  if (/fetch failed|network|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i.test(message)) return 'transport failure';
  if (typeof status === 'number') return `provider error ${status}`;
  return 'provider unavailable';
}

/**
 * How long a quota-exhausted primary is skipped entirely.
 *
 * A free-tier daily quota does not refill within a session. Re-attempting Gemini on every request
 * bought nothing and cost a full round trip — and, when the failure arrived as a timeout rather
 * than a 429, tens of seconds — before Groq was even asked. The breaker is time-boxed rather than
 * permanent so a per-minute limit, or a quota that resets while the process is up, recovers on its
 * own without a restart.
 */
export const PRIMARY_COOLDOWN_MS = 10 * 60 * 1000;
/** Failures worth skipping the primary for. A one-off transport blip is not one of them. */
const COOLDOWN_REASONS = ['quota exhausted', 'rate limited', 'not authorized', 'model unavailable'];

/**
 * Wraps the primary and secondary generators.
 *
 * Failover is triggered only by the primary *failing* — an exception, or a null/empty result
 * meaning it produced nothing usable. It is never triggered because we dislike an answer Gemini
 * successfully produced: judging content and retrying elsewhere would make the answer a matter of
 * provider roulette. When Gemini succeeds, Groq is not called at all.
 */
export function createFailoverLlm(config: FailoverConfig): LlmClient | null {
  const { gemini, groq, mode = 'auto', onGeneration } = config;
  // Per-client, not module state: two clients in one process must not share a breaker.
  let primarySkippedUntil = 0;
  const now = () => config.now?.() ?? Date.now();
  // 'groq' mode still needs Gemini for embeddings; it only redirects generation.
  const useGemini = mode !== 'groq' && gemini !== null;
  const useGroq = mode !== 'gemini' && groq !== null;
  if (!gemini && !groq) return null;

  async function generate<T>(
    primary: (() => Promise<T | null>) | null,
    secondary: (() => Promise<T | null>) | null,
    trace?: GenerationTrace,
  ): Promise<T | null> {
    // Only skip when there is somewhere to fail over to: with no secondary, a possibly recovered
    // primary is still better than no answer at all.
    if (primary && secondary && now() < primarySkippedUntil) {
      onGeneration?.('groq', 'gemini skipped: recent quota or authorization failure');
      primary = null;
    }
    if (primary) {
      try {
        const output = await primary();
        if (output != null) {
          if (trace) trace.provider = 'gemini';
          onGeneration?.('gemini');
          return output;
        }
        // A null result is a failure to produce anything usable, not a bad answer.
        if (!secondary) { onGeneration?.('deterministic', 'gemini returned no output'); return null; }
        onGeneration?.('groq', 'gemini returned no output');
      } catch (error) {
        const reason = describeFailure(error);
        if (COOLDOWN_REASONS.includes(reason)) primarySkippedUntil = now() + PRIMARY_COOLDOWN_MS;
        if (!secondary) { onGeneration?.('deterministic', `gemini ${reason}`); throw error; }
        onGeneration?.('groq', `gemini ${reason}`);
      }
    }
    if (!secondary) return null;
    try {
      const output = await secondary();
      if (output != null) {
        if (trace) trace.provider = 'groq';
        // When Groq is the only configured provider this is its first mention; when it is the
        // fallback the reason was already logged above.
        if (!primary) onGeneration?.('groq');
        return output;
      }
      onGeneration?.('deterministic', 'groq returned no output');
      return null;
    } catch (error) {
      onGeneration?.('deterministic', `groq ${describeFailure(error)}`);
      return null;
    }
  }

  return {
    // Gemini only, always. See the note at the top of this file.
    async embed(input, taskType) {
      if (!gemini) return null;
      return taskType ? gemini.embed(input, taskType) : gemini.embed(input);
    },

    async synthesize(bundle: EvidenceBundle, trace?: GenerationTrace) {
      return generate(
        useGemini && gemini ? () => gemini.synthesize(bundle) : null,
        useGroq && groq ? () => groq.synthesize(bundle) : null,
        trace,
      );
    },

    async structured(instruction, payload, schema, trace?: GenerationTrace) {
      return generate(
        useGemini && gemini?.structured ? () => gemini.structured!(instruction, payload, schema) : null,
        useGroq && groq ? () => groq.structured(instruction, payload, schema) : null,
        trace,
      );
    },
  };
}
