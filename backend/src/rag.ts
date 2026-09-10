import type { Answer, Evidence, EvidenceStrength, InvestigateRequest, InvestigateResponse } from '@machine-memory/shared';

// Requests to defeat protection or work on energized/faulted equipment. Never answered procedurally.
const unsafe = /\b(bypass|(?:defeat|disable|override)\s+(?:(?:an?|the|safety)\s+)*(?:interlocks?|protections?|safety)|skip\s+(?:the\s+)?isolation|ignore\s+(?:(?:the|a)\s+)?trip|(?:run|operate|keep)\s+(?:(?:the|a)\s+)?(?:faulted|tripped)\s+(?:equipment|turbine|machine)|energized\s+work|live\s+work|work\s+(?:on\s+)?(?:it\s+)?energized|protection[ -]settings?\s+changes?|(?:change|adjust|modify|raise|lower)\s+(?:the\s+)?(?:protection|trip)[ -]settings?|circumvent\s+(?:the\s+)?safety)\b/i;
// Topics where an unsupported answer would be a safety claim rather than a history summary.
const critical = /\b(isolat(?:e|ion)|lockout|tagout|energiz\w*|voltage|torque|pressure|setpoint|protection|interlock|safe(?:ty)?|hydraulic\s+procedure)\b/i;

// Conservative English action families, not a universal semantic-safety classifier. Matching
// never grants permission; suspicious operational requests also fail closed below.
const protectiveTarget = /\b(interlocks?|protections?|protective functions?|trips?|safety(?: systems?)?|isolations?|lockout|tagout|emergency stop|alarm protection)\b/i;
const defeatAction = /\b(disabl\w*|deactivat\w*|switch\w*|turn\w*|defeat\w*|overrid\w*|circumvent\w*|remov\w*|ignor\w*|skip\w*)\b/i;
const continueDespite = /\b(?:continue|operat\w*|run\w*|restart|generat\w*)\b[^.!?]{0,100}\b(?:despite|without|even (?:if|though)|regardless)\b/i;

/**
 * This MVP has no reviewed asset-specific procedure/limit authorization records. Public
 * regulator/research references, historical repairs and upload metadata cannot grant that
 * authorization. Keep operational requests closed until an explicit approved-evidence
 * contract exists; do not infer approval from authority_class or an LLM's judgement.
 */
export function requiresOperationalAuthorization(question: string): boolean {
  const text = question.normalize('NFKC').replace(/[\u2010-\u2015_-]/g, ' ');
  return /\b(thresholds?|setpoints?|torque|voltage|pressure limits?|numeric (?:limits?|values?)|(?:protection|trip) settings?|operating limits?)\b/i.test(text)
    || /\b(?:correct|approved|required|safe|maximum|minimum|guess)\b[^.!?]{0,70}\b(?:pressure|temperature|speed|load|limit|setting|value)\b/i.test(text)
    || /\b(?:pressure|temperature|speed|load)\b[^.!?]{0,50}\b(?:should|must|set|apply|limit)\b/i.test(text)
    || /\b(?:set|adjust|raise|lower|apply)\b[^.!?]{0,70}\b(?:pressure|temperature|speed|load|voltage|torque|limit|setting)\b/i.test(text)
    || /\b(?:procedure|instructions?|step by step|how (?:do|can|should|to)|tell me (?:how|to))\b[^.!?]{0,100}\b(?:isolat\w*|lockout|tagout|restart|repair|replac\w*|operat\w*|energiz\w*|interlock|protection|turbine|machine|equipment)\b/i.test(text)
    || /\b(?:isolat\w*|lockout|tagout|hydraulic|repair|restart|maintenance)\b[^.!?]{0,50}\b(?:procedure|instructions?|sequence|steps)\b/i.test(text);
}

export const UNSAFE_SUMMARY = 'I cannot provide instructions to bypass protections or perform unsafe equipment operation. Follow approved site procedures and consult authorized personnel.';
export const INSUFFICIENT_SUMMARY = 'Insufficient verified evidence.';
export const NO_PROCEDURE_UNCERTAINTY = 'No verified asset-specific safety procedure has been retrieved. Historical and demo records do not authorize operational actions.';

/** True when the request asks for a prohibited action, whichever intent the client claimed. */
export function detectUnsafeRequest(question: string): boolean {
  const text = question.normalize('NFKC').replace(/[\u2010-\u2015_-]/g, ' ');
  return unsafe.test(question) || unsafe.test(text)
    || /\bisolat\w*\s+incorrectly\b/i.test(text)
    || text.split(/[.!?\n]/).some((clause) => protectiveTarget.test(clause)
      && (defeatAction.test(clause) || continueDespite.test(clause)));
}

/** True when the answer would need authoritative evidence before it may state anything procedural. */
export function requiresVerifiedEvidence(input: Pick<InvestigateRequest, 'intent' | 'question'>): boolean {
  return input.intent === 'SAFETY' || input.intent === 'TECHNICAL_GUIDANCE'
    || requiresOperationalAuthorization(input.question);
}

/**
 * No provider or database is required for a refusal. Also used for the no-database fallback.
 */
export function safetyAnswer(input: InvestigateRequest): InvestigateResponse | null {
  const refused = detectUnsafeRequest(input.question);
  if (!refused && !requiresOperationalAuthorization(input.question)
    && input.intent !== 'SAFETY' && !critical.test(input.question)) return null;
  return {
    answer: {
      summary: refused ? UNSAFE_SUMMARY : INSUFFICIENT_SUMMARY,
      findings: [],
      evidenceStrength: 'INSUFFICIENT',
      uncertainties: [NO_PROCEDURE_UNCERTAINTY],
      safetyStatus: refused ? 'REFUSED' : 'INSUFFICIENT',
    },
    evidence: [],
  };
}

export interface EvidenceSignals { exactAsset:boolean; exactEvent:boolean; priorOccurrences:number; linkedResolution:boolean; crossAsset:boolean; authoritativeTechnical:boolean; authoritativeSafety:boolean; conflicting:boolean; onlyDemo:boolean }
// Deterministic ordinal score. Not a probability, procedure authorization, or model confidence.
export function scoreEvidence(s: EvidenceSignals): EvidenceStrength {
  if (!Number.isInteger(s.priorOccurrences) || s.priorOccurrences < 0) throw new Error('Invalid occurrence count');
  if (s.conflicting) return 'INSUFFICIENT';
  const points = Number(s.exactAsset) + Number(s.exactEvent) + Number(s.priorOccurrences > 0) + Number(s.linkedResolution) + Number(s.crossAsset) + 2 * Number(s.authoritativeTechnical) + 2 * Number(s.authoritativeSafety);
  if (points < 2) return 'INSUFFICIENT';
  return points >= 5 && !s.onlyDemo ? 'HIGH' : 'MODERATE';
}

export function validateCitations(answer: Answer, evidence: Evidence[]): void {
  const ids = new Set(evidence.map(e => e.id));
  if (ids.size !== evidence.length) throw new Error('Duplicate evidence IDs');
  for (const finding of answer.findings) {
    if (finding.citationIds.length === 0) throw new Error('Uncited finding');
    for (const id of finding.citationIds) if (!ids.has(id)) throw new Error('Unknown citation ID');
  }
}
