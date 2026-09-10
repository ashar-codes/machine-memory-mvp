// Ingests every reviewed manifest in data/knowledge, one at a time, through the existing
// single-document pipeline. No new trust boundary: each file still goes through the same Zod
// validation, provenance checks and transactional insert as `npm run rag:ingest -- --file ...`.
// Already-ingested documents are detected by content identity and skipped.
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { rootPath } from '../db.js';
import { main as ingestOne } from './ingest.js';

const DIRECTORY = 'data/knowledge';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { 'dry-run': { type: 'boolean', default: false }, include: { type: 'string' } },
    strict: true, allowPositionals: false,
  });
  const directory = resolve(rootPath, DIRECTORY);
  const files = (await readdir(directory))
    .filter((name) => name.endsWith('.json'))
    // The synthetic example is a fixture for the tests, not part of the demonstration corpus.
    .filter((name) => values.include ? name.includes(values.include) : !name.includes('.example.'))
    .sort();
  if (!files.length) throw new Error(`No manifests found in ${DIRECTORY}.`);

  const failures: string[] = [];
  for (const file of files) {
    const args = ['--file', `${DIRECTORY}/${file}`, ...(values['dry-run'] ? ['--dry-run'] : [])];
    try {
      console.log(`\n--- ${file}`);
      await ingestOne(args);
    } catch (error) {
      // One bad manifest must not abort the corpus; the rest still ingest and the failure is named.
      failures.push(file);
      console.error(`Failed: ${file} — ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
  console.log(`\nProcessed ${files.length} manifest(s); ${failures.length} failed.`);
  if (failures.length) {
    console.error(`Not ingested: ${failures.join(', ')}. Do not describe these sources as ingested.`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Corpus ingestion failed; credentials are not logged.');
  process.exitCode = 1;
});
