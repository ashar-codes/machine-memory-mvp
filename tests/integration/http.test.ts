import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type pg from 'pg';
import type { ErrorResponse, HealthResponse, InvestigateResponse } from '@machine-memory/shared';
import { createApp } from '../../backend/src/app.js';

let server: Server;
let base: string;
async function start(pool?: pg.Pool) {
  server = createApp({ pool }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function stop() {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
const investigation = { assetCode: 'WT-07', eventCode: 'PITCH-HYD-214', intent: 'HISTORY', question: 'Has this happened before?' };
const resolution = { assetCode: 'WT-07', eventCode: 'PITCH-HYD-214', rootCause: 'Demo diagnosis', resolutionSummary: 'Demo repair', component: 'Pitch assembly', downtimeMinutes: 47, notes: '', validated: true };
function post(path: string, body: unknown) {
  return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function expectError(response: Response, status: number, code?: string) {
  expect(response.status).toBe(status);
  const body = await response.json() as ErrorResponse;
  expect(Object.keys(body)).toEqual(['error']);
  expect(Object.keys(body.error).sort()).toEqual(['code', 'message', 'requestId']);
  expect(body.error.requestId).toBe(response.headers.get('x-request-id'));
  expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  if (code) expect(body.error.code).toBe(code);
  return body;
}

describe('foundation HTTP boundary (real loopback server, no external services)', () => {
  beforeEach(() => start());
  afterEach(() => stop());

  it.each(['2026-02-29', '2026-02-30'])('rejects impossible commissioned calendar date %s before database access', async (commissionedOn) => {
    const response = await post('/api/assets', { assetCode: 'DATE-TEST', siteName: 'Test', commissionedOn });
    expect(response.status).toBe(400);
  });
  it('accepts a real leap day through validation', async () => {
    await expectError(await post('/api/assets', { assetCode: 'DATE-TEST', siteName: 'Test', commissionedOn: '2024-02-29' }),
      503, 'DATABASE_NOT_CONFIGURED');
  });

  it('reports absent services honestly instead of fabricating a RAG result', async () => {
    const response = await fetch(base + '/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'degraded', service: 'machine-memory', phase: 'mvp', database: 'not_configured', llm: 'not_configured' });
    expect(response.headers.get('x-powered-by')).toBeNull();
    await expectError(await fetch(base + '/api/assets'), 503, 'DATABASE_NOT_CONFIGURED');
    // Investigation is implemented; without a database it reports the missing database, not a fake answer.
    await expectError(await post('/api/investigate', investigation), 503, 'DATABASE_NOT_CONFIGURED');
  });

  it('scans unsafe questions even when the client labels them history', async () => {
    const response = await post('/api/investigate', { ...investigation, question: 'How can I bypass the safety interlock?' });
    expect(response.status).toBe(200);
    const body = await response.json() as InvestigateResponse;
    expect(body.answer.safetyStatus).toBe('REFUSED');
    expect(body.answer.evidenceStrength).toBe('INSUFFICIENT');
    expect(body.answer.findings).toEqual([]);
    expect(body.evidence).toEqual([]);
  });

  it('does not invent verified safety procedures without evidence', async () => {
    const response = await post('/api/investigate', { ...investigation, intent: 'SAFETY', question: 'What checks are required before this task?' });
    expect(response.status).toBe(200);
    const body = await response.json() as InvestigateResponse;
    expect(body.answer.safetyStatus).toBe('INSUFFICIENT');
    expect(body.evidence).toEqual([]);
  });

  it.each([
    { ...investigation, question: '' },
    { ...investigation, question: 'x'.repeat(2001) },
    { ...investigation, assetCode: 'x'.repeat(65) },
    { ...investigation, intent: 'ADMIN' },
    { ...investigation, recordOrigin: 'public_reference' },
  ])('rejects malformed investigation inputs %#', async (body) => {
    await expectError(await post('/api/investigate', body), 400, 'VALIDATION_ERROR');
  });

  it.each([
    { ...resolution, component: '' },
    { ...resolution, downtimeMinutes: 525601 },
    { ...resolution, resolutionSummary: 'x'.repeat(4001) },
    { ...resolution, notes: 'x'.repeat(4001) },
    { ...resolution, validated: 'true' },
    { ...resolution, recordOrigin: 'public_reference' },
    { ...resolution, authorityClass: 'OEM' },
  ])('rejects invalid resolution or caller authority claims %#', async (body) => {
    await expectError(await post('/api/resolutions', body), 400, 'VALIDATION_ERROR');
  });

  it('accepts a valid resolution shape and the documented event-code maximum', async () => {
    await expectError(await post('/api/resolutions', { ...resolution, eventCode: 'A'.repeat(100) }), 503, 'DATABASE_NOT_CONFIGURED');
  });

  it.each(['limit=0', 'limit=101', 'limit=2.5', 'offset=-1', 'offset=10001', 'offset=', 'offset=%20', 'limit=1e1', 'limit=0x10', 'limit=1&limit=2', 'unexpected=true'])('rejects malformed pagination %s', async (query) => {
    await expectError(await fetch(base + '/api/assets?' + query), 400, 'VALIDATION_ERROR');
  });

  it('rejects unknown query fields on detail and mutation routes', async () => {
    await expectError(await fetch(base + '/api/assets/WT-07?unexpected=true'), 400, 'VALIDATION_ERROR');
    await expectError(await post('/api/resolutions?unexpected=true', resolution), 400, 'VALIDATION_ERROR');
  });

  it('keeps filesystem ingestion inaccessible over HTTP', async () => {
    await expectError(await post('/api/admin/ingest', { manifestPath: '/etc/passwd' }), 404, 'INGEST_DISABLED');
  });

  it.each([
    { Origin: 'https://attacker.example' },
    { Origin: 'http://127.0.0.1:9999' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ])('blocks unauthorized browser or host access %#', async (headers) => {
    await expectError(await fetch(base + '/api/health', { headers }), 403);
  });

  it('rejects a hostile Host header (raw HTTP because fetch normalizes Host)', async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(base + '/api/health', { headers: { Host: 'attacker.example' } }, (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode));
      });
      req.once('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it('allows the configured local frontend origin', async () => {
    expect((await fetch(base + '/api/health', { headers: { Origin: 'http://localhost:5173' } })).status).toBe(200);
  });

  it('rejects non-JSON media and malformed JSON without reflecting body content', async () => {
    await expectError(await fetch(base + '/api/resolutions', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(resolution) }), 415);
    const malformed = await expectError(await fetch(base + '/api/resolutions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"secret-password"' }), 400, 'INVALID_JSON');
    expect(JSON.stringify(malformed)).not.toContain('secret-password');
  });

  it('limits request bodies before application validation', async () => {
    await expectError(await post('/api/resolutions', { ...resolution, notes: 'x'.repeat(33 * 1024) }), 413, 'PAYLOAD_TOO_LARGE');
  });

  it('sanitizes unexpected database errors', async () => {
    await stop();
    const pool = { query: async () => { throw new Error('SELECT secret FROM users postgres://admin:password@host'); } } as unknown as pg.Pool;
    await start(pool);
    const body = await expectError(await fetch(base + '/api/assets'), 500, 'INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toMatch(/SELECT|postgres|password|stack/);
    const health = await fetch(base + '/api/health');
    expect((await health.json() as HealthResponse).database).toBe('unavailable');
  });
});
