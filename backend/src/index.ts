import { createApp } from './app.js';
import { readConfig } from './config.js';
import { createPool } from './db.js';
import { createGroqGenerator } from './groq.js';
import { createLlm } from './llm.js';
import { createFailoverLlm } from './provider.js';
const config = readConfig();
const pool = createPool(config.databaseUrl);
const gemini = createLlm({ apiKey: config.geminiApiKey, model: config.model, embeddingModel: config.embeddingModel, embeddingDimensions: config.embeddingDimensions });
const groq = createGroqGenerator({ apiKey: config.groqApiKey, model: config.groqModel });
const llm = createFailoverLlm({
  gemini, groq, mode: config.generationProviderMode,
  // Non-secret diagnostics only: a provider name and a normalized reason, never an error body.
  onGeneration: (provider, detail) => {
    if (provider !== 'gemini' || detail) console.warn(`Generation provider: ${provider}${detail ? ` (${detail})` : ''}.`);
  },
});
const server = createApp({pool,llmConfigured:config.llmConfigured,llm,embeddingModel:config.embeddingModel}).listen(config.port,config.host,() => {
  console.log(`Machine Memory listening on http://${config.host}:${config.port}`);
  console.log(`Database ${pool ? 'configured' : 'not configured'} · generation ${[gemini && 'gemini', groq && 'groq'].filter(Boolean).join(' → ') || 'deterministic only'}${config.generationProviderMode === 'auto' ? '' : ` · forced: ${config.generationProviderMode}`} · embeddings ${gemini ? 'gemini' : 'unavailable'}`);
  // Open the pool before anyone asks a question. A hosted Postgres connection costs a TCP round
  // trip plus a TLS handshake, and paying for several of them inside the first request is what
  // made the first answer after a restart take tens of seconds while every later one was quick.
  if (pool) {
    void Promise.all(Array.from({ length: 4 }, () => pool.query('select 1')))
      .then(() => console.log('Database connections warmed.'))
      .catch(() => console.warn('Database warm-up failed; connections will open on first use.'));
  }
  // One embedding of a fixed string, for the same reason: it opens the TLS connection to the model
  // host and loads the SDK's request path, both of which the first question otherwise pays for.
  // Every question embeds anyway, so this is the call that was already going to happen, moved
  // earlier. Failure is ignored — a cold first request is the status quo, not a startup error.
  if (gemini) void gemini.embed('machine memory startup warm-up').catch(() => undefined);
});
server.on('error', () => { console.error('Backend listener failed.'); process.exitCode=1; void pool?.end(); });
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal, () => { server.close(() => { void pool?.end().finally(() => process.exit(0)); if (!pool) process.exit(0); }); setTimeout(() => process.exit(1),10000).unref(); });
