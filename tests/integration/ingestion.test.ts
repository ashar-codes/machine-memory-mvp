import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateManifest, validateEmbedding, documentIdentity } from '../../scripts/rag/manifest.js';
const load = (name: string) => JSON.parse(readFileSync(new URL(`../../data/knowledge/${name}`, import.meta.url), 'utf8'));
const fixture = load('synthetic-note.example.json');
const publicCorpus = [
  'osha-wind-lockout-tagout.json',
  'osha-1910-269-hazardous-energy.json',
  'nrel-tp-5000-80195-drivetrain-reliability.json',
];
describe('knowledge ingestion trust boundary', () => {
  it('accepts the synthetic fixture with reproducible source identity', () => {
    const doc = validateManifest(fixture);
    expect(doc.recordOrigin).toBe('synthetic_demo');
    expect(doc.assetType).toBe('wind_turbine');
    expect(documentIdentity(doc)).toEqual(documentIdentity(validateManifest(JSON.parse(JSON.stringify(fixture)))));
    expect(documentIdentity({...doc, title: 'Different document'}).id).not.toEqual(documentIdentity(doc).id);
  });
  it.each(['OEM','REGULATOR','RESEARCH'])('does not elevate demo notes to %s authority', (authorityClass) => {
    expect(() => validateManifest({...fixture,authorityClass})).toThrow();
    expect(() => validateManifest({...fixture,recordOrigin:'user_demo',authorityClass})).toThrow();
  });
  it('requires a source URL for public data and rejects unsafe URL schemes', () => {
    expect(() => validateManifest({...fixture,recordOrigin:'public_reference'})).toThrow();
    expect(() => validateManifest({...fixture,sourceUrl:'javascript:alert(1)'})).toThrow();
  });
  it('bounds chunk inputs and rejects unspecified authority properties', () => {
    expect(() => validateManifest({...fixture,chunks:[]})).toThrow();
    expect(() => validateManifest({...fixture,chunks:[{...fixture.chunks[0],content:'x'.repeat(8001)}]})).toThrow();
    expect(() => validateManifest({...fixture,approved:true})).toThrow();
  });
  it('rejects malformed or nonfinite embedding vectors', () => {
    expect(validateEmbedding(Array(1535).fill(0))).toBe(false);
    expect(validateEmbedding([...Array(1535).fill(0),Infinity])).toBe(false);
    expect(validateEmbedding(Array(1536).fill(0.01))).toBe(true);
  });

  it.each(publicCorpus)('accepts the reviewed public manifest %s', (name) => {
    const doc = validateManifest(load(name));
    expect(doc.recordOrigin).toBe('public_reference');
    expect(doc.sourceUrl?.startsWith('https://')).toBe(true);
    expect(['REGULATOR', 'RESEARCH']).toContain(doc.authorityClass);
    expect(doc.assetType).toBe('wind_turbine');
    expect(doc.chunks.length).toBeGreaterThan(0);
  });
  it.each(publicCorpus)('gives %s a stable content identity for idempotent reruns', (name) => {
    const doc = load(name);
    expect(documentIdentity(validateManifest(doc)).id)
      .toBe(documentIdentity(validateManifest(JSON.parse(JSON.stringify(doc)))).id);
  });
  it('keeps every reviewed public manifest distinct', () => {
    const ids = publicCorpus.map((name) => documentIdentity(validateManifest(load(name))).id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
