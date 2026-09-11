// Structured and semantic retrieval. Every statement here is repository-owned, parameterized SQL.
// The language model never sees this file's queries, never supplies SQL and never reaches the database.
import { RECORD_ORIGINS, type AuthorityClass, type Intent, type RecordOrigin } from '@machine-memory/shared';
import { DEFAULT_EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from './config.js';

/** Minimal database surface. `pg.Pool` is adapted to this in app.ts so tests can supply a fake. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export const RECENT_CHANGE_WINDOW_DAYS = 30;

/** Only explicit supported day windows are understood; never silently coerce a request. */
export function recentChangeDays(question: string): number | null {
  const durations = [...question.matchAll(/\b(\d+(?:\.\d+)?|[a-z]+)[ -]+(days?|weeks?|months?|years?|hours?)\b/gi)];
  if (!durations.length) return /\b(last|past|previous)\s+(?:\d+|a|an|one|two|seven|thirty|ninety)\b/i.test(question)
    ? null : RECENT_CHANGE_WINDOW_DAYS;
  if (durations.length !== 1) return null;
  const [, amount, unit] = durations[0];
  return /^days?$/i.test(unit) && ['7', '30', '90'].includes(amount) ? Number(amount) : null;
}
const MAX_STRUCTURED_ROWS = 20;
const MAX_KNOWLEDGE_CANDIDATES = 200;
// Calibrated on this Gemini corpus: unrelated queries ~0.49, relevant paraphrases >0.60.
// This is a demo retrieval threshold, not a universal semantic relevance guarantee.
export const MIN_SEMANTIC_SIMILARITY = 0.60;
export const MIN_KEYWORD_RANK = 0.01;

export type EvidenceRole =
  | 'SAME_ASSET_HISTORY' | 'FLEET_EXACT_CODE' | 'FLEET_SEMANTIC'
  | 'RECENT_CHANGE' | 'TECHNICAL_REFERENCE' | 'SAFETY_REFERENCE' | 'CONTEXT'
  | 'AGGREGATE_FACT';

export type EvidenceKind =
  | 'ASSET_EVENT' | 'INCIDENT' | 'WORK_ORDER' | 'RESOLUTION'
  | 'TECHNICIAN_NOTE' | 'MAINTENANCE' | 'COMPONENT' | 'KNOWLEDGE'
  | 'AGGREGATE';

export interface RawEvidence {
  kind: EvidenceKind;
  role: EvidenceRole;
  /**
   * Canonical identity of the underlying record: `kind:primaryKey`.
   *
   * A role is a reason a record was retrieved, not a record. The same work order reached through
   * two retrieval roles is still one work order, and counting it twice inflated "maintenance
   * records" in answers. Fusion deduplicates on this, never on the role.
   */
  sourceId?: string;
  title: string;
  excerpt: string;
  assetCode: string | null;
  timestamp: string | null;
  recordOrigin: RecordOrigin;
  authorityClass: AuthorityClass;
  sourceType: string;
  sourceUrl: string | null;
  similarity: number | null;
  keywordRank: number | null;
  applicability: { assetType: string | null; manufacturer: string | null; model: string | null };
  /** Document identity for knowledge chunks, so fusion can limit how many one source contributes. */
  sourceKey?: string;
  /** Typed stored outcome fields, separate from free-text notes and model narration. */
  recordedAccount?: { rootCause: string | null; outcome: string | null; component: string | null; downtimeMinutes: number | null };
  /** True only for reviewed public references that may be quoted as guidance, never for demo history. */
  procedural: boolean;
}

export interface AssetContext {
  id: string; assetCode: string; assetType: string;
  manufacturer: string | null; model: string | null;
  status: string; siteId: string; recordOrigin: RecordOrigin;
}

export interface EventContext {
  id: string; eventCode: string; title: string; subsystem: string | null;
  severity: string; occurredAt: string; clearedAt: string | null;
  description: string; recordOrigin: RecordOrigin;
}

export interface OccurrenceStats {
  /** Occurrences of the same code on the same asset strictly before the selected event. */
  previousCount: number;
  totalIncludingSelected: number;
  firstAt: string | null;
  lastAt: string | null;
  byOrigin: Partial<Record<RecordOrigin, number>>;
}

export interface RetrievalResult {
  intent: Intent;
  asset: AssetContext;
  event: EventContext | null;
  eventCode: string | null;
  anchorAt: string;
  occurrences: OccurrenceStats | null;
  /** Present for asset-wide questions; the source of truth for turbine-level totals. */
  assetSummary: AssetEventSummaryStats | null;
  recentWindow: { startIso: string; endIso: string } | null;
  fleetAssetCodes: string[];
  evidence: RawEvidence[];
  notes: string[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}
function nullableText(value: unknown): string | null {
  return value == null ? null : text(value);
}
function iso(value: unknown): string | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(text(value));
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}
function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}
function origin(value: unknown): RecordOrigin {
  const candidate = text(value);
  return (RECORD_ORIGINS as readonly string[]).includes(candidate) ? candidate as RecordOrigin : 'synthetic_demo';
}
function authority(value: unknown): AuthorityClass {
  const candidate = text(value);
  return (['OEM', 'REGULATOR', 'RESEARCH', 'HISTORICAL', 'UNVERIFIED'] as const)
    .includes(candidate as AuthorityClass) ? candidate as AuthorityClass : 'UNVERIFIED';
}
/** Bounded excerpt so a long free-text field cannot dominate the evidence bundle. */
function excerpt(...parts: (string | null | undefined)[]): string {
  const joined = parts.map((part) => (part ?? '').trim()).filter(Boolean).join(' — ');
  return joined.length > 600 ? `${joined.slice(0, 597)}...` : joined;
}

export async function loadAsset(db: Queryable, assetCode: string): Promise<AssetContext | null> {
  const result = await db.query(
    `select id, site_id, asset_code, asset_type, manufacturer, model, status, record_origin
       from public.assets where asset_code = $1`, [assetCode]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: text(row.id), assetCode: text(row.asset_code), assetType: text(row.asset_type),
    manufacturer: nullableText(row.manufacturer), model: nullableText(row.model),
    status: text(row.status), siteId: text(row.site_id), recordOrigin: origin(row.record_origin),
  };
}

/**
 * Selected event: the newest matching occurrence, preferring one that is still open.
 * With no eventCode the newest uncleared event is used, otherwise the newest event of any kind.
 */
export async function loadSelectedEvent(
  db: Queryable, assetId: string, eventCode?: string,
): Promise<EventContext | null> {
  const result = await db.query(
    `select id, event_code, title, subsystem, severity, occurred_at, cleared_at, description, record_origin
       from public.asset_events
      where asset_id = $1 and ($2::text is null or event_code = $2::text)
      order by (cleared_at is null) desc, occurred_at desc, id desc
      limit 1`, [assetId, eventCode ?? null]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: text(row.id), eventCode: text(row.event_code), title: text(row.title),
    subsystem: nullableText(row.subsystem), severity: text(row.severity),
    occurredAt: iso(row.occurred_at) ?? new Date(0).toISOString(),
    clearedAt: iso(row.cleared_at), description: text(row.description),
    recordOrigin: origin(row.record_origin),
  };
}

/**
 * Exact recurrence arithmetic in SQL. The selected occurrence is excluded by both id and time
 * so that events sharing a timestamp cannot be double counted.
 */
export async function countPreviousOccurrences(
  db: Queryable, assetId: string, eventCode: string, selectedEventId: string | null, anchorAt: string,
): Promise<OccurrenceStats> {
  const result = await db.query(
    `select count(*)::int as previous_count,
            min(occurred_at) as first_at,
            max(occurred_at) as last_at,
            count(*) filter (where record_origin = 'public_data')::int as public_data,
            count(*) filter (where record_origin = 'synthetic_demo')::int as synthetic_demo,
            count(*) filter (where record_origin = 'user_demo')::int as user_demo
       from public.asset_events
      where asset_id = $1 and event_code = $2
        and occurred_at <= $4::timestamptz
        and ($3::uuid is null or id <> $3::uuid)`,
    [assetId, eventCode, selectedEventId, anchorAt]);
  const row = result.rows[0] ?? {};
  const previousCount = count(row.previous_count);
  const byOrigin: Partial<Record<RecordOrigin, number>> = {};
  for (const key of ['public_data', 'synthetic_demo', 'user_demo'] as const) {
    if (count(row[key]) > 0) byOrigin[key] = count(row[key]);
  }
  return {
    previousCount,
    totalIncludingSelected: previousCount + (selectedEventId ? 1 : 0),
    firstAt: iso(row.first_at), lastAt: iso(row.last_at), byOrigin,
  };
}

/**
 * Asset-wide totals, computed entirely in SQL.
 *
 * These exist so a turbine-level answer never asks a model to add up sampled rows: the number the
 * answer states is the number the database returned.
 */
export async function assetEventSummary(db: Queryable, assetId: string): Promise<AssetEventSummaryStats> {
  const totals = await db.query(
    `select count(*)::int as total, count(distinct event_code)::int as codes,
            min(occurred_at) as first_at, max(occurred_at) as last_at
       from public.asset_events where asset_id = $1`, [assetId]);
  const top = await db.query(
    `select event_code, count(*)::int as occurrences, max(title) as title
       from public.asset_events where asset_id = $1
      group by event_code order by count(*) desc, event_code limit 8`, [assetId]);
  const row = totals.rows[0] ?? {};
  return {
    totalEvents: count(row.total), distinctEventCodes: count(row.codes),
    firstAt: iso(row.first_at), lastAt: iso(row.last_at),
    topCodes: top.rows.map((item) => ({
      eventCode: text(item.event_code), occurrences: count(item.occurrences), title: nullableText(item.title),
    })),
  };
}

/** Most recent events across every code on the asset, for asset-wide questions. */
async function assetWideRecentEvents(db: Queryable, assetCode: string, assetId: string): Promise<RawEvidence[]> {
  const result = await db.query(
    `select id, event_code, title, severity, occurred_at, cleared_at, description, record_origin
       from public.asset_events where asset_id = $1
      order by occurred_at desc, id desc limit ${MAX_STRUCTURED_ROWS}`, [assetId]);
  return result.rows.map((row) => ({
    kind: 'ASSET_EVENT' as const, role: 'SAME_ASSET_HISTORY' as const, sourceId: `ASSET_EVENT:${text(row.id)}`,
    title: `${text(row.event_code)} — ${text(row.title)}`,
    excerpt: excerpt(text(row.description), `Severity ${text(row.severity)}`, row.cleared_at ? 'Cleared' : 'Not cleared'),
    assetCode, timestamp: iso(row.occurred_at), recordOrigin: origin(row.record_origin),
    authorityClass: 'HISTORICAL' as const, sourceType: 'ASSET_EVENT', sourceUrl: null,
    similarity: null, keywordRank: null,
    applicability: { assetType: null, manufacturer: null, model: null }, procedural: false,
  }));
}

/**
 * Turns a computed total into a citable evidence record.
 *
 * An exact claim must cite something that actually contains the number. Citing three sample events
 * as proof of "71 occurrences" is not grounding, so the aggregate itself becomes evidence and the
 * excerpt states the figure in words the citation validator can be checked against.
 */
function aggregateEvidence(options: {
  sourceId: string; assetCode: string; title: string; excerpt: string; timestamp: string | null;
  recordOrigin: RecordOrigin;
}): RawEvidence {
  return {
    kind: 'AGGREGATE', role: 'AGGREGATE_FACT', sourceId: options.sourceId,
    title: options.title, excerpt: options.excerpt,
    assetCode: options.assetCode, timestamp: options.timestamp,
    recordOrigin: options.recordOrigin,
    // A count of records is a database fact, not a reviewed reference; it carries no authority to
    // license a procedure, and `procedural` stays false so it can never satisfy the safety gate.
    authorityClass: 'HISTORICAL', sourceType: 'AGGREGATE', sourceUrl: null,
    similarity: null, keywordRank: null,
    applicability: { assetType: null, manufacturer: null, model: null }, procedural: false,
  };
}

/** Same asset, same code, strictly earlier than the selected occurrence. */
async function sameAssetHistory(
  db: Queryable, assetCode: string, assetId: string, eventCode: string,
  selectedEventId: string | null, anchorAt: string,
): Promise<RawEvidence[]> {
  const result = await db.query(
    `select id, event_code, title, subsystem, severity, occurred_at, cleared_at, description, record_origin
       from public.asset_events
      where asset_id = $1 and event_code = $2
        and occurred_at <= $4::timestamptz
        and ($3::uuid is null or id <> $3::uuid)
      order by occurred_at desc, id desc
      limit ${MAX_STRUCTURED_ROWS}`, [assetId, eventCode, selectedEventId, anchorAt]);
  return result.rows.map((row) => ({
    kind: 'ASSET_EVENT' as const, role: 'SAME_ASSET_HISTORY' as const, sourceId: `ASSET_EVENT:${text(row.id)}`,
    title: `${text(row.event_code)} — ${text(row.title)}`,
    excerpt: excerpt(text(row.description), `Severity ${text(row.severity)}`,
      row.cleared_at ? 'Cleared' : 'Not cleared'),
    assetCode, timestamp: iso(row.occurred_at), recordOrigin: origin(row.record_origin),
    authorityClass: 'HISTORICAL' as const, sourceType: 'ASSET_EVENT', sourceUrl: null,
    similarity: null, keywordRank: null,
    applicability: { assetType: null, manufacturer: null, model: null }, procedural: false,
  }));
}

/**
 * Maintenance outcomes for the asset/code. These are deliberately NOT bounded by the selected
 * event timestamp: a resolution is written after the event it describes, and a resolution logged
 * during the demo session must be retrievable immediately.
 */
async function assetMaintenanceHistory(
  db: Queryable, assetCode: string, assetId: string, eventCode: string,
): Promise<RawEvidence[]> {
  const base = {
    assetCode, similarity: null, keywordRank: null,
    applicability: { assetType: null, manufacturer: null, model: null }, procedural: false,
  };
  const incidents = await db.query(
    `select id, event_code, symptoms, root_cause, resolution_summary, opened_at, closed_at, record_origin
       from public.incidents where asset_id = $1 and event_code = $2
      order by opened_at desc, id desc limit ${MAX_STRUCTURED_ROWS}`, [assetId, eventCode]);
  const workOrders = await db.query(
    `select id, event_code, summary, root_cause, resolution, status, completed_at, created_at, record_origin
       from public.work_orders where asset_id = $1 and ($2::text is null or event_code = $2::text)
      order by coalesce(completed_at, created_at) desc, id desc limit ${MAX_STRUCTURED_ROWS}`,
    [assetId, eventCode]);
  const resolutions = await db.query(
    `select id, event_code, root_cause, resolution_summary, component, downtime_minutes,
            notes, validated, created_at, record_origin
       from public.resolutions where asset_id = $1 and event_code = $2
      order by created_at desc, id desc limit ${MAX_STRUCTURED_ROWS}`, [assetId, eventCode]);
  const notes = await db.query(
    `select n.id, n.content, n.created_at, n.record_origin
       from public.technician_notes n
       left join public.incidents i on i.id = n.incident_id and i.asset_id = n.asset_id
      where n.asset_id = $1 and (n.incident_id is null or i.event_code = $2)
      order by n.created_at desc, n.id desc limit ${MAX_STRUCTURED_ROWS}`, [assetId, eventCode]);

  return [
    ...incidents.rows.map((row) => ({
      ...base, kind: 'INCIDENT' as const, role: 'SAME_ASSET_HISTORY' as const, sourceId: `INCIDENT:${text(row.id)}`,
      title: `Incident — ${text(row.event_code)}`,
      excerpt: excerpt(text(row.symptoms), nullableText(row.root_cause) && `Recorded cause: ${text(row.root_cause)}`,
        nullableText(row.resolution_summary) && `Recorded outcome: ${text(row.resolution_summary)}`),
      timestamp: iso(row.opened_at), recordOrigin: origin(row.record_origin),
      authorityClass: 'HISTORICAL' as const, sourceType: 'INCIDENT', sourceUrl: null,
    })),
    ...workOrders.rows.map((row) => ({
      ...base, kind: 'WORK_ORDER' as const, role: 'SAME_ASSET_HISTORY' as const, sourceId: `WORK_ORDER:${text(row.id)}`,
      recordedAccount: { rootCause: nullableText(row.root_cause), outcome: nullableText(row.resolution), component: null, downtimeMinutes: null },
      title: `Work order — ${text(row.summary)}`,
      excerpt: excerpt(nullableText(row.root_cause) && `Recorded cause: ${text(row.root_cause)}`,
        nullableText(row.resolution) && `Recorded work: ${text(row.resolution)}`, `Status ${text(row.status)}`),
      timestamp: iso(row.completed_at) ?? iso(row.created_at), recordOrigin: origin(row.record_origin),
      authorityClass: 'HISTORICAL' as const, sourceType: 'WORK_ORDER', sourceUrl: null,
    })),
    ...resolutions.rows.map((row) => ({
      ...base, kind: 'RESOLUTION' as const, role: 'SAME_ASSET_HISTORY' as const, sourceId: `RESOLUTION:${text(row.id)}`,
      recordedAccount: { rootCause: nullableText(row.root_cause), outcome: nullableText(row.resolution_summary),
        component: nullableText(row.component), downtimeMinutes: count(row.downtime_minutes) },
      title: `Logged resolution — ${text(row.event_code)}`,
      excerpt: excerpt(`Recorded cause: ${text(row.root_cause)}`, `Recorded outcome: ${text(row.resolution_summary)}`,
        text(row.component) && `Component: ${text(row.component)}`,
        `Downtime ${count(row.downtime_minutes)} min`, text(row.notes)),
      timestamp: iso(row.created_at), recordOrigin: origin(row.record_origin),
      authorityClass: 'HISTORICAL' as const, sourceType: 'RESOLUTION', sourceUrl: null,
    })),
    ...notes.rows.map((row) => ({
      ...base, kind: 'TECHNICIAN_NOTE' as const, role: 'SAME_ASSET_HISTORY' as const, sourceId: `TECHNICIAN_NOTE:${text(row.id)}`,
      title: 'Technician note', excerpt: excerpt(text(row.content)),
      timestamp: iso(row.created_at), recordOrigin: origin(row.record_origin),
      authorityClass: 'UNVERIFIED' as const, sourceType: 'TECHNICIAN_NOTE', sourceUrl: null,
    })),
  ];
}

/** Same event code on other assets. The selected asset is excluded in SQL, not in the model. */
async function fleetMatches(
  db: Queryable, assetId: string, eventCode: string,
): Promise<{ evidence: RawEvidence[]; assetCodes: string[] }> {
  const result = await db.query(
    `select e.id, e.event_code, e.title, e.severity, e.occurred_at, e.description, e.record_origin,
            a.asset_code, a.asset_type, a.manufacturer, a.model,
            i.symptoms, i.root_cause, i.resolution_summary
       from public.asset_events e
       join public.assets a on a.id = e.asset_id
       left join lateral (
         select symptoms, root_cause, resolution_summary from public.incidents
          where asset_id = e.asset_id and event_code = e.event_code
          order by opened_at desc limit 1
       ) i on true
      where e.event_code = $1 and e.asset_id <> $2
      order by e.occurred_at desc, e.id desc
      limit ${MAX_STRUCTURED_ROWS}`, [eventCode, assetId]);
  const assetCodes = [...new Set(result.rows.map((row) => text(row.asset_code)))];
  return {
    assetCodes,
    evidence: result.rows.map((row) => ({
      kind: 'ASSET_EVENT' as const, role: 'FLEET_EXACT_CODE' as const, sourceId: `ASSET_EVENT:${text(row.id)}`,
      title: `${text(row.asset_code)} — ${text(row.event_code)}`,
      excerpt: excerpt(text(row.description), nullableText(row.symptoms) && `Symptoms: ${text(row.symptoms)}`,
        nullableText(row.root_cause) && `Recorded cause: ${text(row.root_cause)}`,
        nullableText(row.resolution_summary) && `Recorded outcome: ${text(row.resolution_summary)}`),
      assetCode: text(row.asset_code), timestamp: iso(row.occurred_at),
      recordOrigin: origin(row.record_origin), authorityClass: 'HISTORICAL' as const,
      sourceType: 'ASSET_EVENT', sourceUrl: null, similarity: null, keywordRank: null,
      applicability: {
        assetType: nullableText(row.asset_type), manufacturer: nullableText(row.manufacturer),
        model: nullableText(row.model),
      },
      procedural: false,
    })),
  };
}

/** Bounded change window ending at the selected occurrence: what changed before this fault. */
async function recentChanges(
  db: Queryable, assetCode: string, assetId: string, startIso: string, endIso: string,
): Promise<RawEvidence[]> {
  const result = await db.query(
    `select * from (
       select id, 'MAINTENANCE' as kind, event_type as title, description, occurred_at as at, record_origin
         from public.maintenance_events where asset_id = $1
       union all
       select id, 'WORK_ORDER', summary, coalesce(resolution, '') , coalesce(completed_at, created_at), record_origin
         from public.work_orders where asset_id = $1
       union all
       select id, 'RESOLUTION', 'Resolution: ' || event_code, resolution_summary, created_at, record_origin
         from public.resolutions where asset_id = $1
       union all
       select id, 'ASSET_EVENT', event_code || ' — ' || title, description, occurred_at, record_origin
         from public.asset_events where asset_id = $1
       union all
       select id, 'COMPONENT', 'Component installed: ' || name, coalesce(subsystem, ''), installed_at, record_origin
         from public.components where asset_id = $1 and installed_at is not null
     ) changes
     where at >= $2::timestamptz and at <= $3::timestamptz
     order by at desc, kind asc, id desc
     limit ${MAX_STRUCTURED_ROWS}`, [assetId, startIso, endIso]);
  return result.rows.map((row) => ({
    kind: text(row.kind) as EvidenceKind, role: 'RECENT_CHANGE' as const,
    // The union query already tags each row with its own table, so identity is that table's key.
    sourceId: `${text(row.kind)}:${text(row.id)}`,
    title: text(row.title), excerpt: excerpt(text(row.description)),
    assetCode, timestamp: iso(row.at), recordOrigin: origin(row.record_origin),
    authorityClass: 'HISTORICAL' as const, sourceType: text(row.kind), sourceUrl: null,
    similarity: null, keywordRank: null,
    applicability: { assetType: null, manufacturer: null, model: null }, procedural: false,
  }));
}

export interface KnowledgeFilter {
  /** Authority classes acceptable for this intent. */
  authorityClasses: AuthorityClass[];
  sourceTypes: string[];
  /** Only reviewed public corpora may act as procedural authority. */
  recordOrigins: RecordOrigin[];
  assetType: string | null;
  manufacturer: string | null;
  model: string | null;
  role: EvidenceRole;
}

/**
 * Candidate knowledge chunks. Cosine similarity is computed in SQL when a question embedding is
 * available. Relevance admits candidates before the global cap; authority never creates relevance.
 */
export async function searchKnowledge(
  db: Queryable, filter: KnowledgeFilter, question: string, embedding: number[] | null,
): Promise<RawEvidence[]> {
  const vector = embedding ? JSON.stringify(embedding) : null;
  const result = await db.query(
    `select * from (select c.id, c.content, c.page_number, c.section, c.metadata, c.record_origin, c.event_code,
            d.title, d.organization, d.source_url, d.source_type, d.authority_class,
            case when $5::text is null or c.embedding is null
                   or coalesce(c.metadata->>'embeddingModel','') <> $7::text
                   or coalesce(c.metadata->>'embeddingDimensions','') <> $8::text
                   or coalesce(c.metadata->>'ingestionFormatVersion','') <> '1' then null
                 else 1 - (c.embedding operator(extensions.<=>) $5::extensions.vector) end as similarity,
            ts_rank(to_tsvector('english', c.content), plainto_tsquery('english', $6::text)) as keyword_rank
       from public.document_chunks c
       join public.documents d on d.id = c.document_id
      where d.authority_class = any($1::text[])
        and d.source_type = any($2::text[])
        and c.record_origin = any($3::text[])
        and ($4::text is null or coalesce(c.metadata->>'assetType', $4::text) = $4::text)
     ) candidates
      where similarity >= ${MIN_SEMANTIC_SIMILARITY} or keyword_rank >= ${MIN_KEYWORD_RANK}
      order by (coalesce(similarity,0)*3 + least(keyword_rank,1)*0.5) desc, id asc
      limit ${MAX_KNOWLEDGE_CANDIDATES}`,
    [filter.authorityClasses, filter.sourceTypes, filter.recordOrigins, filter.assetType, vector, question,
      DEFAULT_EMBEDDING_MODEL, String(EMBEDDING_DIMENSIONS)]);

  return result.rows.map((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const recordOrigin = origin(row.record_origin);
    const authorityClass = authority(row.authority_class);
    const similarity = row.similarity == null ? null : Number(row.similarity);
    const keywordRank = row.keyword_rank == null ? null : Number(row.keyword_rank);
    return {
      kind: 'KNOWLEDGE' as const,
      // One chunk reached by both keyword and vector search is still one chunk.
      sourceId: `KNOWLEDGE:${text(row.id)}`,
      role: text(row.source_type) === 'SAFETY_REFERENCE' ? 'SAFETY_REFERENCE' as const : filter.role,
      title: `${text(row.title)}${row.section ? ` — ${text(row.section)}` : ''}`,
      sourceKey: text(row.title),
      excerpt: excerpt(text(row.content)),
      assetCode: null, timestamp: null, recordOrigin, authorityClass,
      sourceType: text(row.source_type), sourceUrl: nullableText(row.source_url),
      similarity: Number.isFinite(similarity as number) ? similarity : null,
      keywordRank: Number.isFinite(keywordRank as number) ? keywordRank : null,
      applicability: {
        assetType: nullableText(metadata.assetType),
        manufacturer: nullableText(metadata.manufacturer),
        model: nullableText(metadata.model),
      },
      // Only reviewed public references carry procedural weight; demo notes never do.
      procedural: ['public_data', 'public_reference'].includes(recordOrigin)
        && ['OEM', 'REGULATOR', 'RESEARCH'].includes(authorityClass),
    };
  });
}

const PUBLIC_ORIGINS: RecordOrigin[] = ['public_data', 'public_reference'];

const TECHNICAL_FILTER = (asset: AssetContext): KnowledgeFilter => ({
  authorityClasses: ['OEM', 'REGULATOR', 'RESEARCH', 'HISTORICAL', 'UNVERIFIED'],
  sourceTypes: ['TECHNICAL_REFERENCE', 'SAFETY_REFERENCE'],
  // User-imported documents are retrievable as context. `procedural` below still requires a public
  // origin, so an uploaded file is cited but never counts as authoritative guidance.
  recordOrigins: [...PUBLIC_ORIGINS, 'user_import'], assetType: asset.assetType,
  manufacturer: asset.manufacturer, model: asset.model, role: 'TECHNICAL_REFERENCE',
});
const SAFETY_FILTER = (asset: AssetContext): KnowledgeFilter => ({
  authorityClasses: ['REGULATOR', 'RESEARCH'], sourceTypes: ['SAFETY_REFERENCE'],
  recordOrigins: PUBLIC_ORIGINS, assetType: asset.assetType,
  manufacturer: asset.manufacturer, model: asset.model, role: 'SAFETY_REFERENCE',
});
const NARRATIVE_FILTER = (asset: AssetContext): KnowledgeFilter => ({
  authorityClasses: ['HISTORICAL', 'UNVERIFIED'], sourceTypes: ['TECHNICIAN_NOTE'],
  recordOrigins: ['synthetic_demo', 'user_demo', 'user_import', 'simulation'], assetType: asset.assetType,
  manufacturer: asset.manufacturer, model: asset.model, role: 'FLEET_SEMANTIC',
});

/** Deterministic asset-wide totals. Computed in SQL so no total is ever inferred from samples. */
export interface AssetEventSummaryStats {
  totalEvents: number;
  distinctEventCodes: number;
  firstAt: string | null;
  lastAt: string | null;
  topCodes: { eventCode: string; occurrences: number; title: string | null }[];
}

export interface RetrieveOptions {
  intent: Intent;
  assetCode: string;
  eventCode?: string;
  /**
   * What the question is about. `ASSET_WIDE` must not be narrowed to the selected event, which is
   * how "summarize this turbine's event history" ended up describing one code.
   */
  scope?: 'CURRENT_EVENT' | 'EVENT_CODE' | 'ASSET_WIDE' | 'FLEET';
  question: string;
  /** Question embedding, or null when no embedding service is configured. */
  embedding: number[] | null;
  now?: Date;
}

/** Runs the intent-specific retrieval plan. Returns null when the asset does not exist. */
export async function retrieveEvidence(db: Queryable, options: RetrieveOptions): Promise<RetrievalResult | null> {
  const asset = await loadAsset(db, options.assetCode);
  if (!asset) return null;

  const event = await loadSelectedEvent(db, asset.id, options.eventCode);
  const eventCode = options.eventCode ?? event?.eventCode ?? null;
  const now = options.now ?? new Date();
  const anchorAt = event?.occurredAt ?? now.toISOString();
  const notes: string[] = [];
  const evidence: RawEvidence[] = [];
  let occurrences: OccurrenceStats | null = null;
  let assetSummary: AssetEventSummaryStats | null = null;
  let recentWindow: RetrievalResult['recentWindow'] = null;
  let fleetAssetCodes: string[] = [];

  // An unspecified/general intent is not permission to answer an unrelated question with
  // the selected turbine's entire history. Reference retrieval can still match new terminology.
  const generalMachineContext = options.intent === 'GENERAL' && /\b(turbines?|assets?|machines?|faults?|events?|incidents?|maintenance|repairs?|history|pressure|gearbox|drivetrain|pitch|hydraulic|WT-\d+|PEN-T\d+)\b/i.test(options.question);
  const wantsHistory = ['HISTORY', 'PREVIOUS_RESOLUTION', 'SIMILAR_INCIDENTS'].includes(options.intent) || generalMachineContext;
  const wantsFleet = options.intent === 'SIMILAR_INCIDENTS' || generalMachineContext;
  const wantsChanges = options.intent === 'RECENT_CHANGES' || generalMachineContext;
  const wantsTechnical = ['TECHNICAL_GUIDANCE', 'GENERAL'].includes(options.intent);
  const wantsSafety = ['SAFETY', 'TECHNICAL_GUIDANCE', 'GENERAL'].includes(options.intent);

  // An asset-wide question is about the turbine, not the selected event. Answer it from the
  // asset's own totals rather than narrowing to one code.
  const assetWide = options.scope === 'ASSET_WIDE';
  const changeDays = recentChangeDays(options.question);

  // Every query below depends only on the asset and the resolved event code, never on another
  // query's result, but they were awaited one at a time — a dozen sequential round trips to a
  // hosted database, which is where most of a slow answer was spent. Starting them together and
  // awaiting them in the original order keeps evidence ordering byte-for-byte identical while the
  // round trips overlap. `run` returns [] for a branch that does not apply, so the awaits below
  // read the same as the sequential version did.
  //
  // Every started promise is marked as observed the moment it is created. A promise started here
  // but never awaited — the technical-context query when the technical search comes back empty,
  // or anything still in flight when an earlier await throws — would otherwise reject with no
  // handler attached, and Node terminates the process on an unhandled rejection. The original
  // promise is returned unchanged, so awaiting it below still surfaces the real error.
  const observe = <T>(promise: Promise<T>): Promise<T> => { void promise.catch(() => undefined); return promise; };
  const run = <T>(condition: boolean, query: () => Promise<T[]>): Promise<T[]> => (condition ? observe(query()) : Promise.resolve([]));
  const wantsRecurrence = !assetWide && Boolean(eventCode) && (wantsHistory || options.intent === 'RECENT_CHANGES');
  const wantsSummary = assetWide && wantsHistory;

  const summaryQuery = wantsSummary ? observe(assetEventSummary(db, asset.id)) : null;
  const assetWideEvents = run(wantsSummary, () => assetWideRecentEvents(db, asset.assetCode, asset.id));
  const recurrenceQuery = wantsRecurrence
    ? observe(countPreviousOccurrences(db, asset.id, eventCode as string, event?.id ?? null, anchorAt)) : null;
  const historyQuery = run(!assetWide && Boolean(eventCode) && options.intent === 'HISTORY',
    () => sameAssetHistory(db, asset.assetCode, asset.id, eventCode as string, event?.id ?? null, anchorAt));
  const maintenanceQuery = run(
    !assetWide && Boolean(eventCode)
      && (options.intent === 'HISTORY' || options.intent === 'PREVIOUS_RESOLUTION' || generalMachineContext),
    () => assetMaintenanceHistory(db, asset.assetCode, asset.id, eventCode as string));
  const fleetQuery = eventCode && wantsFleet ? observe(fleetMatches(db, asset.id, eventCode)) : null;
  const narrativeQuery = run(Boolean(eventCode) && wantsFleet,
    () => searchKnowledge(db, NARRATIVE_FILTER(asset), options.question, options.embedding));
  const changesQuery = run(wantsChanges && changeDays !== null, () => {
    const end = new Date(anchorAt);
    const start = new Date(end.getTime() - (changeDays as number) * 86_400_000);
    recentWindow = { startIso: start.toISOString(), endIso: end.toISOString() };
    return recentChanges(db, asset.assetCode, asset.id, recentWindow.startIso, recentWindow.endIso);
  });
  const technicalQuery = run(wantsTechnical,
    () => searchKnowledge(db, TECHNICAL_FILTER(asset), options.question, options.embedding));
  // Started unconditionally alongside the technical search because it is only *used* when that
  // search returns something; awaiting it first to decide would put the round trips back in series.
  const safetyQuery = run(wantsSafety,
    () => searchKnowledge(db, SAFETY_FILTER(asset), options.question, options.embedding));
  const technicalContextQuery = run(
    Boolean(eventCode) && options.intent === 'TECHNICAL_GUIDANCE',
    () => assetMaintenanceHistory(db, asset.assetCode, asset.id, eventCode as string));

  if (wantsSummary) {
    assetSummary = await summaryQuery;
    evidence.push(...await assetWideEvents);
    if (assetSummary && assetSummary.totalEvents > 0) {
      const period = assetSummary.firstAt && assetSummary.lastAt
        ? ` between ${assetSummary.firstAt.slice(0, 10)} and ${assetSummary.lastAt.slice(0, 10)}`
        : '';
      const frequent = assetSummary.topCodes.slice(0, 5)
        .map((code) => `${code.eventCode} (${code.occurrences})`).join(', ');
      evidence.push(aggregateEvidence({
        sourceId: `AGGREGATE:asset-summary:${asset.id}`,
        assetCode: asset.assetCode,
        title: `Recorded event totals for ${asset.assetCode}`,
        excerpt: `${asset.assetCode} has ${assetSummary.totalEvents} recorded events across ${assetSummary.distinctEventCodes} distinct event codes${period}. Most frequent codes: ${frequent}. Counted in SQL over stored rows.`,
        timestamp: assetSummary.lastAt, recordOrigin: asset.recordOrigin,
      }));
    }
  }

  if (recurrenceQuery) {
    occurrences = await recurrenceQuery;
    if (occurrences.previousCount > 0 || event) {
      const span = occurrences.firstAt && occurrences.lastAt
        ? ` The earliest was ${occurrences.firstAt.slice(0, 10)} and the latest ${occurrences.lastAt.slice(0, 10)}.`
        : '';
      evidence.push(aggregateEvidence({
        sourceId: `AGGREGATE:recurrence:${asset.id}:${eventCode}`,
        assetCode: asset.assetCode,
        title: `Recurrence total for ${eventCode} on ${asset.assetCode}`,
        excerpt: `${eventCode} has ${occurrences.totalIncludingSelected} recorded occurrence${occurrences.totalIncludingSelected === 1 ? '' : 's'} on ${asset.assetCode}, of which ${occurrences.previousCount} ${occurrences.previousCount === 1 ? 'is' : 'are'} previous to the selected occurrence.${span} Counted in SQL over stored rows.`,
        timestamp: occurrences.lastAt, recordOrigin: asset.recordOrigin,
      }));
    }
  }
  evidence.push(...await historyQuery);
  evidence.push(...await maintenanceQuery);
  if (fleetQuery) {
    const fleet = await fleetQuery;
    fleetAssetCodes = fleet.assetCodes;
    evidence.push(...fleet.evidence);
    // Semantically similar narratives are additive and always labelled separately from code matches.
    evidence.push(...await narrativeQuery);
    if (!fleet.evidence.length) notes.push('No other asset in this database has recorded the same event code.');
  }
  if (wantsChanges && changeDays === null) notes.push('Choose a recent-change window of 7, 30 or 90 days.');
  evidence.push(...await changesQuery);
  if (wantsTechnical) {
    const technical = await technicalQuery;
    evidence.push(...technical);
    if (!technical.length) notes.push('No relevant technical reference was retrieved for this question and asset type.');
    // Historical work orders may accompany guidance as context, never as procedural authority.
    if (technical.length) {
      evidence.push(...(await technicalContextQuery).map((item) => ({ ...item, role: 'CONTEXT' as const })));
    }
  }
  if (wantsSafety) {
    const safety = await safetyQuery;
    evidence.push(...safety);
    if (!safety.length && options.intent === 'SAFETY') {
      notes.push('No relevant reviewed public safety reference was retrieved for this question.');
    }
  }
  if (options.embedding === null && (wantsTechnical || wantsSafety || wantsFleet)) {
    notes.push('Semantic ranking used keyword signals only; no embedding service was configured for this request.');
  }

  return { intent: options.intent, asset, event, eventCode, anchorAt, occurrences, assetSummary, recentWindow, fleetAssetCodes, evidence, notes };
}

/** Safety references retrieved for a refusal, so a refusal can still cite authority when available. */
export async function retrieveSafetyReferences(
  db: Queryable, asset: AssetContext, question: string, embedding: number[] | null,
): Promise<RawEvidence[]> {
  return searchKnowledge(db, SAFETY_FILTER(asset), question, embedding);
}
