// Grounded synthesis. The model receives a normalized evidence bundle and nothing else:
// no database handle, no SQL, no tools. Its output is parsed, repaired or discarded here.
import type { Answer, Evidence } from '@machine-memory/shared';
import type { RawEvidence, RetrievalResult } from './retrieval.js';

const MAX_SUMMARY = 1200;
const MAX_DETAIL = 1200;
const MAX_TITLE = 160;
const MAX_FINDINGS = 8;
const MAX_UNCERTAINTIES = 6;

export const SYSTEM_INSTRUCTIONS = `You are the synthesis stage of an asset-conditioned retrieval system for wind turbine maintenance.

Absolute rules:
- Answer ONLY from the supplied evidence. If the evidence does not support a claim, do not make it.
- Never invent maintenance history, dates, counts, components or outcomes.
- Never invent a citation. Cite only the evidence IDs supplied to you, exactly as given.
- Never manufacture technical procedures, torque values, pressure limits, voltages, setpoints,
  protection settings or lockout/tagout sequences. If they are not in the evidence, say they are not available.
- A historical record describes what someone did before. It is NOT an approved current procedure
  and never authorizes work. State this distinction whenever you report a past resolution.
- Evidence marked synthetic_demo or user_demo is fictional demonstration data. Label it as such.
- Evidence marked user_import was uploaded by a user and is unreviewed. Evidence marked simulation is an
  injected test fault, not real telemetry. Say so whenever you rely on either.
- Refuse any request to bypass, disable, defeat or override protection, or to operate faulted or
  energized equipment. Do not provide partial instructions for such work.
- State uncertainty plainly. Do not express confidence as a percentage or probability.
- Counts, timestamps and date windows in the structured facts were computed by the backend in SQL.
  Reuse them verbatim; do not recount, re-derive or adjust them.

Return ONLY a JSON object, with no code fences and no commentary, in exactly this shape:
{"summary": string, "findings": [{"title": string, "detail": string, "citationIds": [string]}], "uncertainties": [string]}

Every finding must carry at least one citationId drawn from the supplied evidence.
Do not include an evidenceStrength, confidence or safetyStatus field: the backend assigns those.`;

export interface EvidenceBundle {
  question: string;
  intent: string;
  asset: { assetCode: string; assetType: string; manufacturer: string | null; model: string | null; status: string };
  selectedEvent: { eventCode: string; title: string; subsystem: string | null; severity: string; occurredAt: string; cleared: boolean } | null;
  structuredFacts: Record<string, unknown>;
  evidence: {
    id: string; title: string; sourceType: string; authorityClass: string; recordOrigin: string;
    assetCode: string | null; timestamp: string | null; sourceUrl: string | null;
    mayBeQuotedAsGuidance: boolean; excerpt: string;
  }[];
  retrievalNotes: string[];
}

export function buildBundle(result: RetrievalResult, evidence: Evidence[], raw: RawEvidence[], question: string): EvidenceBundle {
  const structuredFacts: Record<string, unknown> = {};
  if (result.occurrences) {
    structuredFacts.previousOccurrencesOfThisCodeOnThisAsset = result.occurrences.previousCount;
    structuredFacts.totalOccurrencesIncludingSelected = result.occurrences.totalIncludingSelected;
    structuredFacts.earliestPreviousOccurrenceAt = result.occurrences.firstAt;
    structuredFacts.latestPreviousOccurrenceAt = result.occurrences.lastAt;
    structuredFacts.previousOccurrencesByRecordOrigin = result.occurrences.byOrigin;
  }
  if (result.recentWindow) {
    structuredFacts.changeWindowStart = result.recentWindow.startIso;
    structuredFacts.changeWindowEnd = result.recentWindow.endIso;
  }
  if (result.fleetAssetCodes.length) structuredFacts.otherAssetsWithSameEventCode = result.fleetAssetCodes;

  return {
    question, intent: result.intent,
    asset: {
      assetCode: result.asset.assetCode, assetType: result.asset.assetType,
      manufacturer: result.asset.manufacturer, model: result.asset.model, status: result.asset.status,
    },
    selectedEvent: result.event ? {
      eventCode: result.event.eventCode, title: result.event.title, subsystem: result.event.subsystem,
      severity: result.event.severity, occurredAt: result.event.occurredAt, cleared: result.event.clearedAt !== null,
    } : null,
    structuredFacts,
    evidence: evidence.map((item, index) => ({
      id: item.id, title: item.title, sourceType: item.sourceType, authorityClass: item.authorityClass,
      recordOrigin: item.recordOrigin, assetCode: item.assetCode, timestamp: item.timestamp,
      sourceUrl: item.sourceUrl, mayBeQuotedAsGuidance: raw[index]?.procedural ?? false, excerpt: item.excerpt,
    })),
    retrievalNotes: result.notes,
  };
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export type DraftAnswer = Pick<Answer, 'summary' | 'findings' | 'uncertainties'>;

/**
 * Strict parse with bounded deterministic repair.
 * Unknown citation IDs are stripped; a finding left with no valid citation is dropped;
 * if nothing survives, or the summary is missing, the caller falls back to the deterministic answer.
 */
export function parseModelAnswer(raw: unknown, evidence: Evidence[]): DraftAnswer | null {
  let candidate: unknown = raw;
  if (typeof candidate === 'string') {
    const stripped = candidate.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { candidate = JSON.parse(stripped); } catch { return null; }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const body = candidate as Record<string, unknown>;

  const summary = clean(body.summary, MAX_SUMMARY);
  if (!summary) return null;

  const known = new Set(evidence.map((item) => item.id));
  const findings: Answer['findings'] = [];
  if (Array.isArray(body.findings)) {
    for (const entry of body.findings.slice(0, MAX_FINDINGS)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      const title = clean(record.title, MAX_TITLE);
      const detail = clean(record.detail, MAX_DETAIL);
      const citationIds = Array.isArray(record.citationIds)
        ? [...new Set(record.citationIds.filter((id): id is string => typeof id === 'string' && known.has(id)))]
        : [];
      if (!title || !detail || citationIds.length === 0) continue;
      findings.push({ title, detail, citationIds });
    }
  }
  if (evidence.length > 0 && findings.length === 0) return null;

  const uncertainties = Array.isArray(body.uncertainties)
    ? body.uncertainties.map((item) => clean(item, MAX_DETAIL)).filter(Boolean).slice(0, MAX_UNCERTAINTIES)
    : [];
  return { summary, findings, uncertainties };
}

function formatDate(value: string | null): string {
  if (!value) return 'an unrecorded date';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? 'an unrecorded date' : parsed.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

const DEMO_ORIGINS = ['synthetic_demo', 'user_demo', 'user_import', 'simulation'];

function provenanceNote(evidence: Evidence[]): string[] {
  const notes: string[] = [];
  if (evidence.some((item) => DEMO_ORIGINS.includes(item.recordOrigin))) {
    notes.push('Some or all of the supporting records are synthetic demonstration, user-entered, user-imported or simulated data, not genuine plant history.');
  }
  notes.push('Historical records describe what was done previously. They are not an approved procedure and do not authorize work on this asset.');
  return notes;
}

/**
 * Grounded answer assembled from retrieved evidence with no model involvement.
 * Used when no model is configured, when synthesis fails, and when model output fails validation.
 */
export function deterministicAnswer(result: RetrievalResult, evidence: Evidence[], raw: RawEvidence[]): DraftAnswer {
  const cite = (predicate: (item: RawEvidence) => boolean): string[] =>
    evidence.filter((_, index) => raw[index] && predicate(raw[index])).map((item) => item.id);

  const asset = result.asset.assetCode;
  const code = result.eventCode ?? 'the selected event';
  const findings: Answer['findings'] = [];
  const parts: string[] = [];

  const historyIds = cite((item) => item.role === 'SAME_ASSET_HISTORY');
  const fleetIds = cite((item) => item.role === 'FLEET_EXACT_CODE');
  const changeIds = cite((item) => item.role === 'RECENT_CHANGE');
  const referenceIds = cite((item) => item.procedural);
  const resolutionIds = cite((item) => item.kind === 'RESOLUTION' || item.kind === 'WORK_ORDER');

  if (result.occurrences && historyIds.length) {
    const { previousCount, firstAt, lastAt } = result.occurrences;
    parts.push(previousCount > 0
      ? `${code} has ${previousCount} recorded previous occurrence${previousCount === 1 ? '' : 's'} on ${asset} before the selected event.`
      : `No previous occurrence of ${code} is recorded on ${asset} before the selected event.`);
    if (previousCount > 0) {
      findings.push({
        title: 'Recurrence on this asset',
        detail: `The database records ${previousCount} earlier occurrence${previousCount === 1 ? '' : 's'} of ${code} on ${asset}, between ${formatDate(firstAt)} and ${formatDate(lastAt)}. This count was computed in SQL and excludes the selected occurrence.`,
        citationIds: historyIds.slice(0, 6),
      });
    }
  }
  if (resolutionIds.length) {
    findings.push({
      title: 'Previously recorded maintenance outcome',
      detail: `${resolutionIds.length} maintenance record${resolutionIds.length === 1 ? '' : 's'} (work orders or logged resolutions) exist for ${code} on ${asset}. They describe what was previously recorded, not an approved current procedure.`,
      citationIds: resolutionIds.slice(0, 6),
    });
    if (!parts.length) parts.push(`Recorded maintenance outcomes exist for ${code} on ${asset}.`);
  }
  if (fleetIds.length) {
    const codes = result.fleetAssetCodes.join(', ');
    parts.push(`The same event code is also recorded on ${codes}.`);
    findings.push({
      title: 'Fleet occurrences of the same event code',
      detail: `Exact same-code matches were found on other assets (${codes}). These are separate assets and their history does not establish the cause on ${asset}.`,
      citationIds: fleetIds.slice(0, 6),
    });
  }
  if (changeIds.length && result.recentWindow) {
    parts.push(`${changeIds.length} change record${changeIds.length === 1 ? '' : 's'} fall inside the ${formatDate(result.recentWindow.startIso)} to ${formatDate(result.recentWindow.endIso)} window.`);
    findings.push({
      title: 'Changes in the preceding window',
      detail: `Maintenance, component, work-order and event records between ${formatDate(result.recentWindow.startIso)} and ${formatDate(result.recentWindow.endIso)} are listed in the evidence, newest first.`,
      citationIds: changeIds.slice(0, 6),
    });
  }
  if (referenceIds.length) {
    parts.push('Reviewed public reference material was retrieved.');
    findings.push({
      title: 'Public reference material',
      detail: 'Reviewed public technical or regulatory references applicable to this asset type were retrieved. They are general published material and are not specific to this turbine or its manufacturer unless stated in the excerpt.',
      citationIds: referenceIds.slice(0, 6),
    });
  }

  if (!findings.length) {
    // A dataset can record that something happened without recording what was done about it. The
    // real Penmanshiel public data is exactly that: genuine operational events, no work orders and
    // no repair narratives. Saying "no records were retrieved" would wrongly imply the event
    // itself is unknown, so the two cases are reported differently.
    const priorOccurrences = result.occurrences?.previousCount ?? 0;
    if (priorOccurrences > 0) {
      return {
        summary: `${code} has ${priorOccurrences} recorded previous occurrence${priorOccurrences === 1 ? '' : 's'} on ${asset}, but no verified maintenance resolution is present for it in the current data.`,
        findings: [],
        uncertainties: [
          'Previous operational occurrences are available, but this data source contains no work order, root cause or repair record for them. Absence of a recorded resolution does not mean no work was carried out.',
          ...result.notes,
        ],
      };
    }
    return {
      summary: `No supporting records were retrieved for ${code} on ${asset}.`,
      findings: [],
      uncertainties: ['Nothing in the database matched this asset and event code. Absence of records does not mean the fault has not occurred.', ...result.notes],
    };
  }
  return {
    summary: parts.join(' '),
    findings,
    uncertainties: [...provenanceNote(evidence), ...result.notes],
  };
}
