// Deterministic evidence fusion. Ranking, provenance and strength signals are computed here,
// before any model call, so a similarity score can never promote a record's authority.
import type { Evidence, Intent } from '@machine-memory/shared';
import type { EvidenceRole, RawEvidence, RetrievalResult } from './retrieval.js';
import type { EvidenceSignals } from './rag.js';

export const MAX_EVIDENCE_ITEMS = 12;
/**
 * How many chunks one document may contribute to a single answer.
 *
 * Without this, a large reviewed corpus fills every slot with near-duplicate passages from the
 * same two or three documents, and a smaller but highly relevant source — a manual a technician
 * uploaded for this exact model — is never seen even when it is the top vector hit. The cap
 * changes nothing about authority: relevance orders admitted reference passages, and
 * `procedural` still decides what may be quoted as guidance.
 */
export const MAX_PER_SOURCE = 3;

const AUTHORITY_WEIGHT: Record<string, number> = {
  REGULATOR: 3, OEM: 3, RESEARCH: 2.5, HISTORICAL: 1, UNVERIFIED: 0.5,
};

/** Roles that carry the substantive answer for each intent. Used for ranking and for onlyDemo. */
const PRIMARY_ROLES: Record<Intent, EvidenceRole[]> = {
  HISTORY: ['SAME_ASSET_HISTORY', 'AGGREGATE_FACT'],
  PREVIOUS_RESOLUTION: ['SAME_ASSET_HISTORY', 'AGGREGATE_FACT'],
  SIMILAR_INCIDENTS: ['FLEET_EXACT_CODE', 'FLEET_SEMANTIC', 'SAME_ASSET_HISTORY'],
  RECENT_CHANGES: ['RECENT_CHANGE', 'AGGREGATE_FACT'],
  TECHNICAL_GUIDANCE: ['TECHNICAL_REFERENCE', 'SAFETY_REFERENCE'],
  GENERAL: ['SAME_ASSET_HISTORY', 'FLEET_EXACT_CODE', 'RECENT_CHANGE', 'TECHNICAL_REFERENCE', 'SAFETY_REFERENCE', 'AGGREGATE_FACT'],
  SAFETY: ['SAFETY_REFERENCE'],
};

/**
 * Canonical identity of the underlying record.
 *
 * Deliberately excludes `role`: a role is the reason a record was retrieved, not a record. Keying
 * on it meant one work order reached through two retrieval roles survived as two evidence items,
 * and an answer then reported four maintenance records where the database held two.
 *
 * Records without a database identity (aggregates, and any future synthesized item) fall back to
 * their content, which is still role-independent.
 */
function fingerprint(item: RawEvidence): string {
  return item.sourceId
    ?? [item.kind, item.assetCode ?? '', item.timestamp ?? '', item.title, item.excerpt].join('|');
}

/**
 * Role and relevance order evidence; authority is a small reference tie-break, never admission.
 */
export function rankScore(item: RawEvidence, intent: Intent, selected: RetrievalResult['asset']): number {
  let score = (AUTHORITY_WEIGHT[item.authorityClass] ?? 0.5) * (item.kind === 'KNOWLEDGE' ? 0.05 : 1);
  if (PRIMARY_ROLES[intent].includes(item.role)) score += 2;
  if (item.role === 'CONTEXT') score -= 1;
  if (item.similarity != null) score += Math.max(0, Math.min(1, item.similarity)) * 3;
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
  // Same record, two roles: keep the one that ranks higher for this intent, so deduplicating
  // never costs the record its most relevant framing.
  const best = new Map<string, RawEvidence>();
  for (const item of result.evidence) {
    const key = fingerprint(item);
    const existing = best.get(key);
    if (!existing || rankScore(item, result.intent, result.asset) > rankScore(existing, result.intent, result.asset)) {
      best.set(key, item);
    }
  }
  const all = [...best.values()];
  // A computed aggregate is not a candidate competing with samples — it is the record that proves
  // an exact total. Ranked normally it scored below the very rows it summarises and was pushed out
  // by the candidate cap, which left "576 events" with nothing citable behind it. Aggregates are
  // few, deterministic and tiny, so they are admitted first and the cap applies to the rest.
  const aggregates = all.filter((item) => item.role === 'AGGREGATE_FACT');
  const unique = all.filter((item) => item.role !== 'AGGREGATE_FACT');
  const scored = unique
    .map((item, index) => ({ item, index, score: rankScore(item, result.intent, result.asset) }))
    // Stable: equal scores keep retrieval order, which is already deterministic newest-first.
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));

  // Highest-scoring first, but no single document may take more than its share of the answer.
  // Anything held back is reconsidered afterwards, so the cap can never shrink the evidence set.
  const perSource = new Map<string, number>();
  const selected: typeof scored = [];
  const aggregateSlots = Math.min(aggregates.length, Math.max(0, limit - 1));
  const deferred: typeof scored = [];
  for (const entry of scored) {
    if (selected.length >= limit - aggregateSlots) break;
    const key = entry.item.sourceKey;
    if (!key) { selected.push(entry); continue; }
    const used = perSource.get(key) ?? 0;
    if (used >= MAX_PER_SOURCE) { deferred.push(entry); continue; }
    perSource.set(key, used + 1);
    selected.push(entry);
  }
  for (const entry of deferred) {
    if (selected.length >= limit) break;
    selected.push(entry);
  }
  const ordered = [
    // Aggregates lead: an answer's exact figures should cite the first thing a reader sees.
    ...aggregates.slice(0, aggregateSlots),
    ...selected
      .sort((a, b) => (b.score - a.score) || (a.index - b.index))
      .map((entry) => entry.item),
  ].slice(0, limit);

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
