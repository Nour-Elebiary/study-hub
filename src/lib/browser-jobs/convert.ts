/**
 * Word to Markdown in the leader's browser (spec section 7). mammoth reads
 * the .docx and produces HTML; turndown turns that HTML into Markdown. Both
 * are dynamically imported so the bundle stays small until a leader runs a
 * conversion.
 */
export async function convertWordToMarkdown(
  docx: ArrayBuffer,
): Promise<string> {
  const mammoth = await import("mammoth");
  const TurndownService = (await import("turndown")).default;

  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: docx });
  const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
  });
  return turndown.turndown(html).trim();
}

/**
 * Excel to CSV in the leader's browser (spec section 7). SheetJS reads the
 * workbook and the first sheet becomes CSV text — one result file per job,
 * so extra sheets are left out (docs/QUESTIONS.md #25). The 10 MB upload cap
 * keeps the sheet small enough that the browser handles it comfortably.
 */
export async function convertExcelToCsv(xlsx: ArrayBuffer): Promise<string> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(xlsx, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("This spreadsheet has no sheets to convert.");
  }
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) {
    throw new Error("This spreadsheet has no sheets to convert.");
  }
  return XLSX.utils.sheet_to_csv(sheet).trim();
}
