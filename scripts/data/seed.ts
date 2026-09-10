import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openDatabase, rootPath } from '../db.js';
async function main() {
  const { values } = parseArgs({options:{'dry-run':{type:'boolean',default:false}},strict:true,allowPositionals:false});
  const directory = resolve(rootPath, 'supabase/seed');
  const files = (await readdir(directory)).filter(f => f.endsWith('.sql')).sort();
  if (!files.length) throw new Error('No seed files found.');
  const statements = await Promise.all(files.map(f => readFile(resolve(directory,f),'utf8')));
  if (values['dry-run']) { console.log(JSON.stringify({status:'files_read_only',files,sqlExecuted:false})); return; }
  const db = await openDatabase();
  try {
    // Files are reviewed, repository-owned SQL scripts, not user/model input.
    // Each seed owns its BEGIN/COMMIT and idempotent primary-key handling.
    for (const sql of statements) await db.query(sql);
    console.log('Synthetic seed committed. No public records were fabricated.');
  } finally { await db.end(); }
}
main().catch(() => {console.error('Seed failed. Check DATABASE_URL, migration and seed constraints; credentials are not logged.');process.exitCode=1;});
