import type { OcrLanguage } from "@/lib/jobs";

/**
 * Image OCR in the leader's browser (spec section 7). Tesseract.js is
 * dynamically imported so its bundle (and the language data it downloads
 * from its own CDN on first use) never loads until a leader actually starts
 * an OCR job. The leader always picks the languages; nothing is auto-detected
 * (spec section 7 rule 4).
 */
export async function runOcr(
  image: Blob,
  languages: OcrLanguage[],
  onProgress?: (percent: number) => void,
): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(languages.join("+"), 1, {
    logger: (m) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });
  try {
    const { data } = await worker.recognize(image);
    return data.text.trim();
  } finally {
    await worker.terminate();
  }
}
