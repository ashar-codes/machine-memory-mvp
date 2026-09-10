// Deterministic evidence fusion. Ranking, provenance and strength signals are computed here,
// before any model call, so a similarity score can never promote a record's authority.
import type { Evidence, Intent } from '@machine-memory/shared';
import type { EvidenceRole, RawEvidence, RetrievalResult } from './retrieval.js';
import type { EvidenceSignals } from './rag.js';

export const MAX_EVIDENCE_ITEMS = 12;

const AUTHORITY_WEIGHT: Record<string, number> = {
  REGULATOR: 3, OEM: 3, RESEARCH: 2.5, HISTORICAL: 1, UNVERIFIED: 0.5,
};

/** Roles that carry the substantive answer for each intent. Used for ranking and for onlyDemo. */
const PRIMARY_ROLES: Record<Intent, EvidenceRole[]> = {
  HISTORY: ['SAME_ASSET_HISTORY'],
  PREVIOUS_RESOLUTION: ['SAME_ASSET_HISTORY'],
  SIMILAR_INCIDENTS: ['FLEET_EXACT_CODE', 'FLEET_SEMANTIC', 'SAME_ASSET_HISTORY'],
  RECENT_CHANGES: ['RECENT_CHANGE'],
  TECHNICAL_GUIDANCE: ['TECHNICAL_REFERENCE', 'SAFETY_REFERENCE'],
  GENERAL: ['SAME_ASSET_HISTORY', 'FLEET_EXACT_CODE', 'RECENT_CHANGE', 'TECHNICAL_REFERENCE', 'SAFETY_REFERENCE'],
  SAFETY: ['SAFETY_REFERENCE'],
};

function fingerprint(item: RawEvidence): string {
  return [item.kind, item.role, item.assetCode ?? '', item.timestamp ?? '', item.title, item.excerpt].join('|');
}

/**
 * Composite ordinal score. Authority and role dominate; similarity and keyword rank only
 * reorder items that are already admissible for the intent.
 */
export function rankScore(item: RawEvidence, intent: Intent, selected: RetrievalResult['asset']): number {
  let score = AUTHORITY_WEIGHT[item.authorityClass] ?? 0.5;
  if (PRIMARY_ROLES[intent].includes(item.role)) score += 2;
  if (item.role === 'CONTEXT') score -= 1;
  if (item.similarity != null) score += Math.max(0, Math.min(1, item.similarity)) * 1.5;
  if (item.keywordRank != null) score += Math.max(0, Math.min(1, item.keywordRank)) * 0.5;

  const { manufacturer, model } = item.applicability;
  if (manufacturer && selected.manufacturer) {
    score += manufacturer === selected.manufacturer ? 0.5 : -1;
  }
  if (model && selected.model) {
    score += model === selected.model ? 0.5 : -1;
  }
  // Mild recency preference so a timeline reads newest-first among equals.
  if (item.timestamp) {
    const age = Date.now() - new Date(item.timestamp).valueOf();
    if (Number.isFinite(age)) score += Math.max(0, 0.5 - age / (365 * 86_400_000));
  }
  return score;
}

/** Deduplicates, ranks, caps and assigns stable citation IDs in presentation order. */
export function fuseEvidence(result: RetrievalResult, limit = MAX_EVIDENCE_ITEMS): {
  evidence: Evidence[];
  raw: RawEvidence[];
} {
  const seen = new Set<string>();
  const unique: RawEvidence[] = [];
  for (const item of result.evidence) {
    const key = fingerprint(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  const ordered = unique
    .map((item, index) => ({ item, index, score: rankScore(item, result.intent, result.asset) }))
    // Stable: equal scores keep retrieval order, which is already deterministic newest-first.
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, limit)
    .map((entry) => entry.item);

  const evidence: Evidence[] = ordered.map((item, index) => ({
    id: `EV-${index + 1}`,
    title: item.title,
    sourceType: item.sourceType,
    authorityClass: item.authorityClass,
    excerpt: item.excerpt,
    assetCode: item.assetCode,
    timestamp: item.timestamp,
    recordOrigin: item.recordOrigin,
    sourceUrl: item.sourceUrl,
  }));
  return { evidence, raw: ordered };
}

// Everything a user created locally. None of it may lift an answer out of demo status.
const DEMO_ORIGINS = ['synthetic_demo', 'user_demo', 'user_import', 'simulation'];

/**
 * Derives strength signals from retrieved evidence only.
 *
 * `conflicting` is not automatically detected in v1: no reliable deterministic contradiction test
 * exists over free-text maintenance narratives, and a false positive would silently suppress a
 * correct answer. It stays available in the scoring contract and is documented as a limitation.
 */
export function deriveSignals(result: RetrievalResult, retained: RawEvidence[]): EvidenceSignals {
  const primary = PRIMARY_ROLES[result.intent];
  const substantive = retained.filter((item) => primary.includes(item.role));
  const sameAsset = retained.filter((item) => item.role === 'SAME_ASSET_HISTORY');
  const compatibleFleet = retained.filter((item) => item.role === 'FLEET_EXACT_CODE'
    && (!item.applicability.manufacturer || !result.asset.manufacturer
      || item.applicability.manufacturer === result.asset.manufacturer));

  return {
    exactAsset: sameAsset.length > 0,
    exactEvent: Boolean(result.eventCode) && sameAsset.some((item) =>
      ['ASSET_EVENT', 'INCIDENT', 'RESOLUTION', 'WORK_ORDER'].includes(item.kind)),
    priorOccurrences: Math.max(0, result.occurrences?.previousCount ?? 0),
    linkedResolution: sameAsset.some((item) => item.kind === 'RESOLUTION' || item.kind === 'WORK_ORDER'),
    crossAsset: compatibleFleet.length > 0,
    authoritativeTechnical: retained.some((item) => item.procedural && item.sourceType === 'TECHNICAL_REFERENCE'),
    authoritativeSafety: retained.some((item) => item.procedural && item.sourceType === 'SAFETY_REFERENCE'),
    conflicting: false,
    // An unrelated public reference must not lift synthetic machine history out of demo status.
    onlyDemo: substantive.length === 0 || substantive.every((item) => DEMO_ORIGINS.includes(item.recordOrigin)),
  };
}

export function hasAuthoritativeReference(retained: RawEvidence[]): boolean {
  return retained.some((item) => item.procedural);
}
