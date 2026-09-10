// Tabular parsing and the frozen import field contracts.
//
// Pure functions: no database, no credentials, no network, no filesystem. Everything a user
// uploads is parsed here first so the rules can be tested without a server or an API key.
import type { FieldSpec, ImportType } from '@machine-memory/shared';

export const MAX_IMPORT_ROWS = 5000;
export const MAX_PREVIEW_ROWS = 8;
export const MAX_COLUMNS = 80;

export class TabularError extends Error {}

/**
 * RFC 4180 parse. Handles quoted fields containing commas, newlines and doubled quotes, which a
 * naive split on ',' silently corrupts on real maintenance exports.
 */
export function parseCsv(content: string, maxRows = MAX_IMPORT_ROWS): string[][] {
  const text = content.replace(/^\ufeff/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let hasContent = false;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => {
    endField();
    // A trailing newline must not become a row of empty strings.
    if (hasContent) rows.push(row);
    row = [];
    hasContent = false;
    if (rows.length > maxRows + 1) throw new TabularError(`File exceeds the ${maxRows}-row limit for a single import.`);
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; hasContent = true; }
        else quoted = false;
      } else { field += char; hasContent = true; }
      continue;
    }
    if (char === '"') { quoted = true; hasContent = true; continue; }
    if (char === ',') { endField(); continue; }
    if (char === '\r') continue;
    if (char === '\n') { endRow(); continue; }
    field += char;
    if (char.trim()) hasContent = true;
  }
  endRow();
  return rows;
}

/**
 * A spreadsheet cell beginning with =, +, - or @ is executed as a formula by Excel and Sheets when
 * the value is later exported and reopened. We store the literal text, never evaluate it, and
 * prefix it on the way out so a downloaded copy cannot become an injection vector.
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function normalizeCell(value: string | undefined): string {
  // Stripping control characters is the whole point of this function.
  // eslint-disable-next-line no-control-regex
  return (value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
}

export interface Table { columns: string[]; rows: Record<string, string>[] }

export function toTable(matrix: string[][]): Table {
  const header = matrix[0];
  if (!header?.length) throw new TabularError('The file has no header row.');
  const columns = header.map((name, index) => normalizeCell(name) || `column_${index + 1}`);
  if (columns.length > MAX_COLUMNS) throw new TabularError(`The file has more than ${MAX_COLUMNS} columns.`);
  if (new Set(columns).size !== columns.length) {
    throw new TabularError('The header row contains duplicate column names; make them unique and re-upload.');
  }
  const rows = matrix.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    columns.forEach((name, index) => { record[name] = neutralizeFormula(normalizeCell(cells[index])); });
    return record;
  });
  return { columns, rows };
}

/**
 * The complete allowlist of internal fields an import may target. A model suggestion that names
 * anything outside this list is discarded: it cannot reach a table name, a column outside this
 * set, or SQL of any kind.
 */
export const IMPORT_FIELDS: Record<ImportType, FieldSpec[]> = {
  EVENT_LOG: [
    { field: 'asset_code', label: 'Asset code', required: true, description: 'Turbine or asset identifier, e.g. WT-10' },
    { field: 'event_code', label: 'Event code', required: true, description: 'Fault or alarm code, e.g. PITCH-HYD-214' },
    { field: 'title', label: 'Title', required: true, description: 'Short alarm text' },
    { field: 'subsystem', label: 'Subsystem', required: false, description: 'Pitch, Generator, Gearbox…' },
    { field: 'severity', label: 'Severity', required: false, description: 'critical, warning or info' },
    { field: 'occurred_at', label: 'Occurred at', required: true, description: 'Timestamp the event was raised' },
    { field: 'cleared_at', label: 'Cleared at', required: false, description: 'Timestamp the event cleared; blank means still open' },
    { field: 'description', label: 'Description', required: false, description: 'Observed symptoms or alarm detail' },
  ],
  MAINTENANCE_HISTORY: [
    { field: 'asset_code', label: 'Asset code', required: true, description: 'Turbine or asset identifier' },
    { field: 'event_type', label: 'Event type', required: true, description: 'inspection, component_replacement, service…' },
    { field: 'occurred_at', label: 'Occurred at', required: true, description: 'When the work was carried out' },
    { field: 'component', label: 'Component', required: false, description: 'Component the work touched' },
    { field: 'description', label: 'Description', required: false, description: 'What was done' },
  ],
  WORK_ORDERS: [
    { field: 'asset_code', label: 'Asset code', required: true, description: 'Turbine or asset identifier' },
    { field: 'summary', label: 'Summary', required: true, description: 'Work order summary' },
    { field: 'event_code', label: 'Event code', required: false, description: 'Fault code the order responded to' },
    { field: 'root_cause', label: 'Root cause', required: false, description: 'Recorded cause; never invented' },
    { field: 'resolution', label: 'Resolution', required: false, description: 'Recorded outcome' },
    { field: 'completed_at', label: 'Completed at', required: false, description: 'Completion timestamp' },
  ],
  TECHNICIAN_NOTES: [
    { field: 'asset_code', label: 'Asset code', required: true, description: 'Turbine or asset identifier' },
    { field: 'content', label: 'Note', required: true, description: 'The technician note text' },
    { field: 'created_at', label: 'Created at', required: false, description: 'When the note was written' },
  ],
};

export const IMPORT_TYPE_LABELS: Record<ImportType, string> = {
  EVENT_LOG: 'Event / fault log',
  MAINTENANCE_HISTORY: 'Maintenance history',
  WORK_ORDERS: 'Work orders',
  TECHNICIAN_NOTES: 'Technician notes',
};

export function fieldsFor(importType: ImportType): FieldSpec[] {
  const fields = IMPORT_FIELDS[importType];
  if (!fields) throw new TabularError('Unsupported import type.');
  return fields;
}

/** Case- and separator-insensitive comparison key, so "Turbine_ID" and "turbine id" match. */
export function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Header spellings seen in real turbine exports. Deterministic, and checked before any model call. */
const SYNONYMS: Record<string, string[]> = {
  asset_code: ['assetcode', 'asset', 'turbineid', 'turbine', 'turbinename', 'wtg', 'wtgid', 'assetid', 'machine', 'machineid', 'unit', 'unitid', 'stationid'],
  event_code: ['eventcode', 'alarmcode', 'faultcode', 'errorcode', 'code', 'alarmid', 'statuscode'],
  title: ['title', 'alarmtext', 'eventtext', 'alarmdescription', 'eventname', 'alarmname', 'faultname', 'name', 'message'],
  subsystem: ['subsystem', 'system', 'component group', 'componentgroup', 'assembly', 'category', 'subassembly'],
  severity: ['severity', 'priority', 'level', 'criticality', 'alarmlevel'],
  occurred_at: ['occurredat', 'timestamp', 'datetime', 'date', 'starttime', 'startdate', 'eventtime', 'time', 'raisedat', 'begin', 'from'],
  cleared_at: ['clearedat', 'endtime', 'enddate', 'resolvedat', 'closedat', 'reset', 'until', 'to'],
  description: ['description', 'detail', 'details', 'comment', 'comments', 'remark', 'remarks', 'observedsymptoms', 'symptoms', 'notes'],
  event_type: ['eventtype', 'maintenancetype', 'worktype', 'activity', 'activitytype', 'type', 'action'],
  component: ['component', 'part', 'partname', 'componentname', 'item', 'subcomponent'],
  summary: ['summary', 'worksummary', 'workordersummary', 'subject', 'task', 'workdescription'],
  root_cause: ['rootcause', 'cause', 'failurecause', 'diagnosis', 'faultcause'],
  resolution: ['resolution', 'resolutionsummary', 'outcome', 'actiontaken', 'repair', 'correctiveaction', 'fix'],
  completed_at: ['completedat', 'completiondate', 'closeddate', 'finished', 'donedate', 'completed'],
  content: ['content', 'note', 'notes', 'text', 'body', 'technciannote', 'techniciannote', 'observation'],
  created_at: ['createdat', 'noteddate', 'datecreated', 'created', 'writtenat', 'date'],
};

/**
 * Deterministic first pass. Exact and synonym matches are decided here, before the model is asked
 * anything, so the common case never depends on a network call.
 */
export function heuristicMapping(columns: string[], importType: ImportType): Map<string, string> {
  const fields = fieldsFor(importType);
  const allowed = new Set(fields.map((f) => f.field));
  const taken = new Set<string>();
  const mapping = new Map<string, string>();

  const claim = (column: string, field: string) => {
    if (taken.has(field) || !allowed.has(field)) return false;
    mapping.set(column, field);
    taken.add(field);
    return true;
  };
  // Exact field-name matches win outright, before any fuzzier rule can consume the target.
  for (const column of columns) {
    const key = normalizeKey(column);
    const exact = fields.find((f) => normalizeKey(f.field) === key || normalizeKey(f.label) === key);
    if (exact) claim(column, exact.field);
  }
  for (const column of columns) {
    if (mapping.has(column)) continue;
    const key = normalizeKey(column);
    for (const field of fields) {
      if (taken.has(field.field)) continue;
      if (SYNONYMS[field.field]?.some((synonym) => normalizeKey(synonym) === key)) { claim(column, field.field); break; }
    }
  }
  return mapping;
}

/** Accepts ISO, `YYYY-MM-DD HH:mm`, `DD/MM/YYYY` and `MM/DD/YYYY` where unambiguous. */
export function parseTimestamp(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (slash) {
    const [, a, b, year, hour = '0', minute = '0', second = '0'] = slash;
    // Day-first when the first number cannot be a month; otherwise month-first.
    const dayFirst = Number(a) > 12;
    const day = dayFirst ? Number(a) : Number(b);
    const month = dayFirst ? Number(b) : Number(a);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(Number(year), month - 1, day, Number(hour), Number(minute), Number(second)));
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
  }
  const normalized = /^\d{4}-\d{2}-\d{2}[ ]\d{2}:\d{2}/.test(text) ? text.replace(' ', 'T') : text;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(normalized) ? `${normalized}T00:00:00Z` : normalized);
  if (Number.isNaN(parsed.valueOf())) return null;
  const year = parsed.getUTCFullYear();
  return year < 1970 || year > 2100 ? null : parsed.toISOString();
}

const SEVERITIES = ['critical', 'warning', 'info'];

/** Maps common severity spellings onto the three the schema uses; anything else becomes 'info'. */
export function normalizeSeverity(value: string): string {
  const key = value.trim().toLowerCase();
  if (SEVERITIES.includes(key)) return key;
  if (/^(high|major|urgent|alarm|error|fault|severe|critical|1)$/.test(key)) return 'critical';
  if (/^(medium|moderate|warn|warning|caution|2)$/.test(key)) return 'warning';
  return 'info';
}

/** Asset and event codes are identifiers, not free text; anything else is rejected, never coerced. */
export const ASSET_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const EVENT_CODE_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
