// AI-assisted column mapping.
//
// The model is asked for a suggestion and nothing else. It cannot name a table, a column outside
// the frozen per-import-type allowlist, or any SQL: every key and value it returns is checked
// against `fieldsFor(importType)` before it is shown to the user, and the user confirms the
// mapping before a single row is written.
import type { ColumnMapping, ImportType, MappingStatus } from '@machine-memory/shared';
import type { LlmClient } from './llm.js';
import { fieldsFor, heuristicMapping, normalizeKey } from './tabular.js';

const MAX_SAMPLE_ROWS = 5;
const MAX_SAMPLE_CHARS = 120;

const SUGGESTION_INSTRUCTIONS = `You map spreadsheet columns onto a fixed set of internal fields for a wind turbine maintenance system.

Rules:
- Choose only from the allowed field names given to you. Never invent a field name.
- Use each internal field at most once.
- If a column has no good match, omit it. Omitting is correct and expected; guessing is not.
- Judge from the column name and the sample values together.
- Return only JSON of the form {"mappings":[{"column":string,"field":string}]}.`;

const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    mappings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { column: { type: 'string' }, field: { type: 'string' } },
        required: ['column', 'field'],
      },
    },
  },
  required: ['mappings'],
} as const;

/**
 * Reads the model's reply into a column→field map, discarding anything that is not an allowed
 * field, is not a real column, or reuses a field already taken. This is the trust boundary.
 */
export function validateSuggestion(
  raw: unknown, columns: string[], importType: ImportType, reserved: Iterable<string> = [],
): Map<string, string> {
  const allowed = new Set(fieldsFor(importType).map((field) => field.field));
  const knownColumns = new Map(columns.map((column) => [normalizeKey(column), column]));
  const taken = new Set(reserved);
  const accepted = new Map<string, string>();
  if (!raw || typeof raw !== 'object') return accepted;
  const entries = (raw as { mappings?: unknown }).mappings;
  if (!Array.isArray(entries)) return accepted;

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const { column, field } = entry as { column?: unknown; field?: unknown };
    if (typeof column !== 'string' || typeof field !== 'string') continue;
    // A suggested field must be a member of the allowlist verbatim; nothing is coerced or trimmed
    // into a match, so "assets; drop table" or "public.assets" simply fails here.
    if (!allowed.has(field) || taken.has(field)) continue;
    const actualColumn = knownColumns.get(normalizeKey(column));
    if (!actualColumn || accepted.has(actualColumn)) continue;
    accepted.set(actualColumn, field);
    taken.add(field);
  }
  return accepted;
}

export interface MappingProposal { mapping: ColumnMapping[]; source: 'ai' | 'heuristic'; notes: string[] }

/**
 * Deterministic synonym matching first; the model is asked only about the columns that are left.
 * A model failure degrades to the heuristic result rather than blocking the import.
 */
export async function proposeMapping(
  columns: string[], rows: Record<string, string>[], importType: ImportType, llm: LlmClient | null,
): Promise<MappingProposal> {
  const fields = fieldsFor(importType);
  const heuristic = heuristicMapping(columns, importType);
  const notes: string[] = [];
  let source: 'ai' | 'heuristic' = 'heuristic';
  const aiAccepted = new Map<string, string>();

  const undecided = columns.filter((column) => !heuristic.has(column));
  const unusedFields = fields.filter((field) => ![...heuristic.values()].includes(field.field));

  if (llm?.structured && undecided.length && unusedFields.length) {
    const samples = Object.fromEntries(undecided.map((column) => [
      column,
      rows.slice(0, MAX_SAMPLE_ROWS).map((row) => (row[column] ?? '').slice(0, MAX_SAMPLE_CHARS)).filter(Boolean),
    ]));
    try {
      const suggestion = await llm.structured(SUGGESTION_INSTRUCTIONS, {
        allowedFields: unusedFields.map((field) => ({ name: field.field, description: field.description })),
        columns: undecided.map((column) => ({ name: column, sampleValues: samples[column] })),
      }, SUGGESTION_SCHEMA as unknown as Record<string, unknown>);
      const validated = validateSuggestion(suggestion, undecided, importType, heuristic.values());
      for (const [column, field] of validated) aiAccepted.set(column, field);
      if (aiAccepted.size) { source = 'ai'; notes.push(`Gemini suggested ${aiAccepted.size} column mapping(s). Review before importing.`); }
    } catch {
      notes.push('Gemini was unavailable, so only exact and known-synonym column matches were applied.');
    }
  } else if (!llm?.structured && undecided.length) {
    notes.push('No model is configured, so only exact and known-synonym column matches were applied.');
  }

  const mapping: ColumnMapping[] = columns.map((column) => {
    if (heuristic.has(column)) {
      const field = heuristic.get(column)!;
      const spec = fields.find((item) => item.field === field)!;
      const exact = normalizeKey(column) === normalizeKey(field) || normalizeKey(column) === normalizeKey(spec.label);
      const status: MappingStatus = exact ? 'HIGH_MATCH' : 'SUGGESTED';
      return { column, field, status, note: exact ? 'Column name matches the field directly.' : 'Matched a known column-name synonym.' };
    }
    if (aiAccepted.has(column)) {
      return { column, field: aiAccepted.get(column)!, status: 'NEEDS_REVIEW', note: 'Suggested by Gemini from the column name and sample values. Confirm before importing.' };
    }
    return { column, field: null, status: 'UNMAPPED', note: 'Not mapped. This column will be ignored unless you assign a field.' };
  });

  return { mapping, source, notes };
}

/** Required fields with no column assigned. A non-empty result must block the import. */
export function missingRequiredFields(mapping: Record<string, string>, importType: ImportType): string[] {
  const assigned = new Set(Object.values(mapping));
  return fieldsFor(importType).filter((field) => field.required && !assigned.has(field.field)).map((field) => field.field);
}

/**
 * Final gate before any write. Rejects unknown columns, unknown fields and duplicate targets, so a
 * hand-edited mapping from the browser is held to exactly the same allowlist as the model's.
 */
export function validateConfirmedMapping(
  mapping: Record<string, string>, columns: string[], importType: ImportType,
): { ok: true; mapping: Map<string, string> } | { ok: false; reason: string } {
  const allowed = new Set(fieldsFor(importType).map((field) => field.field));
  const knownColumns = new Set(columns);
  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const [column, field] of Object.entries(mapping)) {
    if (!knownColumns.has(column)) return { ok: false, reason: 'The mapping refers to a column that is not in the uploaded file.' };
    if (!allowed.has(field)) return { ok: false, reason: 'The mapping refers to a field that is not part of this import type.' };
    if (used.has(field)) return { ok: false, reason: `Field "${field}" is mapped from more than one column.` };
    used.add(field);
    result.set(column, field);
  }
  const missing = missingRequiredFields(mapping, importType);
  if (missing.length) return { ok: false, reason: `Required field(s) not mapped: ${missing.join(', ')}.` };
  return { ok: true, mapping: result };
}
