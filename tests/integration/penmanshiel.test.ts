import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXPECTED_MD5, parseStaticCsv } from '../../scripts/data/penmanshiel-csv.js';

const bytes = readFileSync(new URL('../../data/raw/Penmanshiel_WT_static.csv', import.meta.url));
const turbines = parseStaticCsv(bytes.toString('utf8'));

describe('Penmanshiel public data import', () => {
  it('matches the checksum published with the Zenodo record', () => {
    expect(createHash('md5').update(bytes).digest('hex')).toBe(EXPECTED_MD5);
  });

  it('parses every published turbine and no blank filler rows', () => {
    expect(turbines).toHaveLength(14);
    expect(turbines.every((row) => row.manufacturer === 'Senvion' && row.model === 'MM82')).toBe(true);
  });

  it('does not contain a turbine 03, which the published dataset omits', () => {
    expect(turbines.some((row) => row.assetCode === 'PEN-T03')).toBe(false);
  });

  it('namespaces public asset codes away from the fictional demo farm', () => {
    expect(turbines.every((row) => row.assetCode.startsWith('PEN-'))).toBe(true);
    expect(turbines.some((row) => row.assetCode === 'WT-03' || row.assetCode === 'WT-07')).toBe(false);
  });

  it('maps siting and rating fields without inventing values', () => {
    const first = turbines[0];
    expect(first.assetCode).toBe('PEN-T01');
    expect(first.identity).toBe('MM82/59 82765-01');
    expect(first.ratedPowerKw).toBe(2050);
    expect(first.hubHeightM).toBe(59);
    expect(first.rotorDiameterM).toBe(82);
    expect(first.latitude).toBe(55.902502);
    expect(first.commercialOperationsDate).toBe('2016-09-01');
  });

  it('rejects a file whose header has changed instead of guessing the columns', () => {
    expect(() => parseStaticCsv('Some,Other,Header\n1,2,3')).toThrow('Unexpected header');
  });

  it('refuses to import an empty dataset', () => {
    const header = bytes.toString('utf8').split(/\r?\n/)[0];
    expect(() => parseStaticCsv(`${header}\n,,,,,,,,,,,,,,`)).toThrow('refusing to import an empty public dataset');
  });
});
