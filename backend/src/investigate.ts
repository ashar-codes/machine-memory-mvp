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
import {
  INSUFFICIENT_SUMMARY, NO_PROCEDURE_UNCERTAINTY, UNSAFE_SUMMARY,
  detectUnsafeRequest, requiresVerifiedEvidence, scoreEvidence, validateCitations,
} from './rag.js';
import {
  loadAsset, retrieveEvidence, retrieveSafetyReferences,
  type Queryable, type RawEvidence, type RetrievalResult,
} from './retrieval.js';
import { buildBundle, deterministicAnswer, parseModelAnswer, type DraftAnswer } from './synthesis.js';

export interface InvestigateDeps {
  db: Queryable;
  llm?: LlmClient | null;
  now?: Date;
  /** Reports degraded synthesis without leaking provider internals into the HTTP response. */
  onDegraded?: (stage: 'embedding' | 'synthesis' | 'validation') => void;
}

export type InvestigateOutcome =
  | { status: 'ok'; response: InvestigateResponse }
  | { status: 'asset_not_found' };

function refusal(evidence: Evidence[], raw: RawEvidence[]): InvestigateResponse {
  const citable = evidence.filter((_, index) => raw[index]?.procedural);
  const findings: Answer['findings'] = citable.length ? [{
    title: 'Applicable published safety requirement',
    detail: 'Reviewed public safety material retrieved for this asset type is listed in the evidence. Hazardous-energy control is governed by the site programme and the published requirements; this system does not authorize work and cannot approve an exception.',
    citationIds: citable.map((item) => item.id),
  }] : [];
  return {
    answer: {
      summary: UNSAFE_SUMMARY,
      findings,
      evidenceStrength: 'INSUFFICIENT',
      uncertainties: [NO_PROCEDURE_UNCERTAINTY],
      safetyStatus: 'REFUSED',
    },
    evidence: citable,
  };
}

async function draft(
  result: RetrievalResult, evidence: Evidence[], raw: RawEvidence[],
  question: string, deps: InvestigateDeps,
): Promise<DraftAnswer> {
  const fallback = () => deterministicAnswer(result, evidence, raw);
  if (!deps.llm || evidence.length === 0) return fallback();
  try {
    const output = await deps.llm.synthesize(buildBundle(result, evidence, raw, question));
    if (output == null) { deps.onDegraded?.('synthesis'); return fallback(); }
    const parsed = parseModelAnswer(output, evidence);
    if (!parsed) { deps.onDegraded?.('validation'); return fallback(); }
    return parsed;
  } catch {
    // Provider failure must not destroy an investigation that already has retrieved evidence.
    deps.onDegraded?.('synthesis');
    return fallback();
  }
}

export async function investigate(input: InvestigateRequest, deps: InvestigateDeps): Promise<InvestigateOutcome> {
  const unsafeRequest = detectUnsafeRequest(input.question);
  const asset = await loadAsset(deps.db, input.assetCode);
  if (!asset) {
    if (unsafeRequest) {
      return { status: 'ok', response: { answer: refusal([], []).answer, evidence: [] } };
    }
    return { status: 'asset_not_found' };
  }

  let embedding: number[] | null = null;
  if (deps.llm) {
    try { embedding = await deps.llm.embed(input.question); }
    catch { deps.onDegraded?.('embedding'); embedding = null; }
  }

  // A prohibited request is refused before any history is summarized, but public safety
  // references are still retrieved so the refusal can point at real published requirements.
  if (unsafeRequest) {
    const safetyRaw = await retrieveSafetyReferences(deps.db, asset, input.question, embedding);
    const container: RetrievalResult = {
      intent: 'SAFETY', asset, event: null, eventCode: input.eventCode ?? null,
      anchorAt: (deps.now ?? new Date()).toISOString(), occurrences: null, recentWindow: null,
      fleetAssetCodes: [], evidence: safetyRaw, notes: [],
    };
    const fused = fuseEvidence(container);
    return { status: 'ok', response: refusal(fused.evidence, fused.raw) };
  }

  const result = await retrieveEvidence(deps.db, {
    intent: input.intent, assetCode: input.assetCode, eventCode: input.eventCode,
    question: input.question, embedding, now: deps.now,
  });
  if (!result) return { status: 'asset_not_found' };

  const { evidence, raw } = fuseEvidence(result);
  const signals = deriveSignals(result, raw);
  const strength = scoreEvidence(signals);

  // Safety gate after retrieval: questions that would need a verified procedure or numeric limit
  // stay INSUFFICIENT unless reviewed authoritative material was actually retrieved.
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
