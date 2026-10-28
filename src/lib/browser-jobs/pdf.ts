/**
 * Merge and split PDFs in the leader's browser (spec section 7) with
 * pdf-lib. The source files are never changed: merge produces a new PDF,
 * and split copies the chosen pages into a new one.
 */

/**
 * Turns a page selection like "1-3,5" into 0-based page indices. Returns
 * null when the text is malformed, empty, or points past the last page —
 * the caller then fails the job with a clear message.
 */
export function parsePageSelection(
  spec: string,
  pageCount: number,
): number[] | null {
  const pages: number[] = [];
  for (const part of spec.split(",")) {
    const match = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!match) return null;
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (start < 1 || end < start || end > pageCount) return null;
    for (let p = start; p <= end; p++) pages.push(p - 1);
  }
  return pages.length > 0 ? pages : null;
}

/** Builds one new PDF from all the source PDFs, in the given order. */
export async function mergePdfs(sources: ArrayBuffer[]): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  for (const bytes of sources) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const copied = await out.copyPages(src, src.getPageIndices());
    for (const page of copied) out.addPage(page);
  }
  return out.save();
}

/**
 * Copies the selected pages of one PDF into a new PDF. Returns null when
 * the page selection does not match the document (the runner reports this
 * as a failed attempt).
 */
export async function splitPdf(
  source: ArrayBuffer,
  spec: string,
): Promise<Uint8Array | null> {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(source, { ignoreEncryption: true });
  const indices = parsePageSelection(spec, src.getPageCount());
  if (!indices) return null;
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  for (const page of copied) out.addPage(page);
  return out.save();
}
