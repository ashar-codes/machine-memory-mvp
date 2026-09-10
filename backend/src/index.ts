import { createApp } from './app.js';
import { readConfig } from './config.js';
import { createPool } from './db.js';
import { createLlm } from './llm.js';
const config = readConfig();
const pool = createPool(config.databaseUrl);
const llm = createLlm({ apiKey: config.openaiApiKey, model: config.model, embeddingModel: config.embeddingModel, embeddingDimensions: config.embeddingDimensions });
const server = createApp({pool,llmConfigured:config.llmConfigured,llm,embeddingModel:config.embeddingModel}).listen(config.port,config.host,() => {
  console.log(`Machine Memory listening on http://${config.host}:${config.port}`);
  console.log(`Database ${pool ? 'configured' : 'not configured'} · model synthesis ${llm ? 'configured' : 'not configured'}`);
});
server.on('error', () => { console.error('Backend listener failed.'); process.exitCode=1; void pool?.end(); });
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal, () => { server.close(() => { void pool?.end().finally(() => process.exit(0)); if (!pool) process.exit(0); }); setTimeout(() => process.exit(1),10000).unref(); });
