// Grounded synthesis. The model receives a normalized evidence bundle and nothing else:
// no database handle, no SQL, no tools. Its output is parsed, repaired or discarded here.
import type { Answer, Evidence } from '@machine-memory/shared';
import type { RawEvidence, RetrievalResult } from './retrieval.js';
import { detectUnsafeRequest, requiresOperationalAuthorization } from './rag.js';

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
  The backend renders these separately. Do not generate numbers, dates, asset IDs, event codes,
  machine values, diagnoses or recorded repair outcomes. Supply qualitative evidence context only.
  Do not infer a machine condition or authorize an action. The backend constructs the summary.

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

// Only evidence-level language belongs in generated commentary. Unknown domain terms/names
// are not silently treated as qualitative: the exact recorded account is rendered separately.
const COMMENTARY_WORDS = new Set(`a an the and or but rather than with without from to for of in on
  by as at this that these those it its they their them is are was were be been being do does did
  not no cannot can could should would will must might only also however therefore because
  evidence record records recorded source sources history historical reference references research
  documentation context information available availability missing absent absence limited limitation
  limitations incomplete completeness uncertain uncertainty uncertainties unverified reviewed review
  synthetic demonstration demo simulation simulated user entered imported public provenance
  describe describes describing provide provides support supports supporting establish establishes
  indicate indicates indication suggest suggests consistent inconsistent conflict conflicting
  separate distinction distinguish authorization authorize authorizes authorized approval approved
  procedure procedures procedural instruction instructions work perform current present condition conditions
  interpretation caution cautious qualified personnel additional further independent verification
  validation required needed necessary relevant relevance applicability general specific qualitative
  summary observation observations finding findings recorded logged versus basis scope alone
  corroboration corroborate inconclusive conclusive sufficient insufficient verified confirm
  confirms confirmed determine determines determining document documents documented between
  understand understanding compare comparison explain explanation contextually`.split(/\s+/));

/**
 * Free generation is limited to qualitative evidence context, not operational facts. Numeric
 * facts (even correct ones), identities, dates, machine diagnoses/outcomes and instructions go
 * through deterministic rendering instead. This conservative English filter is deliberately
 * lossy; it is not general semantic entailment verification or a source-approval mechanism.
 */
export function isQualitativeCommentary(value: string): boolean {
  const text = value.normalize('NFKC');
  if (!/^[A-Za-z\s.,;:!?()'’“”"-]+$/.test(text)
    || (text.toLowerCase().match(/[a-z]+/g) ?? []).some((word) => !COMMENTARY_WORDS.has(word))) return false;
  // Permission/provenance assertions are not model-owned either. Only these explicit
  // non-authorization disclaimers may use approval language in generated commentary.
  const permissionText = text.replace(/\b(?:not an approved procedure|do not authorize work|rather than authorization to perform work)\b/gi, '');
  if (/\b(?:authoriz\w*|approv\w*)\b/i.test(permissionText)
    || /\bno\s+(?:supporting\s+)?(?:records?|evidence|history)\b/i.test(text)) return false;
  return /\b(evidence|records?|sources?|history|historical|references?|research|documentation)\b/i.test(text)
    && !detectUnsafeRequest(text) && !requiresOperationalAuthorization(text);
}

/** Summary/exact facts are backend-owned; only bounded qualitative findings may be added. */
export function groundModelAnswer(draft: DraftAnswer, facts: DraftAnswer): DraftAnswer {
  const qualitative = draft.findings.filter((finding) => isQualitativeCommentary(`${finding.title}. ${finding.detail}`));
  return {
    summary: facts.summary,
    findings: [...facts.findings.slice(0, MAX_FINDINGS - 2), ...qualitative.slice(0, 2)],
    uncertainties: [...facts.uncertainties, ...draft.uncertainties.filter(isQualitativeCommentary)].slice(0, 8),
  };
}

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

  // A total must cite evidence that contains the total. Sample rows are examples, not proof.
  const aggregateIds = cite((item) => item.role === 'AGGREGATE_FACT');
  const historyIds = cite((item) => item.role === 'SAME_ASSET_HISTORY');
  const fleetIds = cite((item) => item.role === 'FLEET_EXACT_CODE');
  const changeIds = cite((item) => item.role === 'RECENT_CHANGE');
  const referenceIds = cite((item) => item.procedural);
  const resolutionIds = cite((item) => item.kind === 'RESOLUTION' || item.kind === 'WORK_ORDER');

  // Asset-wide questions are answered from the asset's own totals, never by counting samples.
  if (result.assetSummary && result.assetSummary.totalEvents > 0) {
    const summary = result.assetSummary;
    const period = summary.firstAt && summary.lastAt
      ? ` recorded between ${formatDate(summary.firstAt)} and ${formatDate(summary.lastAt)}` : '';
    parts.push(`${asset} has ${summary.totalEvents} recorded events across ${summary.distinctEventCodes} distinct event codes${period}.`);
    findings.push({
      title: 'Recorded event totals for this turbine',
      detail: `${asset} has ${summary.totalEvents} recorded events across ${summary.distinctEventCodes} distinct event codes${period}. These totals were computed in SQL over stored rows, not counted from the sample listed below.`,
      citationIds: aggregateIds.slice(0, 2),
    });
    if (summary.topCodes.length) {
      findings.push({
        title: 'Most frequently recorded codes',
        detail: summary.topCodes.slice(0, 5)
          .map((item) => `${item.eventCode}${item.title ? ` (${item.title})` : ''}: ${item.occurrences}`)
          .join('; ') + '. Counts computed in SQL.',
        citationIds: aggregateIds.slice(0, 2),
      });
    }
  }

  if (result.occurrences && (historyIds.length || aggregateIds.length)) {
    const { previousCount, totalIncludingSelected, firstAt, lastAt } = result.occurrences;
    parts.push(previousCount > 0
      ? `${code} has ${previousCount} recorded previous occurrence${previousCount === 1 ? '' : 's'} on ${asset} before the selected event.`
      : `No previous occurrence of ${code} is recorded on ${asset} before the selected event.`);
    if (previousCount > 0) {
      findings.push({
        title: 'Recurrence on this asset',
        detail: `The database records ${previousCount} earlier occurrence${previousCount === 1 ? '' : 's'} of ${code} on ${asset}, between ${formatDate(firstAt)} and ${formatDate(lastAt)}; ${totalIncludingSelected} total including the selected occurrence. This count was computed in SQL and excludes the selected occurrence from the previous count.`,
        // Aggregate first: the cited record has to be the one that carries the figure.
        citationIds: [...aggregateIds, ...historyIds].slice(0, 6),
      });
    }
  }
  if (resolutionIds.length) {
    findings.push({
      title: 'Previously recorded maintenance outcome',
      detail: `${resolutionIds.length} retrieved maintenance record${resolutionIds.length === 1 ? '' : 's'} (work orders or logged resolutions) are shown for ${code} on ${asset}. This is a retrieved sample, not a total count. They describe what was previously recorded, not an approved current procedure.`,
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
  // Retrieved material that carries no procedural authority still answers questions *about what
  // the document says*. Without this branch an uploaded document could rank first and still be
  // absent from the answer, because the only reference finding required `procedural`.
  //
  // The detail quotes the retrieved excerpt verbatim, so it is grounded by construction, and it is
  // framed as reported speech: what the source states, never what is approved.
  const unverifiedKnowledge = evidence
    .map((item, index) => ({ item, source: raw[index] }))
    .filter(({ item, source }) => source?.kind === 'KNOWLEDGE' && !source.procedural && item.excerpt.trim());
  if (unverifiedKnowledge.length) {
    const lead = unverifiedKnowledge[0];
    const label = lead.source.recordOrigin === 'user_import' ? 'an uploaded, unreviewed source' : 'an unverified source';
    parts.push(`Retrieved material from ${label} was found.`);
    findings.push({
      title: `Retrieved source: ${lead.item.title}`,
      detail: `${lead.item.title} states: "${lead.item.excerpt.trim()}" This is ${label} (${lead.item.authorityClass}, ${lead.source.recordOrigin}). It records what that document says; it is not an approved procedure and does not authorize work.`,
      citationIds: unverifiedKnowledge.slice(0, 3).map(({ item }) => item.id),
    });
  }

  if (referenceIds.length) {
    // Report what the references say, not merely that they exist. Excerpts are copied verbatim
    // from retrieved rows — the same mechanism used for every other fact here — because a finding
    // that only announces "reference material was retrieved" answers nothing and sends the reader
    // to the evidence pane. Free generation still may not paraphrase any of it.
    //
    // Grouped by document rather than by chunk: six passages of one report are one source, and
    // naming it six times reads as six sources.
    const byDocument = new Map<string, { id: string; title: string; excerpt: string }>();
    for (const id of referenceIds) {
      const index = evidence.findIndex((item) => item.id === id);
      const item = evidence[index];
      if (!item) continue;
      const key = raw[index]?.sourceKey ?? item.title;
      if (!byDocument.has(key)) byDocument.set(key, { id, title: key, excerpt: item.excerpt.trim() });
    }
    const documents = [...byDocument.values()];
    const quoted = documents.filter((document) => document.excerpt).slice(0, 2);
    const remaining = documents.slice(quoted.length).map((document) => document.title);
    parts.push(documents.length === 1
      ? `Reviewed public reference material was retrieved from ${documents[0].title}.`
      : `Reviewed public reference material was retrieved from ${documents.length} sources.`);
    findings.push({
      title: quoted.length ? `Reference: ${quoted[0].title}` : 'Public reference material',
      detail: [
        ...quoted.map((document) => `${document.title} states: "${document.excerpt}"`),
        remaining.length ? `Also retrieved: ${remaining.join('; ')}.` : '',
        'This is reviewed published material applicable to this asset type. It is not specific to this turbine or its manufacturer unless the excerpt says so, and it does not authorize work.',
      ].filter(Boolean).join(' '),
      citationIds: referenceIds.slice(0, 6),
    });
  }

  // Values are copied from retrieved rows, never paraphrased by generation. Label excerpts as
  // recorded accounts, not diagnoses or instructions. Evidence remains available in the pane
  // if an unsafe/unverified procedural passage cannot be displayed as an answer finding.
  const recorded = evidence.map((item, index) => ({ item, raw: raw[index] })).filter(({ raw }) => raw
    && (['RESOLUTION', 'WORK_ORDER'].includes(raw.kind) || raw.role === 'RECENT_CHANGE'));
  for (const { item, raw: source } of recorded.slice(0, 3)) {
    const account = source.recordedAccount;
    const recordedText = account ? [account.rootCause && `Recorded cause: ${account.rootCause}`,
      account.outcome && `Recorded outcome: ${account.outcome}`, account.component && `Component: ${account.component}`,
      account.downtimeMinutes !== null && `Downtime: ${account.downtimeMinutes} min`].filter(Boolean).join(' — ') : item.excerpt;
    if (detectUnsafeRequest(recordedText) || requiresOperationalAuthorization(recordedText)) continue;
    const excerpt = recordedText.replace(/\b(?:EV|EVIDENCE)[-\u2010-\u2015 ]\d+\b/gi, '[unverified reference omitted]');
    findings.push({ title: 'Recorded account — not an approved procedure',
      detail: `${item.assetCode ?? asset} · ${formatDate(item.timestamp)} · ${item.recordOrigin}: “${excerpt}”`,
      citationIds: [item.id] });
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
