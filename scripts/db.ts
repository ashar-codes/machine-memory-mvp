import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
export const rootPath = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: resolve(rootPath, '.env'), quiet: true });
export async function openDatabase(): Promise<pg.Client> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required. Configure the dedicated Machine Memory database.');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database protocol.');
  // pg connection-string SSL parameters can override explicit certificate checks.
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('ssl')) throw new Error('Remove SSL URL parameters; certificate verification is managed explicitly.');
  }
  const local = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  const ca = process.env.DATABASE_CA_PATH ? readFileSync(resolve(rootPath, process.env.DATABASE_CA_PATH), 'utf8') : undefined;
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000,
    statement_timeout: 30000, ssl: local ? false : { rejectUnauthorized: true, ...(ca ? {ca} : {}) } });
  try { await client.connect(); return client; }
  catch { await client.end().catch(() => undefined); throw new Error('Database connection failed; verify URL, project status and CA certificate.'); }
}
