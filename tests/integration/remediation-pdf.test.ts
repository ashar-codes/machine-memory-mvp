import { describe, expect, it } from 'vitest';
import { extractPdfText } from '../../backend/src/routes.js';
import { chunkText } from '../../backend/src/knowledge.js';
import { checkUpload } from '../../backend/src/uploads.js';
import { pdfFixture } from './pdfFixture.js';

const passage = 'A user uploaded turbine inspection narrative for retrieval testing. It confers no procedure authority.';
describe('real installed PDF parser boundary', () => {
  it('extracts and chunks an actual text PDF', async () => {
    const text = await extractPdfText(pdfFixture(passage));
    expect(text).toContain(passage);
    expect(chunkText(text)).toHaveLength(1);
  });
  it('rejects a corrupt PDF with a sanitized message', async () => {
    await expect(extractPdfText(Buffer.from('%PDF-1.4\ncorrupt'))).rejects.toMatchObject({ code: 'PDF_UNREADABLE' });
  });
  it('rejects fake PDF bytes at upload validation', () => {
    expect(() => checkUpload({ originalname: 'fake.pdf', buffer: Buffer.from('not a PDF') }, 'document')).toThrow();
  });
  it('does not index page-number decorations for a textless/scanned PDF', async () => {
    await expect(extractPdfText(pdfFixture())).rejects.toMatchObject({ code: 'PDF_NO_TEXT' });
  });
});
