// The hybrid pipeline:
// validated request -> asset/event context -> deterministic safety pre-check -> intent-specific
// structured retrieval -> semantic/keyword knowledge retrieval -> evidence normalization ->
// fusion -> deterministic evidence strength -> grounded synthesis -> citation validation.
//
// The model never queries the database, never generates SQL and never decides evidence strength
// or safety status. Those are backend decisions made before and after the model runs.
import type { Answer, Evidence, InvestigateRequest, InvestigateResponse } from '@machine-memory/shared';
import { deriveSignals, fuseEvidence, hasAuthoritativeReference } from './evidence.js';
import type { LlmClient } from './llm.js';
import type { GenerationProvider, GenerationTrace } from './provider.js';
import {
  INSUFFICIENT_SUMMARY, NO_PROCEDURE_UNCERTAINTY,
  detectUnsafeRequest, requiresOperationalAuthorization, requiresVerifiedEvidence, safetyAnswer, scoreEvidence, validateCitations,
} from './rag.js';
import {
  loadAsset, retrieveEvidence,
  type Queryable, type RawEvidence, type RetrievalResult,
} from './retrieval.js';
import { buildBundle, deterministicAnswer, groundModelAnswer, parseModelAnswer, type DraftAnswer } from './synthesis.js';

export interface InvestigateDeps {
  db: Queryable;
  llm?: LlmClient | null;
  now?: Date;
  /** Reports degraded synthesis without leaking provider internals into the HTTP response. */
  onDegraded?: (stage: 'embedding' | 'synthesis' | 'validation') => void;
  /** Reports which generation provider produced the answer. Diagnostics only. */
  onGeneration?: (provider: GenerationProvider) => void;
}

export type InvestigateOutcome =
  | { status: 'ok'; response: InvestigateResponse }
  | { status: 'asset_not_found' };

async function draft(
  result: RetrievalResult, evidence: Evidence[], raw: RawEvidence[],
  question: string, deps: InvestigateDeps,
): Promise<DraftAnswer> {
  const fallback = () => { deps.onGeneration?.('deterministic'); return deterministicAnswer(result, evidence, raw); };
  if (!deps.llm || evidence.length === 0) return fallback();
  // A fresh trace per call: the composite records which provider answered without shared state.
  const trace: GenerationTrace = {};
  try {
    const output = await deps.llm.synthesize(buildBundle(result, evidence, raw, question), trace);
    if (output == null) { deps.onDegraded?.('synthesis'); return fallback(); }
    // Every provider's output goes through the same parser and the same citation validation.
    // An invented citation is stripped here whether Gemini or Groq produced it.
    const parsed = parseModelAnswer(output, evidence);
    if (!parsed) { deps.onDegraded?.('validation'); return fallback(); }
    deps.onGeneration?.(trace.provider ?? 'gemini');
    return groundModelAnswer(parsed, deterministicAnswer(result, evidence, raw));
  } catch {
    // Provider failure must not destroy an investigation that already has retrieved evidence.
    deps.onDegraded?.('synthesis');
    return fallback();
  }
}

export async function investigate(input: InvestigateRequest, deps: InvestigateDeps): Promise<InvestigateOutcome> {
  const unsafeRequest = detectUnsafeRequest(input.question);
  if (unsafeRequest || requiresOperationalAuthorization(input.question)) {
    const safe = safetyAnswer(input);
    if (safe) { deps.onGeneration?.('deterministic'); return { status: 'ok', response: safe }; }
  }
  const asset = await loadAsset(deps.db, input.assetCode);
  if (!asset) {
    return { status: 'asset_not_found' };
  }

  let embedding: number[] | null = null;
  if (deps.llm) {
    try { embedding = await deps.llm.embed(input.question); }
    catch { deps.onDegraded?.('embedding'); embedding = null; }
  }

  const result = await retrieveEvidence(deps.db, {
    intent: input.intent, assetCode: input.assetCode, eventCode: input.eventCode,
    question: input.question, embedding, now: deps.now,
  });
  if (!result) return { status: 'asset_not_found' };

  const { evidence, raw } = fuseEvidence(result);
  const signals = deriveSignals(result, raw);
  const strength = scoreEvidence(signals);

  // General reference questions may use reviewed material. This is evidence availability,
  // NOT authorization for operational instructions/limits (closed before retrieval above).
  const needsVerified = requiresVerifiedEvidence(input);
  const authoritative = hasAuthoritativeReference(raw);
  const safetyStatus: Answer['safetyStatus'] = needsVerified && !authoritative ? 'INSUFFICIENT' : 'NORMAL';

  const drafted = await draft(result, evidence, raw, input.question, deps);
  const uncertainties = [...drafted.uncertainties];
  if (safetyStatus === 'INSUFFICIENT' && !uncertainties.includes(NO_PROCEDURE_UNCERTAINTY)) {
    uncertainties.unshift(NO_PROCEDURE_UNCERTAINTY);
  }

  const answer: Answer = {
    summary: safetyStatus === 'INSUFFICIENT'
      ? `${INSUFFICIENT_SUMMARY} ${drafted.summary}`.trim()
      : drafted.summary,
    findings: drafted.findings,
    // Strength and safety status are always backend-assigned, never taken from model output.
    evidenceStrength: safetyStatus === 'INSUFFICIENT' && !signals.exactAsset ? 'INSUFFICIENT' : strength,
    uncertainties: uncertainties.slice(0, 8),
    safetyStatus,
  };

  try {
    validateCitations(answer, evidence);
  } catch {
    // Last resort: never emit an answer whose citations do not resolve.
    deps.onDegraded?.('validation');
    const safe = deterministicAnswer(result, evidence, raw);
    const repaired: Answer = { ...answer, summary: safe.summary, findings: safe.findings, uncertainties: safe.uncertainties.slice(0, 8) };
    try {
      validateCitations(repaired, evidence);
      return { status: 'ok', response: { answer: repaired, evidence } };
    } catch {
      return {
        status: 'ok',
        response: {
          answer: {
            summary: INSUFFICIENT_SUMMARY, findings: [], evidenceStrength: 'INSUFFICIENT',
            uncertainties: ['The retrieved evidence could not be assembled into a citable answer.'],
            safetyStatus: 'INSUFFICIENT',
          },
          evidence: [],
        },
      };
    }
  }
  return { status: 'ok', response: { answer, evidence } };
}
