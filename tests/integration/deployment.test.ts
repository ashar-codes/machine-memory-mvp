// Temporary Render demo deployment: configuration gates, the shared-credential gate, the public
// origin rule and static frontend serving.
//
// No credential here resembles a real one, nothing is read from the environment, and no test
// reaches a database, a model provider or the network beyond a loopback server it starts itself.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { request, type Server } from 'node:http';
import { createApp, DEFAULT_STATIC_DIR, HEALTH_PATH } from '../../backend/src/app.js';
import { readConfig, type DemoDeployment } from '../../backend/src/config.js';

const PUBLIC_ORIGIN = 'https://machine-memory-demo.onrender.com';
// Structurally valid and deliberately fake: these never gate anything real.
const DEMO_USER = 'demo-reviewer';
const DEMO_PASSWORD = 'local-smoke-test-placeholder';

/**
 * A raw request, because fetch cannot express what these tests are about.
 *
 * `Host` is a forbidden header name, so undici drops it silently. `Sec-Fetch-Mode` is worse: undici
 * overwrites it with the mode of its own request, so a browser navigation written with fetch
 * arrives as `sec-fetch-mode: cors` and the test would assert against a request nobody makes.
 */
function rawRequest(port: number, path: string, headers: Record<string, string>,
  options: { method?: string; body?: string } = {}) {
  return new Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
    const call = request({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body, headers: response.headers }));
    });
    call.on('error', reject);
    if (options.body) call.write(options.body);
    call.end();
  });
}

const DEMO_ENV = {
  NODE_ENV: 'production', HOST: '0.0.0.0', PORT: '10000', EMBEDDING_DIMENSIONS: '1536',
  DEMO_DEPLOYMENT: 'true', PUBLIC_ORIGIN,
  DEMO_BASIC_AUTH_USER: DEMO_USER, DEMO_BASIC_AUTH_PASSWORD: DEMO_PASSWORD,
} as NodeJS.ProcessEnv;

describe('deployment configuration fails closed', () => {
  it('keeps the local foundation loopback-only and non-production by default', () => {
    const config = readConfig({ EMBEDDING_DIMENSIONS: '1536' } as NodeJS.ProcessEnv);
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3001);
    expect(config.demo).toBeNull();
  });

  it('refuses production startup without the explicit demo flag', () => {
    expect(() => readConfig({ NODE_ENV: 'production', EMBEDDING_DIMENSIONS: '1536' } as NodeJS.ProcessEnv))
      .toThrow('Production startup disabled');
  });

  it('refuses a public bind address without the explicit demo flag', () => {
    expect(() => readConfig({ HOST: '0.0.0.0', EMBEDDING_DIMENSIONS: '1536' } as NodeJS.ProcessEnv))
      .toThrow('loopback');
  });

  it('refuses the demo flag without a public origin', () => {
    expect(() => readConfig({ ...DEMO_ENV, PUBLIC_ORIGIN: '' } as NodeJS.ProcessEnv)).toThrow('PUBLIC_ORIGIN is required');
    expect(() => readConfig({ ...DEMO_ENV, PUBLIC_ORIGIN: '   ' } as NodeJS.ProcessEnv)).toThrow('PUBLIC_ORIGIN is required');
  });

  it.each([
    ['http://machine-memory-demo.onrender.com', 'https'],
    ['machine-memory-demo.onrender.com', 'absolute URL'],
    ['https://machine-memory-demo.onrender.com/app', 'origin only'],
    ['https://machine-memory-demo.onrender.com/?next=x', 'origin only'],
    ['https://user:secret@machine-memory-demo.onrender.com', 'credentials'],
  ])('refuses an unusable public origin: %s', (origin, reason) => {
    expect(() => readConfig({ ...DEMO_ENV, PUBLIC_ORIGIN: origin } as NodeJS.ProcessEnv)).toThrow(reason);
  });

  it.each([
    ['DEMO_BASIC_AUTH_USER', 'DEMO_BASIC_AUTH_USER is required'],
    ['DEMO_BASIC_AUTH_PASSWORD', 'DEMO_BASIC_AUTH_PASSWORD is required'],
  ])('refuses the demo flag without %s', (key, message) => {
    expect(() => readConfig({ ...DEMO_ENV, [key]: '' } as NodeJS.ProcessEnv)).toThrow(message);
  });

  it('refuses a demo password too short to be worth calling a gate', () => {
    expect(() => readConfig({ ...DEMO_ENV, DEMO_BASIC_AUTH_PASSWORD: 'short' } as NodeJS.ProcessEnv))
      .toThrow('at least 12 characters');
  });

  it('refuses a demo deployment bound somewhere Render cannot reach', () => {
    expect(() => readConfig({ ...DEMO_ENV, HOST: '10.0.0.5' } as NodeJS.ProcessEnv)).toThrow('must bind to');
  });

  it('loads a complete demo deployment', () => {
    const config = readConfig(DEMO_ENV);
    expect(config.host).toBe('0.0.0.0');
    // Render supplies PORT; nothing about it is hardcoded.
    expect(config.port).toBe(10000);
    expect(config.demo).toEqual({
      publicOrigin: PUBLIC_ORIGIN, publicHost: 'machine-memory-demo.onrender.com',
      basicAuthUser: DEMO_USER, basicAuthPassword: DEMO_PASSWORD,
    });
  });

  it('points at the compiled frontend, not at source or the repository root', () => {
    expect(DEFAULT_STATIC_DIR.replace(/\\/g, '/')).toMatch(/\/frontend\/dist\/$/);
  });
});

describe('demo deployment HTTP boundary (real loopback server, no external services)', () => {
  let server: Server;
  let base: string;
  let staticDir: string;
  const demo = readConfig(DEMO_ENV).demo as DemoDeployment;
  const credential = `Basic ${Buffer.from(`${DEMO_USER}:${DEMO_PASSWORD}`).toString('base64')}`;

  beforeAll(() => {
    staticDir = mkdtempSync(join(tmpdir(), 'machine-memory-dist-'));
    writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>Machine Memory</title><div id="root"></div>');
    mkdirSync(join(staticDir, 'assets'));
    writeFileSync(join(staticDir, 'assets', 'index-test.css'), '#root{color:inherit}');
  });
  afterAll(() => rmSync(staticDir, { recursive: true, force: true }));

  beforeEach(async () => {
    server = createApp({ demo, staticDir }).listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const authed = (path: string, init: RequestInit = {}) =>
    fetch(base + path, { ...init, headers: { ...init.headers, Authorization: credential } });

  it('lets Render reach the health check without the shared credential', async () => {
    const response = await fetch(base + HEALTH_PATH);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    // Honest about absent services, and it names no secret.
    expect(body.database).toBe('not_configured');
    expect(JSON.stringify(body)).not.toContain(DEMO_PASSWORD);
  });

  it('challenges an unauthenticated request for everything else', async () => {
    for (const path of ['/', '/api/assets', '/investigation', '/assets/index-test.css']) {
      const response = await fetch(base + path);
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Basic realm="Machine Memory Demo", charset="UTF-8"');
    }
  });

  it.each([
    ['no scheme', 'Zm9v'],
    ['wrong scheme', 'Bearer token'],
    ['unparseable credential', 'Basic not-base64-with-no-colon'],
    ['wrong password', `Basic ${Buffer.from(`${DEMO_USER}:wrong-password-value`).toString('base64')}`],
    ['wrong username', `Basic ${Buffer.from(`intruder:${DEMO_PASSWORD}`).toString('base64')}`],
    ['empty credential', `Basic ${Buffer.from(':').toString('base64')}`],
  ])('rejects %s', async (_label, header) => {
    const response = await fetch(base + '/', { headers: { Authorization: header } });
    expect(response.status).toBe(401);
  });

  it('never echoes the credential back in a challenge', async () => {
    const response = await fetch(base + '/', { headers: { Authorization: credential } });
    expect(response.status).not.toBe(401);
    const challenge = await fetch(base + '/');
    const body = await challenge.text();
    expect(body).not.toContain(DEMO_PASSWORD);
    expect(body).not.toContain(DEMO_USER);
    expect(JSON.stringify([...challenge.headers])).not.toContain(DEMO_PASSWORD);
  });

  it('serves the single-page application for a browser route once authenticated', async () => {
    for (const path of ['/', '/investigation', '/fleet/PEN-T01']) {
      const response = await authed(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/text\/html/);
      expect(await response.text()).toContain('<div id="root">');
    }
  });

  it('serves a built static asset', async () => {
    const response = await authed('/assets/index-test.css');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('#root');
  });

  it('keeps an unknown API path an API 404, never the single-page application', async () => {
    const response = await authed('/api/not-a-real-route');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('keeps API error semantics for a real route without a database', async () => {
    const response = await authed('/api/assets');
    expect(response.status).toBe(503);
    expect((await response.json() as { error: { code: string } }).error.code).toBe('DATABASE_NOT_CONFIGURED');
  });

  it('does not let the page fallback answer a non-GET request', async () => {
    const response = await authed('/investigation', { method: 'POST' });
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('serves nothing outside the compiled frontend directory', async () => {
    for (const path of ['/.env', '/package.json', '/backend/src/app.ts', '/../.env', '/%2e%2e/.env']) {
      const response = await authed(path);
      // Either refused outright or answered by the single-page shell; never repository content.
      const body = response.ok ? await response.text() : '';
      expect(body).not.toContain('DATABASE_URL');
      expect(body).not.toContain('GEMINI_API_KEY');
    }
  });

  it('accepts the configured public origin and rejects every other', async () => {
    const accepted = await authed('/api/health', { headers: { Origin: PUBLIC_ORIGIN } });
    expect(accepted.status).toBe(200);
    for (const origin of [
      'https://machine-memory-demo.onrender.com.evil.example',
      'https://evil.example/?x=https://machine-memory-demo.onrender.com',
      'http://machine-memory-demo.onrender.com',
      'https://evil.example',
      'null',
    ]) {
      const rejected = await authed('/api/health', { headers: { Origin: origin } });
      expect(rejected.status).toBe(403);
      expect((await rejected.json() as { error: { code: string } }).error.code).toBe('ORIGIN_REJECTED');
    }
  });

  it('still rejects a cross-site browser request', async () => {
    const response = await authed('/api/health', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    expect(response.status).toBe(403);
  });

  it('rejects a Host header that is not the configured public host', async () => {
    const port = (server.address() as AddressInfo).port;
    const rejected = await rawRequest(port, '/api/health', { Host: 'evil.example', Authorization: credential });
    expect(rejected.status).toBe(403);
    expect(JSON.parse(rejected.body).error.code).toBe('HOST_REJECTED');
    // The configured public host is the one that gets through.
    const accepted = await rawRequest(port, '/api/health', { Host: 'machine-memory-demo.onrender.com', Authorization: credential });
    expect(accepted.status).toBe(200);
  });

  it('never sets a wildcard cross-origin header', async () => {
    const response = await authed('/api/health', { headers: { Origin: PUBLIC_ORIGIN } });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('a link to the demo from another site reaches the credential gate', () => {
  // The deployed service was unreachable by the people it exists for: every link click from
  // email, a chat message, a university LMS or another page is a cross-site request, and the
  // blanket Sec-Fetch-Site rejection answered 403 before the browser ever showed the credential
  // prompt. A top-level navigation now continues to that prompt; nothing else is relaxed.
  let server: Server;
  let port: number;
  let staticDir: string;
  const demo = readConfig(DEMO_ENV).demo as DemoDeployment;
  const credential = `Basic ${Buffer.from(`${DEMO_USER}:${DEMO_PASSWORD}`).toString('base64')}`;

  /** What a browser sends when a person clicks a link to us on someone else's page. */
  const LINK_CLICK = {
    'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document', Accept: 'text/html,application/xhtml+xml',
  };
  /** What a script on someone else's page sends. Same site value; different mode and destination. */
  const CROSS_SITE_FETCH = {
    'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty',
  };

  beforeAll(() => {
    staticDir = mkdtempSync(join(tmpdir(), 'machine-memory-dist-nav-'));
    writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>Machine Memory</title><div id="root"></div>');
  });
  afterAll(() => rmSync(staticDir, { recursive: true, force: true }));

  beforeEach(async () => {
    server = createApp({ demo, staticDir }).listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const send = (path: string, headers: Record<string, string>, options?: { method?: string; body?: string }) =>
    rawRequest(port, path, headers, options);
  const errorCode = (body: string) => (JSON.parse(body) as { error: { code: string } }).error.code;

  it.each(['/', '/investigation', '/fleet/PEN-T01'])('asks for the credential instead of refusing the link: %s', async (path) => {
    const response = await send(path, LINK_CLICK);
    expect(response.status).toBe(401);
    expect(errorCode(response.body)).toBe('DEMO_AUTH_REQUIRED');
    expect(response.headers['www-authenticate']).toBe('Basic realm="Machine Memory Demo", charset="UTF-8"');
  });

  it('serves the application once that prompt is answered', async () => {
    const response = await send('/', { ...LINK_CLICK, Authorization: credential });
    expect(response.status).toBe(200);
    expect(String(response.headers['content-type'])).toMatch(/text\/html/);
    expect(response.body).toContain('<div id="root">');
  });

  it('still refuses a cross-site script reading the API, credential or not', async () => {
    // The browser attaches the cached Basic credential to cross-site requests on its own, so this
    // is the case that would be a live CSRF path if it were allowed through.
    for (const headers of [CROSS_SITE_FETCH, { ...CROSS_SITE_FETCH, Authorization: credential }]) {
      const response = await send('/api/assets', headers);
      expect(response.status).toBe(403);
      expect(errorCode(response.body)).toBe('ORIGIN_REJECTED');
    }
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('still refuses a cross-site %s to the API', async (method) => {
    const response = await send('/api/resolutions',
      { ...CROSS_SITE_FETCH, Authorization: credential, 'Content-Type': 'application/json', 'Content-Length': '2' },
      { method, body: '{}' });
    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe('ORIGIN_REJECTED');
  });

  it('still refuses a cross-site form post, which is a navigation but not a GET', async () => {
    const body = 'assetCode=WT-07';
    const response = await send('/api/resolutions',
      { ...LINK_CLICK, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(body.length) },
      { method: 'POST', body });
    expect(response.status).toBe(403);
  });

  it('still refuses a cross-site event stream', async () => {
    const response = await send('/api/scada/stream',
      { ...CROSS_SITE_FETCH, Accept: 'text/event-stream', Authorization: credential });
    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe('ORIGIN_REJECTED');
  });

  it('still refuses a cross-site upload', async () => {
    const body = '--x\r\nContent-Disposition: form-data; name="importType"\r\n\r\nEVENT_LOG\r\n--x--\r\n';
    const response = await send('/api/import/preview',
      { ...CROSS_SITE_FETCH, Authorization: credential, 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(body.length) },
      { method: 'POST', body });
    expect(response.status).toBe(403);
  });

  it('does not let the navigation exemption reach any API route but the health check', async () => {
    for (const path of ['/api/assets', '/api/events', '/api/copilot', '/api/scada/stream', '/api']) {
      const response = await send(path, { ...LINK_CLICK, Authorization: credential });
      expect(response.status).toBe(403);
      expect(errorCode(response.body)).toBe('ORIGIN_REJECTED');
    }
  });

  it('lets a person open the health check from a link, with no credential', async () => {
    expect((await send(HEALTH_PATH, LINK_CLICK)).status).toBe(200);
    // And Render's own probe, which sends no Fetch Metadata at all.
    expect((await send(HEALTH_PATH, {})).status).toBe(200);
  });

  it('does not exempt an embedded frame, only a top-level document', async () => {
    const response = await send('/', { ...LINK_CLICK, 'Sec-Fetch-Dest': 'iframe' });
    expect(response.status).toBe(403);
  });

  it('does not exempt a cross-site request that merely claims to be a document', async () => {
    // Destination without navigation mode is not a page load.
    const response = await send('/', { ...CROSS_SITE_FETCH, 'Sec-Fetch-Dest': 'document' });
    expect(response.status).toBe(403);
  });

  it('still checks a spoofed Origin first, navigation or not', async () => {
    for (const extra of [LINK_CLICK, CROSS_SITE_FETCH]) {
      const response = await send('/', { ...extra, Origin: 'https://evil.example' });
      expect(response.status).toBe(403);
      expect(errorCode(response.body)).toBe('ORIGIN_REJECTED');
    }
  });

  it('leaves same-origin application traffic working exactly as before', async () => {
    const response = await send(HEALTH_PATH, {
      Origin: PUBLIC_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty',
    });
    expect(response.status).toBe(200);
  });

  it('still serves a client that sends no Fetch Metadata at all, such as curl', async () => {
    expect((await send('/api/assets', { Authorization: credential })).status).toBe(503);
  });
});

describe('the local foundation is unchanged by the demo option', () => {
  let server: Server;
  let base: string;
  beforeEach(async () => {
    server = createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('needs no credential locally', async () => {
    const response = await fetch(base + HEALTH_PATH);
    expect(response.status).toBe(200);
    expect(response.headers.get('www-authenticate')).toBeNull();
  });

  it('serves no frontend and no page fallback locally', async () => {
    const response = await fetch(base + '/investigation');
    expect(response.status).toBe(404);
    expect((await response.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('still refuses every cross-site request locally, navigation included', async () => {
    // The navigation exemption is a demo-deployment rule. The local foundation serves no frontend
    // and has no credential gate, so there is nothing a link from another site should reach.
    const port = (server.address() as AddressInfo).port;
    for (const headers of [
      { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' },
      { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty' },
    ]) {
      const response = await rawRequest(port, '/api/health', headers);
      expect(response.status).toBe(403);
      expect(JSON.parse(response.body).error.code).toBe('ORIGIN_REJECTED');
    }
  });

  it('still rejects a non-loopback host locally', async () => {
    const response = await rawRequest((server.address() as AddressInfo).port, '/api/health',
      { Host: 'machine-memory-demo.onrender.com' });
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe('LOCAL_ONLY');
  });
});
