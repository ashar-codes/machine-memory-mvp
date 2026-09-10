// Upload handling.
//
// Files are held in memory and never written to disk, so there is no temporary file to clean up,
// no user-influenced path, and nothing for a shell to execute. Nothing here trusts the supplied
// filename, MIME type or extension on its own.
import { createHash } from 'node:crypto';
import multer from 'multer';

export const MAX_TABULAR_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

export type UploadKind = 'tabular' | 'document';

export class UploadError extends Error {}

const TABULAR_EXTENSIONS = ['.csv', '.tsv', '.txt'];
const DOCUMENT_EXTENSIONS = ['.txt', '.md', '.pdf'];
/** Formats a user may reasonably try that this MVP deliberately does not pretend to support. */
export const UNSUPPORTED_EXTENSIONS = ['.xlsx', '.xls', '.xlsm', '.ods', '.doc', '.docx'];

/**
 * Reduces any supplied filename to a display-safe basename. Directory separators, traversal
 * segments, null bytes and control characters are removed rather than escaped, and the result is
 * used only for display and provenance — never to build a path, because nothing is written to disk.
 */
export function safeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    // eslint-disable-next-line no-control-regex -- removing control characters is the intent
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .trim()
    .slice(0, 200);
  return cleaned || 'upload';
}

export function extensionOf(filename: string): string {
  const match = /\.[A-Za-z0-9]+$/.exec(safeFilename(filename));
  return match ? match[0].toLowerCase() : '';
}

/** Detects a real PDF by its magic bytes, not by what the upload claimed to be. */
export function looksLikePdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}

/** Rejects binary content offered as text: a NUL byte in the first block is decisive. */
export function looksLikeText(bytes: Buffer): boolean {
  return !bytes.subarray(0, 8192).includes(0);
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface CheckedUpload { filename: string; extension: string; bytes: Buffer; sha256: string }

/**
 * Validates an upload against the kind of ingestion requested. Extension, magic bytes and byte
 * length are all checked; a mismatch is refused with a message that describes the rule, never the
 * file's contents.
 */
export function checkUpload(file: { originalname: string; buffer: Buffer } | undefined, kind: UploadKind): CheckedUpload {
  if (!file?.buffer?.length) throw new UploadError('No file was uploaded, or the file is empty.');
  const filename = safeFilename(file.originalname);
  const extension = extensionOf(filename);
  const limit = kind === 'tabular' ? MAX_TABULAR_BYTES : MAX_DOCUMENT_BYTES;
  if (file.buffer.length > limit) {
    throw new UploadError(`File exceeds the ${Math.round(limit / (1024 * 1024))} MB limit for this upload type.`);
  }
  if (UNSUPPORTED_EXTENSIONS.includes(extension)) {
    throw new UploadError('Spreadsheet and word-processor formats are not supported in this MVP. Export the sheet as CSV and upload that instead.');
  }
  const allowed = kind === 'tabular' ? TABULAR_EXTENSIONS : DOCUMENT_EXTENSIONS;
  if (!allowed.includes(extension)) {
    throw new UploadError(`Unsupported file type for this upload. Allowed: ${allowed.join(', ')}.`);
  }
  if (extension === '.pdf') {
    if (!looksLikePdf(file.buffer)) throw new UploadError('The file does not look like a PDF despite its name.');
  } else if (!looksLikeText(file.buffer)) {
    throw new UploadError('The file does not look like text despite its name.');
  }
  return { filename, extension, bytes: file.buffer, sha256: sha256(file.buffer) };
}

/** Decodes text strictly, so a mislabelled binary fails here instead of storing replacement junk. */
export function decodeText(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new UploadError('The file is not valid UTF-8 text. Re-save it as UTF-8 and upload again.');
  }
}

/** Memory storage only: no disk, no temporary path, one file per request. */
export const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 12, fieldSize: 8192 },
});
