import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
const rootPath = fileURLToPath(new URL('../../', import.meta.url));
export function createPool(connectionString?: string, caPath = process.env.DATABASE_CA_PATH): pg.Pool | undefined {
  if (!connectionString) return undefined;
  let url: URL;
  try { url = new URL(connectionString); }
  catch { throw new Error('Invalid DATABASE_URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use PostgreSQL.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  // pg URL SSL options can override explicit certificate checks. Fail closed, including mixed-case options.
  for (const key of url.searchParams.keys()) {
    if (key.toLowerCase().startsWith('ssl')) throw new Error('Remove SSL URL parameters; certificate verification is managed explicitly.');
  }
  let ca: string | undefined;
  if (caPath) {
    try { ca = readFileSync(resolve(rootPath, caPath), 'utf8'); }
    catch { throw new Error('DATABASE_CA_PATH could not be read.'); }
    if (!ca.includes('-----BEGIN CERTIFICATE-----')) throw new Error('DATABASE_CA_PATH must contain a PEM certificate.');
  }
  const pool = new pg.Pool({ connectionString: url.toString(), ssl: local ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) }, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 10000 });
  // pg emits idle-client errors outside requests; handle without exposing connection details.
  pool.on('error', () => console.error('Idle database connection failed.'));
  // A client that is *checked out* emits 'error' on itself, not on the pool. With no listener,
  // Node rethrows it and the process dies — which is exactly what a dropped TLS socket did during
  // a live simulator run. The pool still discards the broken client; this only stops the crash.
  pool.on('connect', (client) => {
    client.on('error', () => console.error('Database connection dropped; the pooled client was discarded.'));
  });
  return pool;
}
