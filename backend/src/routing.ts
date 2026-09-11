// Deterministic query routing.
//
// Replaces a flat first-match keyword chain, where any incidental word decided the intent — the
// word "maintenance" alone was enough to route a topical research question into the machine's
// change window. Routing here is decided by the *shape* of the request:
//
//   does it name a specific event code?      → that code wins over the selected one
//   does it speak about this machine at all?  → asset question, otherwise a topical one
//   does it ask for a count?                  → aggregate facts, not sampled rows
//   does it ask about the whole turbine?      → asset-wide, not the selected event
//
// No provider call is involved. Routing must be instant, reproducible and testable, and an LLM
// round trip for classification would add latency and non-determinism for no accuracy gain.
import type { Intent } from '@machine-memory/shared';

/**
 * What the question is asking *about*, independently of which intent serves it.
 *
 * The selected UI event must never silently narrow an asset-wide question, which is what
 * `ASSET_WIDE` exists to prevent.
 */
export type QueryScope = 'CURRENT_EVENT' | 'EVENT_CODE' | 'ASSET_WIDE' | 'FLEET';

export interface RoutedQuery {
  intent: Intent;
  scope: QueryScope;
  /** The code this question is actually about, after explicit mentions take precedence. */
  eventCode: string | null;
  /** True when the question asks for a total/count, which must come from SQL, never from samples. */
  aggregate: boolean;
  /** Set when the request cannot be served unambiguously and the user must narrow it. */
  clarification: string | null;
  /** Non-secret routing explanation, surfaced in diagnostics rather than guessed at later. */
  reason: string;
}

export interface RouteContext {
  /** The event selected in the interface, used only when the question names none. */
  currentEventCode?: string | null;
  /** Codes known to exist for this asset, used to disambiguate an unfamiliar-looking token. */
  knownEventCodes?: string[];
}

/**
 * An event code is uppercase alphanumeric segments joined by hyphens, containing at least one
 * digit: PEN-5000, PITCH-HYD-214, GEAR-TMP-402, PEN-100210.
 *
 * The digit requirement is what stops ordinary hyphenated English ("lockout-tagout",
 * "wind-turbine", "start-up") being read as an event code.
 */
const EVENT_CODE_CANDIDATE = /\b[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+\b/g;
const MIN_CODE_LENGTH = 5;

/**
 * Deterministically extracts event codes named in the question, in order of appearance.
 *
 * Matching is case-insensitive so "pen-5000" is understood, but a candidate is only normalized to
 * upper case when that spelling is a known code; otherwise the user's own spelling is preserved so
 * an honest "no records matched" names exactly what they typed.
 */
export function extractEventCodes(question: string, knownEventCodes: string[] = []): string[] {
  const known = new Map(knownEventCodes.map((code) => [code.toUpperCase(), code]));
  const found: string[] = [];
  for (const match of question.matchAll(EVENT_CODE_CANDIDATE)) {
    const candidate = match[0];
    if (candidate.length < MIN_CODE_LENGTH) continue;
    if (!/\d/.test(candidate)) continue;
    const resolved = known.get(candidate.toUpperCase()) ?? candidate.toUpperCase();
    if (!found.includes(resolved)) found.push(resolved);
  }
  return found;
}

const has = (text: string, pattern: RegExp) => pattern.test(text);

/** Does the question speak about *this* machine, rather than a subject in general? */
const ASSET_DEIXIS = /\b(this|the|our|its)\s+(turbine|asset|machine|unit|wtg)\b|\bthis\s+(fault|event|alarm|code|issue|problem)\b|\bon\s+this\b|\bhere\b/;
/**
 * "this turbine" names the machine; a bare "this", or "this fault", names the selected event.
 * The distinction is what stops "what happened to this turbine recently?" being answered about
 * one event code, and it is decided by which noun the pronoun attaches to.
 */
const ASSET_SUBJECT = /\b(this|the|our)\s+(turbine|asset|machine|unit|wtg)\b/;
const EVENT_SUBJECT = /\bthis\s+(fault|event|alarm|code|issue|problem|one)\b/;
/** Explicitly about the whole machine rather than one event. */
const ASSET_WIDE = /\b(event history|fault history|its history|overall|all (of its |the )?(events|faults|alarms)|most (common|frequent)\w*|summar(y|ize|ise)\w*|breakdown of)\b/;
const FLEET = /\b(other turbines?|across the fleet|fleet[- ]wide|fleet|other assets?|elsewhere|another (asset|turbine)|compare\w* (it|this|with|to|against))\b/;
/** Asking for a number, which must be answered from an aggregate query. */
const AGGREGATE = /\b(how (often|many|frequently)|how much|number of|count of|total( number)?|frequency|times has|times did)\b/;
const RESOLUTION = /\b(solved|resolved|fix(ed)?|repair\w*|resolution|root cause|corrective action|what was done)\b/;
/** Named publishers, standards bodies and words that only occur in requests for literature. */
const REFERENCE_SIGNAL = /\b(osha|nrel|iec|iso|ansi|cfr|manual\w*|document\w*|reference\w*|literature|research|published|publication\w*|guidance|standard\w*|specification\w*|technical (note|report|reference|guidance)|white ?paper|study|studies)\b/;
/** Subjects that indicate an engineering topic rather than one machine's log. */
const TOPICAL_SUBJECT = /\b(reliability|durability|design life|failure modes?|best practice|hazardous energy|lockout|tagout|drivetrain|gearbox|bearing|pitch system|converter|generator|o&m|operations and maintenance)\b/;
const CHANGE_SIGNAL = /\b(chang\w*|replac\w*|swapp\w*|serviced|work (was )?(done|carried out)|what was touched)\b/;
const BEFORE_FAULT = /\b(before|prior to|preceding|leading up to|ahead of)\b.{0,30}\b(this |the )?(fault|event|alarm|failure|it)\b/;
const RECENCY = /\b(recent\w*|lately|last \d+\s*(day|week|month)s?|past \d+\s*(day|week|month)s?|in the last|since)\b/;
const HISTORY_SIGNAL = /\b(previous\w*|before|recur\w*|happened|history|again|past|occurr\w*|seen before|ever)\b/;
const SAFETY_TOPIC = /\b(bypass|isolat\w*|lockout|tagout|energiz\w*|voltage|torque|protection|interlock|safety|safe to)\b/;

/**
 * Routes one question, given what the interface currently has selected.
 *
 * Precedence is by specificity, not by keyword position: a question that names a code, asks for a
 * count, or names a standards body is more specific than one that merely happens to contain the
 * word "maintenance".
 */
export function routeQuery(question: string, context: RouteContext = {}): RoutedQuery {
  const text = question.toLowerCase();
  const codes = extractEventCodes(question, context.knownEventCodes ?? []);
  const aggregate = has(text, AGGREGATE);
  const aboutThisMachine = has(text, ASSET_DEIXIS) || codes.length > 0;

  // One investigation answers about one code. Two different named codes is a genuine ambiguity,
  // and picking one silently would answer a question the user did not ask.
  if (codes.length > 1) {
    return {
      intent: 'HISTORY', scope: 'EVENT_CODE', eventCode: null, aggregate,
      clarification: `This question names more than one event code (${codes.join(', ')}). Ask about one at a time.`,
      reason: 'multiple explicit event codes',
    };
  }

  // An explicitly named code always outranks the selected event: the user asked about that code.
  const explicitCode = codes[0] ?? null;
  const eventCode = explicitCode ?? context.currentEventCode ?? null;

  const scopeFor = (fallback: QueryScope): QueryScope => {
    if (has(text, FLEET)) return 'FLEET';
    if (explicitCode) return 'EVENT_CODE';
    if (has(text, ASSET_WIDE)) return 'ASSET_WIDE';
    // Naming the turbine widens the question, unless the sentence also names the event.
    if (has(text, ASSET_SUBJECT) && !has(text, EVENT_SUBJECT)) return 'ASSET_WIDE';
    return fallback;
  };

  // Safety topics are routed before anything else so a protection question cannot be served as
  // ordinary history. The deterministic refusal gate in rag.ts runs separately and still applies.
  if (has(text, SAFETY_TOPIC) && !has(text, CHANGE_SIGNAL)) {
    return { intent: 'SAFETY', scope: scopeFor('CURRENT_EVENT'), eventCode, aggregate, clarification: null, reason: 'safety topic' };
  }

  // A request for literature is topical even when it also says "maintenance". This is the case
  // that a keyword chain got wrong: "wind turbine drivetrain reliability maintenance" is a subject,
  // not a question about this machine's change window.
  const wantsReference = has(text, REFERENCE_SIGNAL) || (has(text, TOPICAL_SUBJECT) && !aboutThisMachine);
  if (wantsReference && !aggregate) {
    return { intent: 'TECHNICAL_GUIDANCE', scope: aboutThisMachine ? scopeFor('CURRENT_EVENT') : 'ASSET_WIDE', eventCode, aggregate, clarification: null, reason: 'request for published reference material' };
  }

  if (has(text, RESOLUTION)) {
    return { intent: 'PREVIOUS_RESOLUTION', scope: scopeFor('CURRENT_EVENT'), eventCode, aggregate, clarification: null, reason: 'asks how it was resolved' };
  }

  if (has(text, FLEET)) {
    return { intent: 'SIMILAR_INCIDENTS', scope: 'FLEET', eventCode, aggregate, clarification: null, reason: 'fleet comparison' };
  }

  // "How often has X occurred" is a counting question: aggregate facts, scoped to the named code.
  if (aggregate) {
    return {
      intent: 'HISTORY',
      scope: explicitCode ? 'EVENT_CODE' : has(text, ASSET_WIDE) ? 'ASSET_WIDE' : context.currentEventCode ? 'CURRENT_EVENT' : 'ASSET_WIDE',
      eventCode, aggregate: true, clarification: null, reason: 'asks for a count',
    };
  }

  // The change window is specifically "what was done before this fault". A bare mention of
  // maintenance is not enough; it needs a change verb or an explicit before-the-fault framing.
  if ((has(text, CHANGE_SIGNAL) && (aboutThisMachine || has(text, RECENCY))) || has(text, BEFORE_FAULT)
    || (/\bmaintenance\b/.test(text) && has(text, BEFORE_FAULT))) {
    return { intent: 'RECENT_CHANGES', scope: scopeFor('CURRENT_EVENT'), eventCode, aggregate, clarification: null, reason: 'asks what changed before the event' };
  }

  // An asset-wide question about events is a history question even when it uses none of the
  // "before/again/previously" vocabulary: "the most common events on this turbine" is history.
  if (has(text, HISTORY_SIGNAL) || has(text, RECENCY) || has(text, ASSET_WIDE)) {
    return { intent: 'HISTORY', scope: scopeFor('CURRENT_EVENT'), eventCode, aggregate, clarification: null, reason: 'asks about recorded history' };
  }

  // Maintenance without a change verb, a before-the-fault framing or a reference signal is a
  // question about this machine's recorded work, which the change window serves.
  if (/\bmaintenance\b/.test(text) && aboutThisMachine) {
    return { intent: 'RECENT_CHANGES', scope: scopeFor('CURRENT_EVENT'), eventCode, aggregate, clarification: null, reason: 'asks about recorded maintenance' };
  }

  return { intent: 'GENERAL', scope: scopeFor(explicitCode ? 'EVENT_CODE' : 'CURRENT_EVENT'), eventCode, aggregate, clarification: null, reason: 'no specific signal' };
}
