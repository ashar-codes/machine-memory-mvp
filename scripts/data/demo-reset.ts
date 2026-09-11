// Development-only presentation reset. Removes the resolutions a presenter logged through the
// application, plus the semantic memory records those resolutions produced, so the demonstration
// starts from the seeded state again.
//
// By default it also removes simulated faults — from Scenario Lab or the SCADA simulator — because
// those are presentation residue too. `--include-imports` additionally removes everything loaded
// through the Data Hub, which is off by default: imported data is a user's own work.
//
// Every statement is scoped to the selected origins, which never include 'synthetic_demo',
// 'public_data' or 'public_reference': the seed and the reviewed public corpus are never touched.
// This is an operator CLI, never an HTTP route.
import { parseArgs } from 'node:util';
import { openDatabase } from '../db.js';

// Presentation residue: a logged resolution and a simulated fault are both things a presenter
// creates while rehearsing, so both are cleared by default. Data Hub imports are a user's own
// work and stay opt-in behind --include-imports.
const PRESENTATION_ORIGINS = ['user_demo', 'simulation'];
const IMPORT_ORIGINS = ['user_import'];

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
  const origins = values['include-imports'] ? [...PRESENTATION_ORIGINS, ...IMPORT_ORIGINS] : [...PRESENTATION_ORIGINS];
  const db = await openDatabase();
  let transactionOpen = false;
  try {
    const count = async (table: string): Promise<number> =>
      (await db.query(`select count(*)::int n from public.${table} where record_origin = any($1::text[])`, [origins])).rows[0].n;
    const before = {
      resolutions: await count('resolutions'),
      documents: await count('documents'),
      documentChunks: await count('document_chunks'),
      assetEvents: await count('asset_events'),
      maintenanceEvents: await count('maintenance_events'),
      workOrders: await count('work_orders'),
      technicianNotes: await count('technician_notes'),
      ...(values['include-imports'] ? { assets: await count('assets') } : {}),
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
    // History rows for the selected origins always go, so a simulated fault does not survive a
    // reset and reappear in the next demonstration's timeline and fleet counts.
    for (const table of ['asset_events', 'maintenance_events', 'work_orders', 'technician_notes', 'incidents']) {
      await db.query(`delete from public.${table} where record_origin = any($1::text[])`, [origins]);
    }
    if (values['include-imports']) {
      // Assets last: history referencing them has just been removed.
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
