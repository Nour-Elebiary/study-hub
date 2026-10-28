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
