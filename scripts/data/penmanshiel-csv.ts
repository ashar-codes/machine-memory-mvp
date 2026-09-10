// Pure parsing and provenance constants for the Penmanshiel static turbine file.
// No database, no credentials, no network: this module exists so the mapping can be tested.
export const SOURCE_FILE = 'data/raw/Penmanshiel_WT_static.csv';
export const SOURCE_URL = 'https://zenodo.org/records/16807304/files/Penmanshiel_WT_static.csv?download=1';
export const RECORD_URL = 'https://zenodo.org/records/16807304';
export const DOI = '10.5281/zenodo.16807304';
export const LICENSE = 'CC-BY-4.0';
export const PUBLISHER = 'Cubico Sustainable Investments Ltd';
/** Published by Zenodo alongside the file; verified before any row is inserted. */
export const EXPECTED_MD5 = 'c4cd4191234c1a67a391fe5d2978256b';
export const SITE_ID = '11000000-0000-4000-8000-000000000001';

export interface TurbineRow {
  assetCode: string; title: string; identity: string;
  manufacturer: string; model: string;
  ratedPowerKw: number; hubHeightM: number; rotorDiameterM: number;
  latitude: number; longitude: number; elevationM: number;
  country: string; commercialOperationsDate: string | null;
}

/** Converts the file's dd/mm/yyyy commissioning date to an ISO date, or null if absent. */
function isoDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/** Strict parse. Blank trailing rows in the published file are skipped, never invented. */
export function parseStaticCsv(content: string): TurbineRow[] {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  const header = lines.shift();
  if (!header?.startsWith('Wind Farm,Title,Alternative Title,Identity,Manufacturer,Model')) {
    throw new Error('Unexpected header; re-inspect the source file before importing.');
  }
  const rows: TurbineRow[] = [];
  for (const line of lines) {
    const cells = line.split(',');
    if (cells.length < 14 || !cells[1]?.trim() || !cells[2]?.trim()) continue;
    const number = (value: string) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new Error(`Non-numeric field in source row: ${line}`);
      return parsed;
    };
    rows.push({
      assetCode: `PEN-${cells[2].trim()}`,
      title: cells[1].trim(), identity: cells[3].trim(),
      manufacturer: cells[4].trim(), model: cells[5].trim(),
      ratedPowerKw: number(cells[6]), hubHeightM: number(cells[7]), rotorDiameterM: number(cells[8]),
      latitude: number(cells[9]), longitude: number(cells[10]), elevationM: number(cells[11]),
      country: cells[12].trim(), commercialOperationsDate: isoDate(cells[13]),
    });
  }
  if (!rows.length) throw new Error('No turbine rows parsed; refusing to import an empty public dataset.');
  return rows;
}
