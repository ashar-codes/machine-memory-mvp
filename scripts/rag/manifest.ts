import { createHash } from 'node:crypto';
import { z } from 'zod';

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

const label = z.string().trim().min(1).max(1000);
const httpsUrl = z.string().trim().url().max(4000).refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
}, 'Source URL must be HTTPS without credentials');

export const ingestionSchema = z.object({
  title: label,
  organization: label,
  sourceUrl: httpsUrl.nullable(),
  sourceType: z.enum(['TECHNICAL_REFERENCE', 'SAFETY_REFERENCE', 'TECHNICIAN_NOTE']),
  authorityClass: z.enum(['OEM', 'REGULATOR', 'RESEARCH', 'HISTORICAL', 'UNVERIFIED']),
  recordOrigin: z.enum(['public_data', 'public_reference', 'synthetic_demo', 'user_demo']),
  assetType: label,
  manufacturer: label.nullable(),
  model: label.nullable(),
  chunks: z.array(z.object({
    content: z.string().trim().min(1).max(8000),
    pageNumber: z.number().int().positive().nullable(),
    section: label.nullable(),
  }).strict()).min(1).max(200),
}).strict().superRefine((document, ctx) => {
  if (['public_data', 'public_reference'].includes(document.recordOrigin) && !document.sourceUrl) {
    ctx.addIssue({ code: 'custom', path: ['sourceUrl'], message: 'Public origins require a source URL' });
  }
  if (['synthetic_demo', 'user_demo'].includes(document.recordOrigin)
    && !['HISTORICAL', 'UNVERIFIED'].includes(document.authorityClass)) {
    ctx.addIssue({ code: 'custom', path: ['authorityClass'], message: 'Demo records cannot claim authoritative status' });
  }
});

export type IngestionDocument = z.infer<typeof ingestionSchema>;

/** Pure validation: does not load credentials, connect to DB or call OpenAI. */
export function validateManifest(input: unknown): IngestionDocument {
  return ingestionSchema.parse(input);
}

export function documentIdentity(document: IngestionDocument): { id: string; sha256: string } {
  // Schema parsing fixes key order and trims text before hashing.
  const normalized = validateManifest(document);
  const sha256 = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  const hex = sha256.slice(0, 32);
  return {
    id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    sha256,
  };
}

export function validateEmbedding(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === EMBEDDING_DIMENSIONS
    && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}
