import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
// Both backend/src/config.ts and backend/dist/config.js are two levels below the repository.
export const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
dotenv.config({ path: envPath, quiet: true });

export const DEFAULT_MODEL = 'gemini-3.6-flash';
export const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';
// Fixed by the migration's vector(1536) column. Changing it requires a migration and re-embedding.
export const EMBEDDING_DIMENSIONS = 1536;

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const host = env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('No-login foundation must bind to loopback.');
  if (env.NODE_ENV === 'production') throw new Error('Production startup disabled until authentication is implemented.');
  const port = Number(env.PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const dimensions = Number(env.EMBEDDING_DIMENSIONS ?? EMBEDDING_DIMENSIONS);
  if (dimensions !== EMBEDDING_DIMENSIONS) throw new Error('EMBEDDING_DIMENSIONS must match the migrated vector size.');
  return {
    host, port,
    databaseUrl: env.DATABASE_URL,
    llmConfigured: Boolean(env.GEMINI_API_KEY),
    // Secrets stay in this object and never reach the browser or an error response.
    geminiApiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    embeddingModel: env.GEMINI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
  };
}
