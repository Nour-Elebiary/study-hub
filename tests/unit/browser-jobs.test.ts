import { describe, expect, it } from "vitest";
import { convertExcelToCsv } from "@/lib/browser-jobs/convert";
import {
  Dictation,
  dictationLocale,
  dictationSupported,
} from "@/lib/browser-jobs/dictation";
import { parsePageSelection } from "@/lib/browser-jobs/pdf";

describe("parsePageSelection", () => {
  it("turns '1-3,5' into zero-based indices", () => {
    expect(parsePageSelection("1-3,5", 10)).toEqual([0, 1, 2, 4]);
  });

  it("accepts a single page", () => {
    expect(parsePageSelection("7", 10)).toEqual([6]);
  });

  it("accepts a range that reaches the last page", () => {
    expect(parsePageSelection("9-10", 10)).toEqual([8, 9]);
  });

  it("rejects pages past the end of the document", () => {
    expect(parsePageSelection("1,11", 10)).toBeNull();
  });

  it("rejects malformed text", () => {
    expect(parsePageSelection("1;2", 10)).toBeNull();
    expect(parsePageSelection("3-1", 10)).toBeNull();
    expect(parsePageSelection("", 10)).toBeNull();
  });
});

describe("convertExcelToCsv", () => {
  /** Builds a real .xlsx in memory so the test exercises the actual reader. */
  async function makeWorkbook(
    sheets: { name: string; rows: (string | number)[][] }[],
  ): Promise<ArrayBuffer> {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    for (const s of sheets) {
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet(s.rows),
        s.name,
      );
    }
    const out = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    }) as Buffer;
    const bytes = new Uint8Array(out);
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
  }

  it("turns the first sheet into CSV text", async () => {
    const csv = await convertExcelToCsv(
      await makeWorkbook([
        {
          name: "Grades",
          rows: [
            ["Name", "Grade"],
            ["Lina", 95],
          ],
        },
      ]),
    );
    expect(csv).toBe("Name,Grade\nLina,95");
  });

  it("uses only the first sheet when a workbook has several", async () => {
    const csv = await convertExcelToCsv(
      await makeWorkbook([
        { name: "First", rows: [["a"]] },
        { name: "Second", rows: [["b"]] },
      ]),
    );
    expect(csv).toBe("a");
    expect(csv).not.toContain("b");
  });
});

describe("dictation", () => {
  it("maps the language picker codes to speech locales", () => {
    expect(dictationLocale("eng")).toBe("en-US");
    expect(dictationLocale("ara")).toBe("ar");
  });

  it("reports no support when the browser has no speech engine", () => {
    // jsdom has no SpeechRecognition, like Firefox.
    expect(dictationSupported()).toBe(false);
  });

  it("fails with a plain message when the engine is missing", () => {
    let error = "";
    const dictation = new Dictation();
    dictation.start("en-US", {
      onFinal: () => {},
      onInterim: () => {},
      onError: (message) => {
        error = message;
      },
      onEnd: () => {},
    });
    expect(error).toContain("does not support dictation");
    expect(dictation.active).toBe(false);
  });
});
