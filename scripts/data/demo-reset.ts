// Development-only presentation reset. Removes the resolutions a presenter logged through the
// application, plus the semantic memory records those resolutions produced, so the demonstration
// starts from the seeded state again.
//
// `--include-imports` additionally removes everything loaded through the Data Hub and every fault
// injected in Scenario Lab, which is what you want before re-running the dynamic demonstration.
// It is off by default: imported data is a user's own work, not presentation residue.
//
// Every statement is scoped to the selected origins, which never include 'synthetic_demo',
// 'public_data' or 'public_reference': the seed and the reviewed public corpus are never touched.
// This is an operator CLI, never an HTTP route.
import { parseArgs } from 'node:util';
import { openDatabase } from '../db.js';

const ORIGIN = 'user_demo';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      // Off by default and deliberately explicit: imported data is a user's own work, not
      // presentation residue, so it is never swept away as a side effect of resetting the demo.
      'include-imports': { type: 'boolean', default: false },
    },
    strict: true, allowPositionals: false,
  });
  const origins = values['include-imports'] ? [ORIGIN, 'user_import', 'simulation'] : [ORIGIN];
  const db = await openDatabase();
  let transactionOpen = false;
  try {
    const count = async (table: string): Promise<number> =>
      (await db.query(`select count(*)::int n from public.${table} where record_origin = any($1::text[])`, [origins])).rows[0].n;
    const before = {
      resolutions: await count('resolutions'),
      documents: await count('documents'),
      documentChunks: await count('document_chunks'),
      ...(values['include-imports'] ? {
        assetEvents: await count('asset_events'),
        maintenanceEvents: await count('maintenance_events'),
        workOrders: await count('work_orders'),
        technicianNotes: await count('technician_notes'),
        assets: await count('assets'),
      } : {}),
    };
    if (values['dry-run']) {
      console.log(JSON.stringify({ status: 'dry_run', origins, wouldDelete: before, sqlExecuted: false }));
      return;
    }

    await db.query('begin');
    transactionOpen = true;
    // document_chunks references documents on (document_id, record_origin) with cascade, so the
    // user_demo chunks go with their document and no public_reference chunk can be reached.
    const documents = await db.query('delete from public.documents where record_origin = any($1::text[])', [origins]);
    const resolutions = await db.query('delete from public.resolutions where record_origin = any($1::text[])', [origins]);
    if (values['include-imports']) {
      // Child rows first: an asset cannot be removed while its history still references it.
      for (const table of ['asset_events', 'maintenance_events', 'work_orders', 'technician_notes', 'incidents']) {
        await db.query(`delete from public.${table} where record_origin = any($1::text[])`, [origins]);
      }
      await db.query('delete from public.import_batches', []);
      await db.query(`delete from public.data_sources where record_origin = any($1::text[])`, [origins]);
      await db.query(`delete from public.assets where record_origin = any($1::text[])`, [origins]);
      await db.query(`delete from public.sites s where s.record_origin = any($1::text[])
        and not exists (select 1 from public.assets a where a.site_id = s.id)`, [origins]);
    }
    const remainingChunks = await count('document_chunks');
    if (remainingChunks !== 0) throw new Error('Chunks survived the cascade; rolling back.');
    await db.query('commit');
    transactionOpen = false;

    console.log(JSON.stringify({
      status: 'reset',
      deleted: { resolutions: resolutions.rowCount, documents: documents.rowCount, documentChunks: before.documentChunks },
      origins,
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
