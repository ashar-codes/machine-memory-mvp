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

/** Addresses the unauthenticated local foundation may bind to. */
const LOOPBACK_HOSTS = ['127.0.0.1', '::1'];
/** Addresses the temporary demo deployment may bind to. Render requires a wildcard bind. */
const DEMO_BIND_HOSTS = [...LOOPBACK_HOSTS, '0.0.0.0', '::'];
/**
 * Shortest shared password worth calling a gate. This is the only thing standing between the
 * public Internet and a deployment that writes to a database and spends model quota, so a
 * three-character password is refused at startup rather than discovered later.
 */
const MIN_DEMO_PASSWORD_LENGTH = 12;

/**
 * Temporary demonstration access, not product authentication.
 *
 * Everything here exists so a teacher or a hackathon judge can open one URL. There is no user
 * identity, no session, no authorization and no per-user audit trail: one shared credential
 * gates one shared deployment. It must never be described as authentication.
 */
export interface DemoDeployment {
  /** Normalized origin the browser is expected to use, e.g. https://machine-memory-demo.onrender.com */
  publicOrigin: string;
  /** Hostname alone, for the Host header check. */
  publicHost: string;
  basicAuthUser: string;
  basicAuthPassword: string;
}

/**
 * Validates the public origin.
 *
 * Parsed rather than pattern-matched, so no substring trick ("https://evil.com/?x=onrender.com",
 * "https://onrender.com.evil.com") can be read as the configured origin. The comparison the
 * request path performs is against `URL.origin`, which carries scheme, host and port and nothing
 * else, so a path, query or credentials in the configured value would be silently dropped — they
 * are rejected here instead, where the operator can see why.
 */
function readPublicOrigin(raw: string | undefined): { origin: string; host: string } {
  const value = raw?.trim();
  if (!value) throw new Error('PUBLIC_ORIGIN is required when DEMO_DEPLOYMENT=true.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('PUBLIC_ORIGIN must be an absolute URL, for example https://your-service.onrender.com'); }
  if (url.protocol !== 'https:') throw new Error('PUBLIC_ORIGIN must use https.');
  if (!url.hostname) throw new Error('PUBLIC_ORIGIN must name a host.');
  if (url.username || url.password) throw new Error('PUBLIC_ORIGIN must not contain credentials.');
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('PUBLIC_ORIGIN must be an origin only, with no path, query or fragment.');
  return { origin: url.origin, host: url.hostname };
}

/**
 * Reads the demo-deployment settings, failing closed on every missing piece.
 *
 * Requested as one explicit flag rather than inferred from NODE_ENV or from a non-loopback HOST,
 * so a public deployment is always something an operator asked for by name.
 */
function readDemoDeployment(env: NodeJS.ProcessEnv, host: string): DemoDeployment {
  if (!DEMO_BIND_HOSTS.includes(host)) throw new Error(`Demo deployment must bind to one of ${DEMO_BIND_HOSTS.join(', ')}.`);
  const { origin, host: publicHost } = readPublicOrigin(env.PUBLIC_ORIGIN);
  const basicAuthUser = env.DEMO_BASIC_AUTH_USER?.trim() ?? '';
  const basicAuthPassword = env.DEMO_BASIC_AUTH_PASSWORD ?? '';
  if (!basicAuthUser) throw new Error('DEMO_BASIC_AUTH_USER is required when DEMO_DEPLOYMENT=true.');
  if (!basicAuthPassword.trim()) throw new Error('DEMO_BASIC_AUTH_PASSWORD is required when DEMO_DEPLOYMENT=true.');
  if (basicAuthPassword.length < MIN_DEMO_PASSWORD_LENGTH) {
    throw new Error(`DEMO_BASIC_AUTH_PASSWORD must be at least ${MIN_DEMO_PASSWORD_LENGTH} characters.`);
  }
  return { publicOrigin: origin, publicHost, basicAuthUser, basicAuthPassword };
}

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const host = env.HOST ?? '127.0.0.1';
  // One explicit flag separates the two supported ways to run this service. Without it nothing
  // changes: the local foundation stays loopback-only and refuses to start in production.
  const demoRequested = env.DEMO_DEPLOYMENT?.trim() === 'true';
  if (!demoRequested) {
    if (!LOOPBACK_HOSTS.includes(host)) throw new Error('No-login foundation must bind to loopback. Set DEMO_DEPLOYMENT=true for the documented temporary demo deployment.');
    if (env.NODE_ENV === 'production') throw new Error('Production startup disabled until authentication is implemented. Set DEMO_DEPLOYMENT=true for the documented temporary demo deployment.');
  }
  const demo = demoRequested ? readDemoDeployment(env, host) : null;
  // Render supplies PORT; it is read the same way locally, so nothing is hardcoded for either.
  const port = Number(env.PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const dimensions = Number(env.EMBEDDING_DIMENSIONS ?? EMBEDDING_DIMENSIONS);
  if (dimensions !== EMBEDDING_DIMENSIONS) throw new Error('EMBEDDING_DIMENSIONS must match the migrated vector size.');
  const embeddingModel = env.GEMINI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
  if (embeddingModel !== DEFAULT_EMBEDDING_MODEL) throw new Error('GEMINI_EMBEDDING_MODEL must match the supported corpus model.');
  return {
    host, port, demo,
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
