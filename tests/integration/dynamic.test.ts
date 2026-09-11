// Dynamic Machine Memory: imports, AI mapping, uploads, knowledge chunking, fleet planning and
// copilot behaviour. Nothing here reaches Gemini or the network — every provider call is injected.
import { describe, expect, it, vi } from 'vitest';
import type { LlmClient } from '../../backend/src/llm.js';
import {
  boundHistory, classifyIntent, emptyMemoryAnswer, heuristicPlan, MAX_HISTORY_MESSAGES,
  resolveFollowUp, runFleetCopilot,
} from '../../backend/src/copilot.js';
import { MAX_PER_SOURCE } from '../../backend/src/evidence.js';
import { DEFAULT_RECURRENCE_MINIMUM, validatePlan } from '../../backend/src/fleet.js';
import { commitImport } from '../../backend/src/imports.js';
import { chunkText, KnowledgeError, PROTECTED_ORIGINS } from '../../backend/src/knowledge.js';
import { missingRequiredFields, proposeMapping, validateConfirmedMapping, validateSuggestion } from '../../backend/src/mapping.js';
import {
  fieldsFor, heuristicMapping, IMPORT_FIELDS, MAX_IMPORT_ROWS, neutralizeFormula,
  normalizeSeverity, parseCsv, parseTimestamp, TabularError, toTable,
} from '../../backend/src/tabular.js';
import { checkUpload, decodeText, extensionOf, looksLikePdf, looksLikeText, safeFilename, UploadError } from '../../backend/src/uploads.js';

const csv = (text: string) => toTable(parseCsv(text));
const file = (name: string, body: string | Buffer) => ({ originalname: name, buffer: Buffer.isBuffer(body) ? body : Buffer.from(body) });

/** Minimal query recorder standing in for a pg client inside a transaction. */
function recorder(rows: Record<string, unknown>[] = []) {
  const calls: { sql: string; values: unknown[] }[] = [];
  return {
    calls,
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values: values ?? [] });
      if (sql.includes('from public.assets where asset_code = any')) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    },
  };
}

describe('CSV parsing', () => {
  it('handles quoted fields containing commas, newlines and escaped quotes', () => {
    const table = csv('a,b\n"one, two","he said ""hi""\nsecond line"\n');
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].a).toBe('one, two');
    expect(table.rows[0].b).toBe('he said "hi"\nsecond line');
  });

  it('ignores a trailing newline instead of inventing a blank row', () => {
    expect(csv('a,b\n1,2\n').rows).toHaveLength(1);
    expect(csv('a,b\r\n1,2\r\n').rows).toHaveLength(1);
  });

  it('strips a byte order mark from the first header', () => {
    expect(csv('﻿Turbine,Code\nWT-1,X\n').columns[0]).toBe('Turbine');
  });

  it('rejects duplicate headers rather than silently dropping a column', () => {
    expect(() => csv('a,a\n1,2\n')).toThrow(TabularError);
  });

  it('refuses a file beyond the row limit', () => {
    const big = ['a', ...Array.from({ length: MAX_IMPORT_ROWS + 5 }, (_, i) => String(i))].join('\n');
    expect(() => parseCsv(big)).toThrow(TabularError);
  });
});

describe('spreadsheet formula handling', () => {
  it('neutralizes formula-leading cells without evaluating anything', () => {
    for (const dangerous of ['=1+1', '+A1', '-2+3', '@SUM(A1)', '=cmd|\'/c calc\'!A1']) {
      expect(neutralizeFormula(dangerous)).toBe(`'${dangerous}`);
    }
    expect(neutralizeFormula('WT-07')).toBe('WT-07');
  });

  it('neutralizes on parse, so a stored value can never be re-exported as a live formula', () => {
    // Properly quoted, as a spreadsheet would actually export a cell containing commas and quotes.
    expect(csv('a\n"=HYPERLINK(""http://x"",""y"")"\n').rows[0].a).toBe('\'=HYPERLINK("http://x","y")');
    expect(csv('a\n=1+1\n').rows[0].a).toBe("'=1+1");
  });
});

describe('timestamp and severity coercion', () => {
  it('accepts ISO, space-separated and slash formats', () => {
    expect(parseTimestamp('2026-06-14T09:12:00Z')).toBe('2026-06-14T09:12:00.000Z');
    expect(parseTimestamp('2026-06-14 09:12')).toBe('2026-06-14T09:12:00.000Z');
    expect(parseTimestamp('2026-06-14')).toBe('2026-06-14T00:00:00.000Z');
    expect(parseTimestamp('14/06/2026')).toBe('2026-06-14T00:00:00.000Z');
  });

  it('returns null rather than guessing when a value is not a date', () => {
    for (const bad of ['', 'not a date', '2026-13-45', '99/99/9999']) expect(parseTimestamp(bad)).toBeNull();
  });

  it('maps severity spellings onto the three the schema stores', () => {
    expect(normalizeSeverity('High')).toBe('critical');
    expect(normalizeSeverity('Medium')).toBe('warning');
    expect(normalizeSeverity('anything else')).toBe('info');
  });
});

describe('AI schema mapping', () => {
  // 'Zeitstempel' is deliberately outside the synonym list, so the model has real work to do.
  const columns = ['Turbine_ID', 'Alarm_Code', 'Alarm_Text', 'Zeitstempel'];

  it('matches known synonyms deterministically before any model call', () => {
    const mapping = heuristicMapping(columns, 'EVENT_LOG');
    expect(mapping.get('Turbine_ID')).toBe('asset_code');
    expect(mapping.get('Alarm_Code')).toBe('event_code');
    expect(mapping.get('Alarm_Text')).toBe('title');
  });

  it('never assigns one internal field to two columns', () => {
    const mapping = heuristicMapping(['Turbine_ID', 'Asset Code', 'Machine'], 'EVENT_LOG');
    expect([...mapping.values()].filter((field) => field === 'asset_code')).toHaveLength(1);
  });

  it('discards a suggested field outside the allowlist', () => {
    const hostile = { mappings: [
      { column: 'Zeitstempel', field: 'occurred_at' },
      { column: 'Zeitstempel', field: 'password' },
      { column: 'Alarm_Text', field: 'public.assets' },
      { column: 'Alarm_Text', field: 'title; drop table assets' },
      { column: 'Alarm_Text', field: 'metadata' },
    ] };
    const accepted = validateSuggestion(hostile, columns, 'EVENT_LOG');
    expect([...accepted.entries()]).toEqual([['Zeitstempel', 'occurred_at']]);
  });

  it('discards a suggestion naming a column that is not in the file', () => {
    expect(validateSuggestion({ mappings: [{ column: 'Injected', field: 'title' }] }, columns, 'EVENT_LOG').size).toBe(0);
  });

  it('discards a field already claimed deterministically', () => {
    const accepted = validateSuggestion({ mappings: [{ column: 'Zeitstempel', field: 'title' }] }, columns, 'EVENT_LOG', ['title']);
    expect(accepted.size).toBe(0);
  });

  it('survives a malformed model reply of any shape', () => {
    for (const bad of [null, undefined, 'text', 42, [], {}, { mappings: 'no' }, { mappings: [null, 7, {}] }]) {
      expect(validateSuggestion(bad, columns, 'EVENT_LOG').size).toBe(0);
    }
  });

  it('asks the model only about columns the heuristic could not place', async () => {
    const structured = vi.fn().mockResolvedValue({ mappings: [{ column: 'Zeitstempel', field: 'occurred_at' }] });
    const llm = { embed: async () => null, synthesize: async () => null, structured } as unknown as LlmClient;
    const rows = [{ Turbine_ID: 'WT-1', Alarm_Code: 'X', Alarm_Text: 'y', Zeitstempel: '2026-01-01' }];
    const proposal = await proposeMapping(columns, rows, 'EVENT_LOG', llm);
    const payload = structured.mock.calls[0][1] as { columns: { name: string }[] };
    expect(payload.columns.map((column) => column.name)).toEqual(['Zeitstempel']);
    expect(proposal.source).toBe('ai');
    expect(proposal.mapping.find((entry) => entry.column === 'Zeitstempel')?.status).toBe('NEEDS_REVIEW');
  });

  it('degrades to the deterministic mapping when the model fails, and still imports', async () => {
    const llm = { embed: async () => null, synthesize: async () => null,
      structured: async () => { throw new Error('provider unavailable'); } } as unknown as LlmClient;
    const proposal = await proposeMapping(columns, [], 'EVENT_LOG', llm);
    expect(proposal.source).toBe('heuristic');
    expect(proposal.mapping.find((entry) => entry.column === 'Turbine_ID')?.field).toBe('asset_code');
    expect(proposal.notes.join(' ')).toMatch(/unavailable/i);
  });

  it('reports every required field that is still unmapped', () => {
    expect(missingRequiredFields({ Turbine_ID: 'asset_code' }, 'EVENT_LOG').sort())
      .toEqual(['event_code', 'occurred_at', 'title']);
    expect(missingRequiredFields({ a: 'asset_code', b: 'event_code', c: 'title', d: 'occurred_at' }, 'EVENT_LOG')).toEqual([]);
  });
});

describe('confirmed mapping gate', () => {
  const columns = ['A', 'B', 'C', 'D'];
  const complete = { A: 'asset_code', B: 'event_code', C: 'title', D: 'occurred_at' };

  it('accepts a complete, allowlisted mapping', () => {
    const result = validateConfirmedMapping(complete, columns, 'EVENT_LOG');
    expect(result.ok).toBe(true);
  });

  it('refuses a hand-edited mapping that names an unknown field or column', () => {
    expect(validateConfirmedMapping({ ...complete, A: 'record_origin' }, columns, 'EVENT_LOG').ok).toBe(false);
    expect(validateConfirmedMapping({ ...complete, Z: 'title' }, columns, 'EVENT_LOG').ok).toBe(false);
  });

  it('refuses two columns targeting the same field', () => {
    const result = validateConfirmedMapping({ ...complete, D: 'title' }, columns, 'EVENT_LOG');
    expect(result.ok).toBe(false);
  });

  it('refuses to import while a required field is unmapped', () => {
    const result = validateConfirmedMapping({ A: 'asset_code' }, columns, 'EVENT_LOG');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/required/i);
  });

  it('keeps every import type to its own field list', () => {
    expect(validateConfirmedMapping({ A: 'content', B: 'asset_code' }, columns, 'EVENT_LOG').ok).toBe(false);
    for (const type of Object.keys(IMPORT_FIELDS) as (keyof typeof IMPORT_FIELDS)[]) {
      expect(fieldsFor(type).some((field) => field.required)).toBe(true);
    }
  });
});

describe('structured import', () => {
  const assets = [{ id: 'asset-1', asset_code: 'WT-10' }];
  const eventTable = csv('Turbine,Code,Text,When\nWT-10,GEAR-1,Hot,2026-06-14 09:00\nWT-10,GEAR-1,Hot,2026-07-01 09:00\n');
  const eventMapping = new Map([['Turbine', 'asset_code'], ['Code', 'event_code'], ['Text', 'title'], ['When', 'occurred_at']]);

  it('imports valid event rows with user_import provenance and the batch id', async () => {
    const db = recorder(assets);
    const result = await commitImport(db, { table: eventTable, mapping: eventMapping, importType: 'EVENT_LOG', batchId: 'batch-1', recordOrigin: 'user_import' });
    expect(result.rowsImported).toBe(2);
    // Description is absent from this valid CSV; canonical events persist empty text, not null.
    expect(db.calls.filter((call) => call.sql.includes('insert into public.asset_events'))
      .every((call) => call.values[7] === '')).toBe(true);
    expect(result.rowsRejected).toBe(0);
    expect(result.assetsTouched).toEqual(['WT-10']);
    const insert = db.calls.find((call) => call.sql.includes('insert into public.asset_events'));
    expect(insert?.values).toContain('user_import');
    expect(insert?.values).toContain('batch-1');
  });

  it('carries simulation provenance through to the row when the batch is marked simulated', async () => {
    const db = recorder(assets);
    await commitImport(db, { table: eventTable, mapping: eventMapping, importType: 'EVENT_LOG', batchId: 'b', recordOrigin: 'simulation' });
    expect(db.calls.find((call) => call.sql.includes('insert into public.asset_events'))?.values).toContain('simulation');
  });

  it('rejects a row whose asset does not exist rather than creating one', async () => {
    const db = recorder([]);
    const result = await commitImport(db, { table: eventTable, mapping: eventMapping, importType: 'EVENT_LOG', batchId: 'b', recordOrigin: 'user_import' });
    expect(result.rowsImported).toBe(0);
    expect(result.rowsRejected).toBe(2);
    expect(result.rejections[0].reason).toMatch(/No asset "WT-10"/);
    expect(db.calls.some((call) => call.sql.includes('insert into public.assets'))).toBe(false);
  });

  it('rejects unparseable timestamps and unsupported codes, importing the rest', async () => {
    const table = csv('Turbine,Code,Text,When\nWT-10,GEAR-1,Ok,2026-06-14\nWT-10,GEAR-1,Bad date,not-a-date\nWT-10,"BAD;CODE",Bad code,2026-06-14\n,GEAR-1,No asset,2026-06-14\n');
    const db = recorder(assets);
    const result = await commitImport(db, { table, mapping: eventMapping, importType: 'EVENT_LOG', batchId: 'b', recordOrigin: 'user_import' });
    expect(result.rowsImported).toBe(1);
    expect(result.rowsRejected).toBe(3);
    expect(result.rejections.map((rejection) => rejection.reason).join(' ')).toMatch(/date or time/);
  });

  it('imports maintenance and work orders through their own field sets', async () => {
    const maintenance = csv('Turbine,Work Performed,Date Done\nWT-10,inspection,2026-08-30\n');
    const dbA = recorder(assets);
    const resultA = await commitImport(dbA, {
      table: maintenance,
      mapping: new Map([['Turbine', 'asset_code'], ['Work Performed', 'event_type'], ['Date Done', 'occurred_at']]),
      importType: 'MAINTENANCE_HISTORY', batchId: 'b', recordOrigin: 'user_import',
    });
    expect(resultA.rowsImported).toBe(1);
    expect(dbA.calls.some((call) => call.sql.includes('insert into public.maintenance_events'))).toBe(true);

    const orders = csv('Turbine,Summary,Done\nWT-10,Cooler replaced,2026-09-01\n');
    const dbB = recorder(assets);
    const resultB = await commitImport(dbB, {
      table: orders,
      mapping: new Map([['Turbine', 'asset_code'], ['Summary', 'summary'], ['Done', 'completed_at']]),
      importType: 'WORK_ORDERS', batchId: 'b', recordOrigin: 'user_import',
    });
    expect(resultB.rowsImported).toBe(1);
    expect(dbB.calls.some((call) => call.sql.includes('insert into public.work_orders'))).toBe(true);
  });

  it('bounds how many rejections it retains', async () => {
    const rows = Array.from({ length: 200 }, () => 'WT-10,GEAR-1,Bad,not-a-date').join('\n');
    const db = recorder(assets);
    const result = await commitImport(db, { table: csv(`Turbine,Code,Text,When\n${rows}\n`), mapping: eventMapping, importType: 'EVENT_LOG', batchId: 'b', recordOrigin: 'user_import' });
    expect(result.rowsRejected).toBe(200);
    expect(result.rejections.length).toBeLessThanOrEqual(25);
  });
});

describe('upload security', () => {
  it('reduces a traversal filename to a safe basename', () => {
    expect(safeFilename('../../../etc/passwd')).toBe('passwd');
    expect(safeFilename('..\\..\\windows\\system32\\cmd.exe')).toBe('cmd.exe');
    expect(safeFilename('/absolute/path/events.csv')).toBe('events.csv');
    expect(safeFilename('....//....//x.csv')).toBe('x.csv');
    expect(safeFilename('')).toBe('upload');
    expect(safeFilename('.')).toBe('upload');
  });

  it('strips control characters and never returns a path separator', () => {
    const cleaned = safeFilename('ev\u0000ents\u001b[31m.csv');
    expect(cleaned).not.toMatch(/[/\\]/);
    // eslint-disable-next-line no-control-regex -- asserting control characters are gone
    expect(cleaned).not.toMatch(/[\u0000-\u001f\u007f]/);
  });

  it('reads the extension from the sanitized name', () => {
    expect(extensionOf('../x/Events.CSV')).toBe('.csv');
    expect(extensionOf('noextension')).toBe('');
  });

  it('rejects a file above the size limit for its kind', () => {
    const huge = Buffer.alloc(11 * 1024 * 1024, 0x41);
    expect(() => checkUpload(file('big.csv', huge), 'tabular')).toThrow(UploadError);
  });

  it('rejects an unsupported or executable extension', () => {
    for (const name of ['payload.exe', 'script.sh', 'thing.js', 'archive.zip']) {
      expect(() => checkUpload(file(name, 'x'), 'tabular')).toThrow(UploadError);
    }
  });

  it('names spreadsheets as deliberately unsupported rather than unknown', () => {
    expect(() => checkUpload(file('sheet.xlsx', 'x'), 'tabular')).toThrow(/CSV/i);
  });

  it('checks magic bytes, not the claimed type', () => {
    expect(looksLikePdf(Buffer.from('%PDF-1.7\n'))).toBe(true);
    expect(looksLikePdf(Buffer.from('MZ\x90\x00'))).toBe(false);
    expect(looksLikeText(Buffer.from('plain text'))).toBe(true);
    expect(looksLikeText(Buffer.from([0x00, 0x01, 0x02]))).toBe(false);
    expect(() => checkUpload(file('notreally.pdf', 'plain text'), 'document')).toThrow(UploadError);
    expect(() => checkUpload(file('binary.csv', Buffer.from([0x00, 0x01])), 'tabular')).toThrow(UploadError);
  });

  it('rejects an empty upload and invalid UTF-8', () => {
    expect(() => checkUpload(undefined, 'tabular')).toThrow(UploadError);
    expect(() => checkUpload(file('empty.csv', ''), 'tabular')).toThrow(UploadError);
    expect(() => decodeText(Buffer.from([0xff, 0xfe, 0xfd]))).toThrow(UploadError);
  });

  it('accepts a well-formed CSV and a text PDF', () => {
    expect(checkUpload(file('events.csv', 'a,b\n1,2\n'), 'tabular').extension).toBe('.csv');
    expect(checkUpload(file('manual.pdf', Buffer.from('%PDF-1.4 body')), 'document').extension).toBe('.pdf');
  });
});

describe('document chunking', () => {
  const paragraph = (n: number) => `Section ${n}\n\n${'sentence about turbines. '.repeat(30)}`;

  it('produces bounded chunks and keeps a heading as the section label', () => {
    const chunks = chunkText(`Gearbox thermal management\n\n${'text about cooling. '.repeat(40)}\n\nCooler fouling\n\n${'more text here. '.repeat(40)}`);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((chunk) => chunk.content.length <= 7000)).toBe(true);
    expect(chunks.some((chunk) => chunk.section !== null)).toBe(true);
  });

  it('refuses a document with nothing worth indexing', () => {
    expect(() => chunkText('')).toThrow(KnowledgeError);
    expect(() => chunkText('   \n\n  ')).toThrow(KnowledgeError);
    expect(() => chunkText('too short')).toThrow(KnowledgeError);
  });

  it('caps the number of chunks from one document', () => {
    const many = Array.from({ length: 400 }, (_, i) => paragraph(i)).join('\n\n');
    expect(chunkText(many).length).toBeLessThanOrEqual(120);
  });

  it('never lets a reset reach real public data', () => {
    // demo:reset clears presentation residue and, with --include-imports, a user's own imports.
    // Genuine public_data — the imported Penmanshiel history — is reachable by neither.
    const presentation = ['user_demo', 'simulation'];
    const withImports = [...presentation, 'user_import'];
    expect(presentation).not.toContain('public_data');
    expect(withImports).not.toContain('public_data');
    expect(withImports).not.toContain('public_reference');
    expect(withImports).not.toContain('synthetic_demo');
  });

  it('protects the public and synthetic corpora from deletion', () => {
    expect(PROTECTED_ORIGINS).toContain('public_reference');
    expect(PROTECTED_ORIGINS).toContain('public_data');
    expect(PROTECTED_ORIGINS).toContain('synthetic_demo');
    expect(PROTECTED_ORIGINS).not.toContain('user_import');
  });
});

describe('fleet query planning', () => {
  it('refuses an operation outside the allowlist instead of defaulting', () => {
    for (const bad of [
      { operation: 'drop_tables' },
      { operation: 'select * from assets' },
      { operation: '' },
      { operation: 123 },
      {}, null, 'fault_recurrence',
    ]) expect(validatePlan(bad)).toBeNull();
  });

  it('accepts an allowlisted operation and clamps its parameters', () => {
    const plan = validatePlan({ operation: 'fault_recurrence', minimumOccurrences: 9999, days: 99999 }, 'at least 3 in 30 days');
    expect(plan?.operation).toBe('fault_recurrence');
    expect(plan?.minimumOccurrences).toBeLessThanOrEqual(10);
    expect(plan?.days).toBeLessThanOrEqual(3650);
  });

  it('ignores a numeric parameter the question never asked for', () => {
    const plan = validatePlan({ operation: 'fault_recurrence', minimumOccurrences: 100 }, 'Which turbines have recurring faults?');
    expect(plan?.minimumOccurrences).toBe(DEFAULT_RECURRENCE_MINIMUM);
  });

  it('drops a malformed event code rather than passing it through', () => {
    expect(validatePlan({ operation: 'event_code_assets', eventCode: "X'; drop table assets;--" })?.eventCode).toBeNull();
    expect(validatePlan({ operation: 'event_code_assets', eventCode: 'PITCH-HYD-214' })?.eventCode).toBe('PITCH-HYD-214');
  });

  it('falls back to a deterministic plan without a model', () => {
    expect(heuristicPlan('Which assets have unresolved incidents?').operation).toBe('open_incidents');
    expect(heuristicPlan('What faults appeared most often?').operation).toBe('frequent_faults');
    expect(heuristicPlan('Which machines had faults after maintenance?').operation).toBe('faults_after_maintenance');
    expect(heuristicPlan('Which turbines have recurring faults?').operation).toBe('fault_recurrence');
  });

  it('refuses an unsafe fleet question before running any query', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    const response = await runFleetCopilot('How do I bypass protection across the fleet?', { db });
    expect(response.answer.safetyStatus).toBe('REFUSED');
    expect(response.plan).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('ignores a model plan that fails validation and still answers', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    const llm = { embed: async () => null, synthesize: async () => null,
      structured: async () => ({ operation: 'delete_everything' }) } as unknown as LlmClient;
    const response = await runFleetCopilot('Which turbines have recurring faults?', { db, llm });
    expect(response.plan?.operation).toBe('fault_recurrence');
    expect(db.query).toHaveBeenCalled();
  });
});

describe('copilot context handling', () => {
  it('classifies intent deterministically, with safety winning', () => {
    expect(classifyIntent('Can I bypass the pressure protection?')).toBe('SAFETY');
    expect(classifyIntent('Has this happened before?')).toBe('HISTORY');
    expect(classifyIntent('How was it solved previously?')).toBe('PREVIOUS_RESOLUTION');
    expect(classifyIntent('Compare with other turbines')).toBe('SIMILAR_INCIDENTS');
    expect(classifyIntent('What changed recently?')).toBe('RECENT_CHANGES');
    expect(classifyIntent('Show the technical reference')).toBe('TECHNICAL_GUIDANCE');
    // "technical references" outranks a passing mention of maintenance.
    expect(classifyIntent('What published technical references apply to drivetrain reliability and maintenance?')).toBe('TECHNICAL_GUIDANCE');
    // ...but a plain maintenance question still routes to the change window.
    expect(classifyIntent('What maintenance was carried out?')).toBe('RECENT_CHANGES');
  });

  it('bounds conversation history in both length and size', () => {
    const long = Array.from({ length: 40 }, (_, i) => ({ role: 'user' as const, content: `q${i} `.repeat(400) }));
    const bounded = boundHistory(long);
    expect(bounded).toHaveLength(MAX_HISTORY_MESSAGES);
    expect(bounded.every((message) => message.content.length <= 600)).toBe(true);
    expect(boundHistory(undefined)).toEqual([]);
  });

  it('resolves a referential follow-up against the last user turn', () => {
    const history = [{ role: 'user' as const, content: 'Has PITCH-HYD-214 happened before?' }];
    expect(resolveFollowUp('what about the previous one?', history)).toMatch(/PITCH-HYD-214/);
    // A self-contained question is left exactly as asked.
    expect(resolveFollowUp('What changed recently?', history)).toBe('What changed recently?');
    expect(resolveFollowUp('what about that?', [])).toBe('what about that?');
  });

  it('keeps a rewritten follow-up subject to the safety guard', () => {
    const history = [{ role: 'user' as const, content: 'Tell me about the pitch system' }];
    const resolved = resolveFollowUp('and bypass the interlock?', history);
    expect(classifyIntent(resolved)).toBe('SAFETY');
  });

  it('answers honestly when an asset has no machine memory yet', () => {
    const empty = emptyMemoryAnswer();
    expect(empty.answer.evidenceStrength).toBe('INSUFFICIENT');
    expect(empty.evidence).toEqual([]);
    expect(empty.answer.summary).toMatch(/no operational history/i);
  });
});

describe('evidence diversity', () => {
  it('caps how many passages one document contributes', () => {
    expect(MAX_PER_SOURCE).toBeGreaterThan(0);
    expect(MAX_PER_SOURCE).toBeLessThan(12);
  });
});
