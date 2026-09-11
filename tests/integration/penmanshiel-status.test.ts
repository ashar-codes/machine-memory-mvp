// The official Penmanshiel status/event parser. Pure parsing against the real published files;
// no database, no network, no provider.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deterministicAnswer } from '../../backend/src/synthesis.js';
import type { RetrievalResult } from '../../backend/src/retrieval.js';
import {
  assetCodeFor, eventCodeFor, mapSeverity, parseHeader, parseStatusCsv, parseUtcTimestamp,
  PenmanshielStatusError, SOURCE_STATUSES, sourceTurbineNumber, STATUS_SOURCE,
} from '../../scripts/data/penmanshiel-status.js';

const RAW_DIR = new URL('../../data/raw/penmanshiel/', import.meta.url);
const files = readdirSync(RAW_DIR).filter((name) => name.endsWith('.csv')).sort();
const read = (name: string) => readFileSync(new URL(name, RAW_DIR), 'utf8');

/** A minimal file in the exact published shape, for the negative cases. */
const synthetic = (rows: string[], header = 'Penmanshiel 01', zone = 'UTC') => [
  '# This file was exported by Greenbyte.',
  `# Turbine: ${header}`,
  '# Turbine type: Senvion MM82 (Senvion MM82 kW)',
  `# Time zone: ${zone}`,
  '# Time interval: 2023-02-01 00:00:00 - 2023-03-01 00:00:00 (28 days)',
  '#',
  'Timestamp start,Timestamp end,Duration,Status,Code,Message,Comment,Service contract category,IEC category,Global contract category,Custom contract category',
  ...rows,
].join('\r\n');

const row = (overrides: Partial<Record<'start' | 'end' | 'duration' | 'status' | 'code' | 'message', string>> = {}) => [
  overrides.start ?? '2023-02-01 19:44:13',
  overrides.end ?? '2023-02-01 19:45:00',
  overrides.duration ?? '00:00:47',
  overrides.status ?? 'Informational',
  overrides.code ?? '10',
  overrides.message ?? 'Wind < start wind',
  '', '', 'Out of Environmental Specification', '', '',
].join(',');

describe('official source files', () => {
  it('ships the real published status exports', () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.every((name) => /^Status_Penmanshiel_\d{2}_/.test(name))).toBe(true);
  });

  it('preserves the published CRLF line endings', () => {
    // A repository-wide `*.csv text eol=lf` rule would silently rewrite these; .gitattributes
    // marks the directory binary so byte-level provenance survives checkout.
    for (const name of files) {
      const bytes = readFileSync(new URL(name, RAW_DIR));
      expect(bytes.includes(Buffer.from('\r\n'))).toBe(true);
    }
  });

  it('parses every real row without rejecting any', () => {
    for (const name of files) {
      const parsed = parseStatusCsv(read(name));
      expect(parsed.rows.length).toBeGreaterThan(0);
      expect(parsed.rejected).toEqual([]);
      expect(parsed.header.timeZone).toBe('UTC');
      expect(parsed.header.turbineType).toMatch(/Senvion MM82/);
    }
  });

  it('reads only the status values the published data actually contains', () => {
    const statuses = new Set(files.flatMap((name) => parseStatusCsv(read(name)).rows.map((item) => item.sourceStatus)));
    for (const status of statuses) expect(SOURCE_STATUSES).toContain(status as never);
  });

  it('maps every real row to a genuine turbine, and never invents one', () => {
    for (const name of files) {
      const parsed = parseStatusCsv(read(name));
      expect(parsed.assetCode).toMatch(/^PEN-T\d{2}$/);
      // The published dataset has no turbine 03; nothing may manufacture one.
      expect(parsed.assetCode).not.toBe('PEN-T03');
      expect(parsed.rows.every((item) => item.assetCode === parsed.assetCode)).toBe(true);
    }
  });

  it('produces a unique deterministic key for every real row', () => {
    for (const name of files) {
      const ids = parseStatusCsv(read(name)).rows.map((item) => item.externalEventId);
      expect(new Set(ids).size).toBe(ids.length);
      // Re-parsing the same bytes must yield the same keys, or re-import would duplicate history.
      expect(parseStatusCsv(read(name)).rows.map((item) => item.externalEventId)).toEqual(ids);
    }
  });
});

describe('no fabricated interpretation', () => {
  it('never derives a critical severity, because the source has no such class', () => {
    for (const status of [...SOURCE_STATUSES, 'anything else', '', 'CRITICAL']) {
      expect(mapSeverity(status)).not.toBe('critical');
    }
    for (const name of files) {
      const severities = new Set(parseStatusCsv(read(name)).rows.map((item) => mapSeverity(item.sourceStatus)));
      expect([...severities].every((value) => value === 'info' || value === 'warning')).toBe(true);
    }
  });

  it('maps the source status conservatively and keeps the original verbatim', () => {
    expect(mapSeverity('Warning')).toBe('warning');
    expect(mapSeverity('Stop')).toBe('warning');
    expect(mapSeverity('Informational')).toBe('info');
    const parsed = parseStatusCsv(synthetic([row({ status: 'Stop', code: '64', message: 'Max. wind speed' })]));
    expect(parsed.rows[0].sourceStatus).toBe('Stop');
  });

  it('carries no root-cause or resolution field, because the dataset has none', () => {
    const parsed = parseStatusCsv(synthetic([row()]));
    const fields = Object.keys(parsed.rows[0]);
    for (const invented of ['rootCause', 'resolution', 'resolutionSummary', 'repair', 'workOrder', 'severity']) {
      expect(fields).not.toContain(invented);
    }
  });

  it('namespaces the source code so it cannot be confused with a demonstration code', () => {
    expect(eventCodeFor('5000')).toBe('PEN-5000');
    expect(eventCodeFor('0')).toBe('PEN-0');
    expect(assetCodeFor('01')).toBe('PEN-T01');
    expect(STATUS_SOURCE).toBe('penmanshiel_zenodo');
  });
});

describe('timestamps', () => {
  it('reads the published format as UTC', () => {
    expect(parseUtcTimestamp('2023-02-01 19:44:13')).toBe('2023-02-01T19:44:13.000Z');
    expect(parseUtcTimestamp('2023-02-01T19:44:13')).toBe('2023-02-01T19:44:13.000Z');
  });

  it('returns null for the source\'s own "no value" marker rather than guessing', () => {
    expect(parseUtcTimestamp('-')).toBeNull();
    expect(parseUtcTimestamp('')).toBeNull();
  });

  it('rejects an impossible date instead of rolling it over', () => {
    for (const bad of ['2023-02-30 00:00:00', '2023-13-01 00:00:00', '2023-02-01 25:00:00', 'yesterday']) {
      expect(parseUtcTimestamp(bad)).toBeNull();
    }
  });

  it('keeps an open-ended event open rather than inventing an end', () => {
    const parsed = parseStatusCsv(synthetic([row({ end: '-', duration: '-' })]));
    expect(parsed.rows[0].endedAt).toBeNull();
    expect(parsed.rows[0].duration).toBeNull();
  });
});

describe('malformed source rows', () => {
  it('rejects a row with an unreadable start timestamp', () => {
    const parsed = parseStatusCsv(synthetic([row(), row({ start: 'not a date' })]));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rejected[0].reason).toMatch(/start timestamp/i);
  });

  it('rejects a row whose end precedes its start', () => {
    const parsed = parseStatusCsv(synthetic([row({ start: '2023-02-01 12:00:00', end: '2023-02-01 11:00:00' })]));
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.rejected[0].reason).toMatch(/precedes/i);
  });

  it('rejects a non-numeric source code rather than storing it', () => {
    const parsed = parseStatusCsv(synthetic([row({ code: 'DROP TABLE' })]));
    expect(parsed.rows).toHaveLength(0);
  });

  it('rejects a short row and a missing status', () => {
    expect(parseStatusCsv(synthetic(['2023-02-01 19:44:13,-,-'])).rejected[0].reason).toMatch(/columns/i);
    expect(parseStatusCsv(synthetic([row({ status: '' })])).rejected[0].reason).toMatch(/status/i);
  });

  it('drops a duplicate of an earlier row in the same file', () => {
    const parsed = parseStatusCsv(synthetic([row(), row()]));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rejected[0].reason).toMatch(/duplicate/i);
  });

  it('honours a row limit without silently truncating in the dark', () => {
    const parsed = parseStatusCsv(
      synthetic([row({ start: '2023-02-01 01:00:00' }), row({ start: '2023-02-01 02:00:00' }), row({ start: '2023-02-01 03:00:00' })]),
      { maxRows: 2 });
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rejected[0].reason).toMatch(/limit/i);
  });

  it('handles a quoted message containing a comma', () => {
    const line = '2023-02-01 19:44:13,-,-,Warning,5000,"Breakdown, obstacle light",,,Full Performance,,';
    expect(parseStatusCsv(synthetic([line])).rows[0].message).toBe('Breakdown, obstacle light');
  });
});

describe('source format guards', () => {
  it('refuses a file whose header does not name a Penmanshiel turbine', () => {
    expect(() => parseStatusCsv(synthetic([row()], 'Someone Else 01'))).toThrow(PenmanshielStatusError);
  });

  it('refuses a non-UTC export rather than importing an unknown zone', () => {
    expect(() => parseStatusCsv(synthetic([row()], 'Penmanshiel 01', 'Europe/London'))).toThrow(/time zone/i);
  });

  it('refuses a file whose columns have changed', () => {
    const shifted = synthetic([row()]).replace('Timestamp start,Timestamp end,Duration,Status,Code,', 'Start,End,Duration,Status,Code,');
    expect(() => parseStatusCsv(shifted)).toThrow(PenmanshielStatusError);
  });

  it('refuses a file with no column header at all', () => {
    expect(() => parseStatusCsv('# Turbine: Penmanshiel 01\r\n# Time zone: UTC\r\n')).toThrow(/header row/i);
  });

  it('reads the exporter header block', () => {
    const header = parseHeader(read(files[0]));
    expect(header.turbine).toMatch(/^Penmanshiel \d{2}$/);
    expect(sourceTurbineNumber(header.turbine)).toMatch(/^\d{2}$/);
    expect(sourceTurbineNumber('nothing here')).toBeNull();
  });
});

describe('honest absence of maintenance data', () => {
  const result = (previousCount: number): RetrievalResult => ({
    intent: 'PREVIOUS_RESOLUTION',
    asset: { id: 'a', assetCode: 'PEN-T01', assetType: 'wind_turbine', manufacturer: 'Senvion', model: 'MM82', status: 'operational', siteId: 's', recordOrigin: 'public_data' },
    event: null, eventCode: 'PEN-5000', anchorAt: '2023-02-27T00:00:00.000Z',
    occurrences: { previousCount, totalIncludingSelected: previousCount + 1, firstAt: '2023-01-01T04:20:33.000Z', lastAt: '2023-02-20T00:00:00.000Z', byOrigin: { public_data: previousCount } as never },
    recentWindow: null, fleetAssetCodes: [], evidence: [], notes: [],
  } as unknown as RetrievalResult);

  it('reports occurrences without a resolution as exactly that', () => {
    // The published Penmanshiel data has genuine events and no work orders. Saying "no records
    // were retrieved" would wrongly imply the event itself is unknown.
    const answer = deterministicAnswer(result(2), [], []);
    expect(answer.summary).toMatch(/2 recorded previous occurrences on PEN-T01/);
    expect(answer.summary).toMatch(/no verified maintenance resolution is present/i);
    expect(answer.uncertainties[0]).toMatch(/no work order, root cause or repair record/i);
    // Nothing is invented to fill the gap.
    expect(answer.findings).toEqual([]);
    expect(JSON.stringify(answer)).not.toMatch(/root cause was|resolved by|repaired by/i);
  });

  it('still says nothing was retrieved when the asset genuinely has no such event', () => {
    const answer = deterministicAnswer(result(0), [], []);
    expect(answer.summary).toMatch(/No supporting records were retrieved/);
    expect(answer.summary).not.toMatch(/resolution/i);
  });
});
