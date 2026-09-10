// Imports the verified Penmanshiel static turbine file as public_data.
//
// Scope is deliberately tiny and honest: this file contains turbine IDENTITY and SITE CONTEXT only
// (coordinates, rated power, hub height, rotor diameter, commissioning date). It contains no SCADA
// signals and no event history, so imported Penmanshiel turbines have no fault records. Recurrence,
// incidents and resolutions in this MVP come from the clearly labelled synthetic demo farm.
//
// The public site is a separate site row with its own asset codes (PEN-T01 ...). It is never merged
// with the fictional Demonstration Wind Farm. The real dataset has no WT03; the synthetic farm's
// WT-03 is fictional and unrelated.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openDatabase, rootPath } from '../db.js';
import {
  DOI, EXPECTED_MD5, LICENSE, PUBLISHER, RECORD_URL, SITE_ID, SOURCE_FILE, SOURCE_URL,
  parseStaticCsv,
} from './penmanshiel-csv.js';

async function main(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({ args, options: { 'dry-run': { type: 'boolean', default: false } }, strict: true, allowPositionals: false });
  const bytes = await readFile(resolve(rootPath, SOURCE_FILE));
  const md5 = createHash('md5').update(bytes).digest('hex');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (md5 !== EXPECTED_MD5) {
    throw new Error(`Checksum mismatch for ${SOURCE_FILE}. Re-download from ${RECORD_URL} before importing.`);
  }
  const turbines = parseStaticCsv(bytes.toString('utf8'));

  if (values['dry-run']) {
    console.log(JSON.stringify({ status: 'parsed_only', file: SOURCE_FILE, md5, sha256, turbines: turbines.length, assetCodes: turbines.map((row) => row.assetCode), sqlExecuted: false }, null, 2));
    return;
  }

  const db = await openDatabase();
  try {
    await db.query('begin');
    await db.query(
      `insert into public.sites (id, name, timezone, metadata, record_origin)
       values ($1, 'Penmanshiel Wind Farm', 'Europe/London', $2::jsonb, 'public_data')
       on conflict (id) do nothing`,
      [SITE_ID, JSON.stringify({
        publisher: PUBLISHER, license: LICENSE,
        doi: DOI, recordUrl: RECORD_URL, sourceUrl: SOURCE_URL,
        sourceFile: SOURCE_FILE, sourceMd5: md5, sourceSha256: sha256,
        scope: 'static turbine identity and siting only; no SCADA or event history imported',
        note: 'The published dataset contains no turbine WT03.',
      })]);
    let inserted = 0;
    for (const turbine of turbines) {
      const result = await db.query(
        `insert into public.assets (site_id, asset_code, asset_type, manufacturer, model, serial_number, status, metadata, record_origin)
         values ($1, $2, 'wind_turbine', $3, $4, $5, 'operational', $6::jsonb, 'public_data')
         on conflict (asset_code) do nothing
         returning id`,
        [SITE_ID, turbine.assetCode, turbine.manufacturer, turbine.model, turbine.identity,
          JSON.stringify({
            sourceTitle: turbine.title, ratedPowerKw: turbine.ratedPowerKw,
            hubHeightM: turbine.hubHeightM, rotorDiameterM: turbine.rotorDiameterM,
            latitude: turbine.latitude, longitude: turbine.longitude, elevationM: turbine.elevationM,
            country: turbine.country, commercialOperationsDate: turbine.commercialOperationsDate,
            license: LICENSE, attribution: `${PUBLISHER} via Zenodo record 16807304`,
            eventHistoryImported: false,
          })]);
      inserted += result.rowCount ?? 0;
    }
    await db.query('commit');
    console.log(JSON.stringify({ status: 'imported', parsed: turbines.length, inserted, alreadyPresent: turbines.length - inserted, eventsImported: 0 }));
    console.log('Static identity only. No public event history was imported and none was fabricated.');
  } catch (error) {
    await db.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

if (process.argv[1]?.includes('import-penmanshiel')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Penmanshiel import failed; credentials are not logged.');
    process.exitCode = 1;
  });
}
