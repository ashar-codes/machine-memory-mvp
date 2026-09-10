// Parser for the official Penmanshiel status/event exports.
//
// Pure parsing: no database, no credentials, no network. Every field comes from the published file
// and nothing is inferred beyond what the source states.
//
// Source: Cubico Sustainable Investments Ltd, "Penmanshiel wind farm data" v3,
// Zenodo record 16807304, DOI 10.5281/zenodo.16807304, CC-BY-4.0.
// The status files are exported by Greenbyte and carry a comment header declaring the turbine,
// turbine type, time zone (UTC) and the exported interval.

export const STATUS_SOURCE = 'penmanshiel_zenodo';
export const STATUS_ARCHIVE = 'Penmanshiel_SCADA_2023_02_WT_01-10_5981.zip';
export const STATUS_ARCHIVE_SHA256 = '8068087be360e624da3fbdb2dfd2f17112534b81adc3895d2498d550a3c83ee9';
export const MAX_STATUS_ROWS = 20_000;

export class PenmanshielStatusError extends Error {}

/**
 * The source's own status classification. These three values are what the published data contains;
 * the file has no notion of "critical" and this importer never invents one.
 */
export const SOURCE_STATUSES = ['Informational', 'Warning', 'Stop'] as const;
export type SourceStatus = typeof SOURCE_STATUSES[number];

/**
 * Conservative mapping onto the schema's severity check constraint.
 *
 * `critical` is deliberately unreachable. The published dataset classifies rows as Informational,
 * Warning or Stop, and calling any of them critical would be an interpretation the source does not
 * support. A Stop affects availability, so it maps to `warning` rather than being flattened to
 * `info`, and the verbatim source status is preserved in source_metadata either way.
 */
export function mapSeverity(status: string): 'info' | 'warning' {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'warning') return 'warning';
  if (normalized === 'stop') return 'warning';
  return 'info';
}

export interface StatusHeader {
  turbine: string | null;
  turbineType: string | null;
  timeZone: string | null;
  interval: string | null;
}

export interface StatusRow {
  /** Source turbine number as published, e.g. "01". */
  sourceTurbine: string;
  /** Machine Memory asset code, e.g. "PEN-T01". */
  assetCode: string;
  startedAt: string;
  endedAt: string | null;
  duration: string | null;
  sourceStatus: string;
  sourceCode: string;
  message: string;
  comment: string | null;
  serviceContractCategory: string | null;
  iecCategory: string | null;
  globalContractCategory: string | null;
  customContractCategory: string | null;
  /** Deterministic key for idempotent re-import. */
  externalEventId: string;
}

/** RFC 4180 line splitter, so a quoted message containing a comma cannot corrupt the row. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') { cell += '"'; index += 1; } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { cells.push(cell); cell = ''; continue; }
    cell += char;
  }
  cells.push(cell);
  return cells;
}

/** The header block is `#`-prefixed comment lines the exporter writes before the column row. */
export function parseHeader(content: string): StatusHeader {
  const read = (label: string): string | null => {
    const match = new RegExp(`^#\\s*${label}:\\s*(.+)$`, 'im').exec(content);
    return match ? match[1].trim() : null;
  };
  return {
    turbine: read('Turbine'),
    turbineType: read('Turbine type'),
    timeZone: read('Time zone'),
    interval: read('Time interval'),
  };
}

/** `Penmanshiel 01` → `01`. Returns null when the header does not name a turbine as published. */
export function sourceTurbineNumber(turbine: string | null): string | null {
  const match = /Penmanshiel\s+(\d{1,2})\b/i.exec(turbine ?? '');
  return match ? match[1].padStart(2, '0') : null;
}

export function assetCodeFor(sourceTurbine: string): string {
  return `PEN-T${sourceTurbine}`;
}

/**
 * `2023-02-01 19:44:13` in the file's declared UTC zone. A literal `-` means the source recorded no
 * value, which is returned as null rather than guessed at.
 */
export function parseUtcTimestamp(value: string): string | null {
  const text = value.trim();
  if (!text || text === '-') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  if (Number.isNaN(date.valueOf())) return null;
  // Round-trip guard: rejects 2023-02-30 and similar, which Date.UTC would silently roll over.
  return date.toISOString().slice(0, 19) === `${year}-${month}-${day}T${hour}:${minute}:${second}` ? date.toISOString() : null;
}

const EXPECTED_COLUMNS = [
  'Timestamp start', 'Timestamp end', 'Duration', 'Status', 'Code', 'Message', 'Comment',
  'Service contract category', 'IEC category', 'Global contract category', 'Custom contract category',
];

export interface ParsedStatusFile {
  header: StatusHeader;
  sourceTurbine: string;
  assetCode: string;
  rows: StatusRow[];
  rejected: { line: number; reason: string }[];
}

/**
 * Parses one official status export.
 *
 * A row that cannot be read is rejected with a reason and never coerced: an unparseable timestamp
 * does not become "now", and a missing status does not become "info".
 */
export function parseStatusCsv(content: string, options: { maxRows?: number } = {}): ParsedStatusFile {
  const maxRows = options.maxRows ?? MAX_STATUS_ROWS;
  const text = content.replace(/^\ufeff/, '');
  const header = parseHeader(text);
  const sourceTurbine = sourceTurbineNumber(header.turbine);
  if (!sourceTurbine) throw new PenmanshielStatusError('The file header does not name a Penmanshiel turbine; re-download from the official record.');
  // The exporter declares the zone in the header. If it ever stops saying UTC, stop and re-check
  // rather than silently importing timestamps in an unknown zone.
  if (header.timeZone && header.timeZone.trim().toUpperCase() !== 'UTC') {
    throw new PenmanshielStatusError(`Unexpected source time zone "${header.timeZone}"; this importer only handles UTC exports.`);
  }

  const lines = text.split(/\r\n|\n/);
  const headerIndex = lines.findIndex((line) => line.startsWith('Timestamp start,'));
  if (headerIndex < 0) throw new PenmanshielStatusError('No column header row found; the source format may have changed.');
  const columns = splitCsvLine(lines[headerIndex]).map((name) => name.trim());
  for (const [index, expected] of EXPECTED_COLUMNS.entries()) {
    if (columns[index] !== expected) {
      throw new PenmanshielStatusError(`Unexpected column ${index + 1} "${columns[index]}"; expected "${expected}". Re-inspect the source before importing.`);
    }
  }

  const assetCode = assetCodeFor(sourceTurbine);
  const rows: StatusRow[] = [];
  const rejected: { line: number; reason: string }[] = [];
  const seen = new Set<string>();

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (rows.length >= maxRows) { rejected.push({ line: index + 1, reason: 'Row limit reached for this import.' }); break; }
    const cells = splitCsvLine(line);
    if (cells.length < EXPECTED_COLUMNS.length) { rejected.push({ line: index + 1, reason: 'Fewer columns than the published schema.' }); continue; }

    const startedAt = parseUtcTimestamp(cells[0]);
    if (!startedAt) { rejected.push({ line: index + 1, reason: 'Unreadable start timestamp.' }); continue; }
    const endedAt = parseUtcTimestamp(cells[1]);
    if (endedAt && endedAt < startedAt) { rejected.push({ line: index + 1, reason: 'End timestamp precedes start.' }); continue; }

    const sourceStatus = cells[3].trim();
    const sourceCode = cells[4].trim();
    const message = cells[5].trim();
    if (!sourceStatus) { rejected.push({ line: index + 1, reason: 'Missing source status.' }); continue; }
    if (!/^\d{1,10}$/.test(sourceCode)) { rejected.push({ line: index + 1, reason: 'Source code is not a published numeric code.' }); continue; }

    // Deterministic identity: the same published row always yields the same key, so a re-import
    // updates nothing and duplicates nothing. Never a fuzzy timestamp match.
    const externalEventId = `${sourceTurbine}:${startedAt}:${sourceCode}`;
    if (seen.has(externalEventId)) { rejected.push({ line: index + 1, reason: 'Duplicate of an earlier row in the same file.' }); continue; }
    seen.add(externalEventId);

    const optional = (value: string | undefined): string | null => {
      const trimmed = (value ?? '').trim();
      return trimmed ? trimmed : null;
    };
    rows.push({
      sourceTurbine, assetCode, startedAt, endedAt,
      duration: optional(cells[2]) === '-' ? null : optional(cells[2]),
      sourceStatus, sourceCode,
      message: message || `Status code ${sourceCode}`,
      comment: optional(cells[6]),
      serviceContractCategory: optional(cells[7]),
      iecCategory: optional(cells[8]),
      globalContractCategory: optional(cells[9]),
      customContractCategory: optional(cells[10]),
      externalEventId,
    });
  }

  return { header, sourceTurbine, assetCode, rows, rejected };
}

/**
 * The event code stored in Machine Memory.
 *
 * Namespaced so a published Penmanshiel code can never collide with, or be mistaken for, a
 * fictional demonstration code. The unprefixed source code is preserved in source_metadata.
 */
export function eventCodeFor(sourceCode: string): string {
  return `PEN-${sourceCode}`;
}
