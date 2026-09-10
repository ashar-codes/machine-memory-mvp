// The copilot. Two scopes, one set of safety rules.
//
// Asset scope reuses the existing investigation pipeline unchanged: the same structured retrieval,
// the same evidence fusion, the same deterministic strength and safety gates, the same citation
// validation. All this layer adds is intent classification from free text and a bounded slice of
// conversation so a follow-up like "compare that with WT-03" can be resolved.
//
// Fleet scope never lets the model write SQL. It may pick one allowlisted operation and supply
// bounded parameters; backend code maps that to a parameterized statement.
import type {
  Answer, CopilotMessage, CopilotResponse, Evidence, FleetQueryPlan, Intent,
} from '@machine-memory/shared';
import { investigate, type InvestigateDeps } from './investigate.js';
import type { LlmClient } from './llm.js';
import {
  INSUFFICIENT_SUMMARY,
  detectUnsafeRequest, requiresOperationalAuthorization, safetyAnswer, validateCitations,
} from './rag.js';
import { DEFAULT_RECURRENCE_MINIMUM, DEFAULT_WINDOW_DAYS, FLEET_OPERATIONS, runPlan, validatePlan } from './fleet.js';
import type { GenerationProvider, GenerationTrace } from './provider.js';
import type { Queryable } from './retrieval.js';
import { isQualitativeCommentary } from './synthesis.js';

export const MAX_HISTORY_MESSAGES = 6;
export const MAX_HISTORY_CHARS = 600;

/** Deterministic intent classification. The model never chooses the retrieval strategy. */
export function classifyIntent(question: string): Intent {
  const text = question.toLowerCase();
  if (/\b(bypass|isolat|lockout|tagout|energiz|voltage|torque|protection|interlock|safe)/.test(text)) return 'SAFETY';
  // Resolution wins over history: "solved previously" is a question about the fix, not the count.
  // Order matters here, so both patterns are checked in this sequence deliberately.
  if (/\b(solved|resolved|fix(ed)?|repair\w*|resolution|root cause)\b/.test(text)) return 'PREVIOUS_RESOLUTION';
  if (/\b(previous\w*|before|recur\w*|happened|history|again|past)\b/.test(text)) return 'HISTORY';
  if (/\b(other turbine|fleet|similar|compare|elsewhere|another asset)\b/.test(text)) return 'SIMILAR_INCIDENTS';
  // Technical guidance is checked before recent changes: a question naming references, standards
  // or documentation is asking for guidance even when it also mentions maintenance, and the bare
  // word "maintenance" is far too weak a signal to outrank that.
  if (/\b(manual\w*|document\w*|reference\w*|guidance|standard\w*|spec|technical)/.test(text)) return 'TECHNICAL_GUIDANCE';
  // Stems must not be closed with \b: "changed" and "recently" would never match.
  if (/\b(chang\w*|recent\w*|last \d+ days|before the fault|maintenance)/.test(text)) return 'RECENT_CHANGES';
  return 'GENERAL';
}

/**
 * Rewrites a pronoun-style follow-up into a self-contained question using the last user turn.
 * Purely textual and bounded: conversation can add context but can never change the safety rules,
 * because the rewritten question is re-scanned by the same deterministic guard.
 */
export function resolveFollowUp(question: string, history: CopilotMessage[]): string {
  const trimmed = question.trim();
  const referential = /^(what about|how about|and |compare (that|it)|why (is )?that|show me( the)? evidence|the previous one|that one)\b/i.test(trimmed)
    || (trimmed.length < 40 && /\b(that|it|those|them|the previous one)\b/i.test(trimmed));
  if (!referential) return trimmed;
  const lastUser = [...history].reverse().find((message) => message.role === 'user');
  if (!lastUser) return trimmed;
  return `${trimmed} (follow-up to: ${lastUser.content.slice(0, 200)})`;
}

/** Trims history to a bounded window so an unbounded transcript never reaches the provider. */
export function boundHistory(history: CopilotMessage[] | undefined): CopilotMessage[] {
  return (history ?? [])
    .filter((message) => message && typeof message.content === 'string' && message.content.trim())
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({ role: message.role, content: message.content.trim().slice(0, MAX_HISTORY_CHARS) }));
}

const PLAN_INSTRUCTIONS = `You convert a fleet maintenance question into ONE predefined query descriptor.

Allowed operations, and nothing else:
- fault_recurrence: assets where the same event code repeats.
- open_incidents: incidents with no recorded closure.
- event_code_assets: which assets recorded a specific event code.
- frequent_faults: which event codes occur most often.
- faults_after_maintenance: faults recorded after maintenance on the same asset.

Rules:
- Choose exactly one operation from that list. Never invent one.
- eventCode is optional; include it only if the question names a specific code.
- minimumOccurrences is an integer >= 2. days is an integer number of days to look back.
- Return only JSON: {"operation":string,"eventCode":string|null,"minimumOccurrences":number,"days":number}
- You are not writing SQL. You are choosing a label and parameters.`;

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    operation: { type: 'string', enum: [...FLEET_OPERATIONS] },
    eventCode: { type: 'string' },
    minimumOccurrences: { type: 'number' },
    days: { type: 'number' },
  },
  required: ['operation'],
} as const;

/** Deterministic fallback when no model is available or its plan fails validation. */
export function heuristicPlan(question: string): FleetQueryPlanInternal {
  const text = question.toLowerCase();
  const codeMatch = /\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+){1,4})\b/.exec(question);
  const eventCode = codeMatch ? codeMatch[1] : null;
  if (/\bunresolved|open incident|not closed|still open\b/.test(text)) return { operation: 'open_incidents', eventCode: null, minimumOccurrences: DEFAULT_RECURRENCE_MINIMUM, days: DEFAULT_WINDOW_DAYS };
  if (/\bafter maintenance|following maintenance|since (the )?service\b/.test(text)) return { operation: 'faults_after_maintenance', eventCode, minimumOccurrences: DEFAULT_RECURRENCE_MINIMUM, days: DEFAULT_WINDOW_DAYS };
  if (/\bmost often|most common|most frequent|which faults\b/.test(text)) return { operation: 'frequent_faults', eventCode: null, minimumOccurrences: DEFAULT_RECURRENCE_MINIMUM, days: DEFAULT_WINDOW_DAYS };
  if (eventCode && /\bwhich (turbines|assets|machines)\b/.test(text)) return { operation: 'event_code_assets', eventCode, minimumOccurrences: DEFAULT_RECURRENCE_MINIMUM, days: DEFAULT_WINDOW_DAYS };
  return { operation: 'fault_recurrence', eventCode, minimumOccurrences: DEFAULT_RECURRENCE_MINIMUM, days: DEFAULT_WINDOW_DAYS };
}

type FleetQueryPlanInternal = NonNullable<ReturnType<typeof validatePlan>>;

const FLEET_SYNTHESIS = `You summarize a fleet maintenance query result for an engineer.

Absolute rules:
- Use ONLY the rows supplied. Never invent an asset, a code, a count or a date.
- The counts and dates were computed by the backend in SQL. Reuse them verbatim.
- Records marked synthetic_demo, user_demo, user_import or simulation are demonstration or
  unreviewed data, not verified plant history. Say so.
- Recurrence is a counting rule, not a diagnosis, and co-occurrence after maintenance is ordering,
  not causation. Do not claim a cause.
- Never give a procedure, a numeric limit or a safety instruction.
- Supply qualitative evidence context only. The backend renders exact row facts and summary;
  do not generate numbers, dates, asset identities, diagnoses or recorded outcomes.
- Return only JSON: {"summary":string,"findings":[{"title":string,"detail":string}],"uncertainties":[string]}`;

const FLEET_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' } }, required: ['title', 'detail'] } },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'findings', 'uncertainties'],
} as const;

function deterministicFleetAnswer(label: string, rows: Record<string, unknown>[]): Answer {
  const summary = rows.length
    ? `${label}: ${rows.length} matching record${rows.length === 1 ? '' : 's'} found. Counts and dates were computed in SQL.`
    : `${label}: no matching records. Absence of records does not mean the condition has not occurred.`;
  return {
    summary,
    findings: rows.slice(0, 8).map((row) => ({
      title: String(row.assetCode ?? row.asset_code ?? row.eventCode ?? row.event_code ?? 'Result'),
      detail: Object.entries(row).map(([key, value]) => `${key}: ${String(value)}`).join(' · ').slice(0, 900),
      citationIds: [],
    })),
    evidenceStrength: rows.length ? 'MODERATE' : 'INSUFFICIENT',
    uncertainties: ['Fleet results are counts over recorded rows. They describe what was logged, not the condition of the machine.'],
    safetyStatus: 'NORMAL',
  };
}

export interface CopilotDeps { db: Queryable; llm?: LlmClient | null; now?: Date; onDegraded?: InvestigateDeps['onDegraded']; onGeneration?: (provider: GenerationProvider) => void }

export async function runFleetCopilot(question: string, deps: CopilotDeps): Promise<CopilotResponse> {
  // The fleet scope answers with counts, so a prohibited request is refused before any query runs.
  if (detectUnsafeRequest(question) || requiresOperationalAuthorization(question)) {
    return {
      answer: safetyAnswer({ assetCode: '', intent: 'GENERAL', question })!.answer,
      evidence: [], scope: 'fleet', assetCode: null, plan: null, structuredFacts: {},
    };
  }

  let plan: FleetQueryPlanInternal = heuristicPlan(question);
  if (deps.llm?.structured) {
    try {
      const suggested = await deps.llm.structured(PLAN_INSTRUCTIONS, { question }, PLAN_SCHEMA as unknown as Record<string, unknown>);
      const validated = validatePlan(suggested, question);
      if (validated) plan = validated;
      else deps.onDegraded?.('synthesis');
    } catch {
      deps.onDegraded?.('synthesis');
    }
  }

  const { label, rows } = await runPlan(deps.db, plan);
  const generation: { provider: GenerationProvider } = { provider: 'deterministic' };
  let answer = deterministicFleetAnswer(label, rows);

  if (deps.llm?.structured && rows.length) {
    try {
      const trace: GenerationTrace = {};
      const drafted = await deps.llm.structured(FLEET_SYNTHESIS, { question, label, rows: rows.slice(0, 20) }, FLEET_SCHEMA as unknown as Record<string, unknown>, trace);
      const body = drafted as { summary?: unknown; findings?: unknown; uncertainties?: unknown } | null;
      const summary = typeof body?.summary === 'string' ? body.summary.trim().slice(0, 1200) : '';
      if (summary) {
        const findings = Array.isArray(body?.findings) ? body.findings.slice(0, 8).flatMap((entry) => {
          const item = entry as { title?: unknown; detail?: unknown };
          const title = typeof item.title === 'string' ? item.title.trim().slice(0, 160) : '';
          const detail = typeof item.detail === 'string' ? item.detail.trim().slice(0, 1200) : '';
          // Fleet findings cite computed rows rather than evidence records, so citationIds is
          // deliberately empty and validateCitations is not applied to this scope.
          return title && detail && isQualitativeCommentary(`${title}. ${detail}`) ? [{ title, detail, citationIds: [] }] : [];
        }) : [];
        const uncertainties = Array.isArray(body?.uncertainties)
          ? body.uncertainties.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 600)).filter(isQualitativeCommentary).slice(0, 6)
          : [];
        answer = { ...answer, findings: [...answer.findings.slice(0, 6), ...findings.slice(0, 2)], uncertainties: [...answer.uncertainties, ...uncertainties].slice(0, 6) };
        generation.provider = trace.provider ?? 'gemini';
        deps.onGeneration?.(generation.provider);
      } else {
        deps.onDegraded?.('synthesis');
      }
    } catch {
      deps.onDegraded?.('synthesis');
    }
  }

  const fleetPlan: FleetQueryPlan = { operation: plan.operation, parameters: { eventCode: plan.eventCode, minimumOccurrences: plan.minimumOccurrences, days: plan.days }, label };
  const structuredFacts = {
    operation: plan.operation, eventCode: plan.eventCode, minimumOccurrences: plan.minimumOccurrences,
    windowDays: plan.days, matchingRows: rows.length, rows: rows.slice(0, 20),
    generationProvider: generation.provider, generationDegraded: generation.provider !== 'gemini',
  };
  return { answer, evidence: [], scope: 'fleet', assetCode: null, plan: fleetPlan, structuredFacts };
}

export async function runAssetCopilot(
  input: { assetCode: string; eventCode?: string; question: string; history?: CopilotMessage[] }, deps: CopilotDeps,
): Promise<CopilotResponse | { status: 'asset_not_found' }> {
  const history = boundHistory(input.history);
  const question = resolveFollowUp(input.question, history);
  // Classification happens after the rewrite, so a follow-up is graded on its resolved meaning.
  const intent = classifyIntent(question);

  // A turbine onboarded a minute ago has nothing to retrieve. Say that plainly rather than
  // returning a generic insufficiency that reads like a failure.
  if (!detectUnsafeRequest(question) && !requiresOperationalAuthorization(question)) {
    const counts = await deps.db.query(`select
      (select count(*)::int from public.asset_events e join public.assets a on a.id=e.asset_id where a.asset_code=$1) as events,
      (select count(*)::int from public.maintenance_events m join public.assets a on a.id=m.asset_id where a.asset_code=$1) as maintenance,
      (select count(*)::int from public.work_orders w join public.assets a on a.id=w.asset_id where a.asset_code=$1) as work_orders,
      (select count(*)::int from public.technician_notes n join public.assets a on a.id=n.asset_id where a.asset_code=$1) as notes,
      (select count(*)::int from public.resolutions r join public.assets a on a.id=r.asset_id where a.asset_code=$1) as resolutions,
      (select count(*)::int from public.assets where asset_code=$1) as asset_exists`, [input.assetCode]);
    const row = counts.rows[0] ?? {};
    if (Number(row.asset_exists ?? 0) === 0) return { status: 'asset_not_found' };
    const history = Number(row.events ?? 0) + Number(row.maintenance ?? 0) + Number(row.work_orders ?? 0)
      + Number(row.notes ?? 0) + Number(row.resolutions ?? 0);
    if (history === 0 && intent !== 'TECHNICAL_GUIDANCE') {
      const empty = emptyMemoryAnswer();
      return { ...empty, scope: 'asset', assetCode: input.assetCode, plan: null,
        structuredFacts: { resolvedIntent: intent, resolvedQuestion: question, machineMemoryEmpty: true,
          generationProvider: 'deterministic', generationDegraded: true } };
    }
  }

  const generation: { provider: GenerationProvider } = { provider: 'deterministic' };
  const outcome = await investigate(
    { assetCode: input.assetCode, eventCode: input.eventCode, intent, question },
    {
      db: deps.db, llm: deps.llm, now: deps.now, onDegraded: deps.onDegraded,
      onGeneration: (provider) => { generation.provider = provider; deps.onGeneration?.(provider); },
    },
  );
  if (outcome.status === 'asset_not_found') return { status: 'asset_not_found' };

  // The pipeline already validated citations; assert it here too so this entry point cannot
  // become a way around that guarantee.
  validateCitations(outcome.response.answer, outcome.response.evidence);
  return {
    answer: outcome.response.answer,
    evidence: outcome.response.evidence,
    scope: 'asset',
    assetCode: input.assetCode,
    plan: null,
    structuredFacts: {
      resolvedIntent: intent, resolvedQuestion: question, historyTurnsUsed: history.length,
      generationProvider: generation.provider, generationDegraded: generation.provider !== 'gemini',
    },
  };
}

// Exported for the route layer and tests.
export const EMPTY_MEMORY_SUMMARY = `${INSUFFICIENT_SUMMARY} No operational history has been added for this asset yet.`;

export function emptyMemoryAnswer(): { answer: Answer; evidence: Evidence[] } {
  return {
    answer: {
      summary: EMPTY_MEMORY_SUMMARY,
      findings: [],
      evidenceStrength: 'INSUFFICIENT',
      uncertainties: ['This asset has no recorded events, maintenance, work orders or resolutions. Import its history through the Data Hub, then ask again.'],
      safetyStatus: 'INSUFFICIENT',
    },
    evidence: [],
  };
}
