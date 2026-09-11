import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
// Both backend/src/config.ts and backend/dist/config.js are two levels below the repository.
export const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
dotenv.config({ path: envPath, quiet: true });

export const DEFAULT_MODEL = 'gemini-3.6-flash';
export const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';
// Secondary generation provider. Text only: embeddings are never produced by anything but Gemini.
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
const PROVIDER_MODES = ['auto', 'gemini', 'groq'] as const;
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
  const embeddingModel = env.GEMINI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
  if (embeddingModel !== DEFAULT_EMBEDDING_MODEL) throw new Error('GEMINI_EMBEDDING_MODEL must match the supported corpus model.');
  return {
    host, port,
    databaseUrl: env.DATABASE_URL,
    llmConfigured: Boolean(env.GEMINI_API_KEY) || Boolean(env.GROQ_API_KEY),
    // Secrets stay in this object and never reach the browser or an error response.
    geminiApiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    embeddingModel,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
    groqApiKey: env.GROQ_API_KEY,
    groqModel: env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL,
    // Development override for testing failover. Anything unrecognised falls back to 'auto'
    // rather than failing startup, so a typo cannot silently disable a provider in a demo.
    generationProviderMode: (PROVIDER_MODES as readonly string[]).includes(env.AI_GENERATION_PROVIDER?.trim() ?? '')
      ? env.AI_GENERATION_PROVIDER!.trim() as typeof PROVIDER_MODES[number]
      : 'auto',
  };
}
