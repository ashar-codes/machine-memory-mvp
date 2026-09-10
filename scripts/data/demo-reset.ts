// Development-only presentation reset. Removes the resolutions a presenter logged through the
// application, plus the semantic memory records those resolutions produced, so the demonstration
// starts from the seeded state again.
//
// Every statement is scoped to record_origin = 'user_demo'. Synthetic seed data and the reviewed
// public OSHA/NREL corpus are never touched. This is an operator CLI, never an HTTP route.
import { parseArgs } from 'node:util';
import { openDatabase } from '../db.js';

const ORIGIN = 'user_demo';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { 'dry-run': { type: 'boolean', default: false } },
    strict: true, allowPositionals: false,
  });
  const db = await openDatabase();
  let transactionOpen = false;
  try {
    const count = async (table: string): Promise<number> =>
      (await db.query(`select count(*)::int n from public.${table} where record_origin = $1`, [ORIGIN])).rows[0].n;
    const before = {
      resolutions: await count('resolutions'),
      documents: await count('documents'),
      documentChunks: await count('document_chunks'),
    };
    if (values['dry-run']) {
      console.log(JSON.stringify({ status: 'dry_run', wouldDelete: before, sqlExecuted: false }));
      return;
    }

    await db.query('begin');
    transactionOpen = true;
    // document_chunks references documents on (document_id, record_origin) with cascade, so the
    // user_demo chunks go with their document and no public_reference chunk can be reached.
    const documents = await db.query('delete from public.documents where record_origin = $1', [ORIGIN]);
    const resolutions = await db.query('delete from public.resolutions where record_origin = $1', [ORIGIN]);
    const remainingChunks = await count('document_chunks');
    if (remainingChunks !== 0) throw new Error('user_demo chunks survived the cascade; rolling back.');
    await db.query('commit');
    transactionOpen = false;

    console.log(JSON.stringify({
      status: 'reset',
      deleted: { resolutions: resolutions.rowCount, documents: documents.rowCount, documentChunks: before.documentChunks },
      preserved: 'synthetic_demo seed and public_reference corpus untouched',
    }));
  } finally {
    if (transactionOpen) await db.query('rollback').catch(() => undefined);
    await db.end();
  }
}

main().catch(() => {
  console.error('Demo reset failed; nothing was deleted. Check DATABASE_URL and the migrated database; credentials are not logged.');
  process.exitCode = 1;
});
