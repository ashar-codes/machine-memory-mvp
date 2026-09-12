// Regression: opening a reviewed public knowledge source returned 400 VALIDATION_ERROR.
//
// `documents.id` has two provenances. An uploaded document takes `gen_random_uuid()`, which is an
// RFC-4122 v4 UUID. A reviewed public corpus document takes its id from the first 128 bits of the
// SHA-256 of its normalized manifest (`documentIdentity`), so re-ingesting identical content stays
// idempotent — which leaves the version and variant nibbles arbitrary. Postgres stores both happily
// because its `uuid` type only checks the lexical form, but the route parsed the parameter with
// `z.uuid()`, which enforces RFC-4122 and rejected every corpus id before any query ran.
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { createApp } from '../../backend/src/app.js';
import { documentIdentity, validateManifest } from '../../scripts/rag/manifest.js';

const PUBLIC_CORPUS = [
  'osha-wind-lockout-tagout.json',
  'osha-1910-269-hazardous-energy.json',
  'nrel-tp-5000-80195-drivetrain-reliability.json',
];

/** The ids the reviewed public corpus actually ingests under, derived, never hardcoded. */
const corpusIds = PUBLIC_CORPUS.map((name) => ({
  name,
  id: documentIdentity(validateManifest(
    JSON.parse(readFileSync(new URL(`../../data/knowledge/${name}`, import.meta.url), 'utf8')),
  )).id,
}));

/** An uploaded document's id: what `gen_random_uuid()` produces. */
const UPLOAD_ID = '3e9d1878-3561-4087-b4f4-1eb420f0c793';
const RFC_4122 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sourceRow(id: string, recordOrigin: string) {
  return {
    id, title: 'Reviewed reference', organization: 'Test body',
    source_type: 'SAFETY_REFERENCE', authority_class: 'REGULATOR', record_origin: recordOrigin,
    source_url: 'https://example.org/doc', created_at: new Date(), metadata: {},
    chunks: 1, embedded_chunks: 1,
  };
}

/** Records every statement so the test can prove the id is bound, never interpolated. */
function stubPool(known: Map<string, string>) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const query = async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values: values ?? [] });
    const id = String((values ?? [])[0] ?? '');
    const origin = known.get(id);
    if (sql.includes('from public.documents d where d.id = $1')) {
      return { rows: origin ? [sourceRow(id, origin)] : [] };
    }
    if (sql.includes('select record_origin from public.documents where id = $1')) {
      return { rows: origin ? [{ record_origin: origin }] : [] };
    }
    if (sql.includes('from public.document_chunks where document_id = $1')) {
      return { rows: [{ chunk_index: 0, section: 'Scope', page_number: null, excerpt: 'Passage text.', embedded: true }] };
    }
    return { rows: [] };
  };
  return { calls, pool: { query, connect: async () => ({ query, release: vi.fn() }) } as unknown as pg.Pool };
}

async function withServer(pool: pg.Pool, run: (base: string) => Promise<void>) {
  const server = createApp({ pool, llm: { embed: async () => null, synthesize: async () => null } }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('knowledge source id contract', () => {
  it('derives corpus ids that are not RFC-4122, which is what regressed', () => {
    expect(corpusIds).toHaveLength(PUBLIC_CORPUS.length);
    // If every corpus id happened to be RFC-4122 the rest of this file would pass vacuously.
    expect(corpusIds.some((entry) => !RFC_4122.test(entry.id))).toBe(true);
    for (const entry of corpusIds) {
      expect(entry.id, entry.name).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it('opens every reviewed public corpus source', async () => {
    const known = new Map(corpusIds.map((entry) => [entry.id, 'public_reference']));
    const { pool, calls } = stubPool(known);
    await withServer(pool, async (base) => {
      for (const entry of corpusIds) {
        const response = await fetch(`${base}/api/knowledge/${entry.id}`);
        expect(response.status, entry.name).toBe(200);
        const body = await response.json() as { source: { id: string; deletable: boolean }; chunkPreviews: unknown[] };
        expect(body.source.id).toBe(entry.id);
        // A reviewed public source stays protected from interface deletion.
        expect(body.source.deletable).toBe(false);
        expect(body.chunkPreviews).toHaveLength(1);
      }
    });
    // The id reaches SQL as a bound parameter, never spliced into the statement text.
    const lookups = calls.filter((call) => call.sql.includes('where d.id = $1'));
    expect(lookups).toHaveLength(corpusIds.length);
    for (const call of lookups) {
      expect(call.values).toEqual([expect.any(String)]);
      expect(call.sql).not.toContain(String(call.values[0]));
    }
  });

  it('reopens a source after it was closed', async () => {
    const entry = corpusIds[0];
    const { pool } = stubPool(new Map([[entry.id, 'public_reference']]));
    await withServer(pool, async (base) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect((await fetch(`${base}/api/knowledge/${entry.id}`)).status).toBe(200);
      }
    });
  });

  it('keeps uploaded documents openable and deletable', async () => {
    const { pool } = stubPool(new Map([[UPLOAD_ID, 'user_import']]));
    await withServer(pool, async (base) => {
      const detail = await fetch(`${base}/api/knowledge/${UPLOAD_ID}`);
      expect(detail.status).toBe(200);
      expect((await detail.json() as { source: { deletable: boolean } }).source.deletable).toBe(true);
      expect((await fetch(`${base}/api/knowledge/${UPLOAD_ID}`, { method: 'DELETE' })).status).toBe(200);
    });
  });

  it('refuses to delete a reviewed public source', async () => {
    const entry = corpusIds[0];
    const { pool } = stubPool(new Map([[entry.id, 'public_reference']]));
    await withServer(pool, async (base) => {
      const response = await fetch(`${base}/api/knowledge/${entry.id}`, { method: 'DELETE' });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: 'SOURCE_PROTECTED' } });
    });
  });

  it('still answers 404 for a well-formed id that is not stored', async () => {
    const { pool } = stubPool(new Map());
    await withServer(pool, async (base) => {
      const response = await fetch(`${base}/api/knowledge/${corpusIds[0].id}`);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: 'SOURCE_NOT_FOUND' } });
    });
  });

  it.each([
    ['empty segment', '%20'],
    ['too short', 'd0f49606-1b7b-e8ee-9739-b49f0144ce3'],
    ['too long', 'd0f49606-1b7b-e8ee-9739-b49f0144ce3cc'],
    ['non-hex digit', 'd0f49606-1b7b-e8ee-9739-b49f0144ce3g'],
    ['wrong separators', 'd0f49606_1b7b_e8ee_9739_b49f0144ce3c'],
    ['unseparated hex', '00000000000000000000000000000000'],
    ['sql fragment', "' or 1=1 --"],
    ['appended statement', 'd0f49606-1b7b-e8ee-9739-b49f0144ce3c; drop table public.documents'],
    ['path traversal', '..%2f..%2fetc%2fpasswd'],
  ])('rejects a %s id before it reaches the database', async (_label, id) => {
    const { pool, calls } = stubPool(new Map());
    await withServer(pool, async (base) => {
      for (const method of ['GET', 'DELETE'] as const) {
        const response = await fetch(`${base}/api/knowledge/${encodeURIComponent(id)}`, { method });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      }
    });
    expect(calls.filter((call) => call.sql.includes('public.documents'))).toHaveLength(0);
  });
});
