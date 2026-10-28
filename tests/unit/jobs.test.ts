import { describe, expect, it } from "vitest";
import {
  createJobSchema,
  jobParamsSchema,
  jobResultNaming,
  MAX_JOB_ATTEMPTS,
  retryDelaySeconds,
  runnerForJob,
  workerClaimSchema,
  workerCompleteSchema,
} from "@/lib/jobs";

describe("job params schemas", () => {
  it("accepts OCR with English and Arabic", () => {
    const parsed = jobParamsSchema.safeParse({
      type: "ocr",
      languages: ["eng", "ara"],
    });
    expect(parsed.success).toBe(true);
  });

  it("defaults OCR to a photo source", () => {
    const parsed = jobParamsSchema.safeParse({
      type: "ocr",
      languages: ["eng"],
    });
    expect(parsed.success && parsed.data).toMatchObject({ source: "image" });
  });

  it("accepts scanned-PDF OCR and transcription languages", () => {
    expect(
      jobParamsSchema.safeParse({
        type: "ocr",
        languages: ["ara"],
        source: "pdf_scan",
      }).success,
    ).toBe(true);
    expect(
      jobParamsSchema.safeParse({
        type: "transcribe",
        languages: ["eng", "ara"],
      }).success,
    ).toBe(true);
  });

  it("rejects OCR with no language (the leader always chooses)", () => {
    const parsed = jobParamsSchema.safeParse({ type: "ocr", languages: [] });
    expect(parsed.success).toBe(false);
  });

  it("rejects OCR with an unknown language code", () => {
    const parsed = jobParamsSchema.safeParse({
      type: "ocr",
      languages: ["fr"],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a Word conversion targeting markdown", () => {
    const parsed = jobParamsSchema.safeParse({
      type: "convert",
      tool: "word_to_markdown",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts the worker convert tools", () => {
    for (const tool of ["office_to_pdf", "video_to_audio", "compress_video"]) {
      expect(jobParamsSchema.safeParse({ type: "convert", tool }).success).toBe(
        true,
      );
    }
  });

  it("accepts a merge with two assets and a split with pages", () => {
    expect(
      jobParamsSchema.safeParse({
        type: "convert",
        tool: "pdf_merge",
        asset_ids: [
          "cccccccc-0000-4ccc-8ccc-000000000001",
          "cccccccc-0000-4ccc-8ccc-000000000002",
        ],
      }).success,
    ).toBe(true);
    expect(
      jobParamsSchema.safeParse({
        type: "convert",
        tool: "pdf_split",
        pages: "1-3,5",
      }).success,
    ).toBe(true);
  });

  it("rejects malformed page ranges", () => {
    expect(
      jobParamsSchema.safeParse({
        type: "convert",
        tool: "pdf_split",
        pages: "1;2",
      }).success,
    ).toBe(false);
  });

  it("rejects a merge with fewer than two assets", () => {
    expect(
      jobParamsSchema.safeParse({
        type: "convert",
        tool: "pdf_merge",
        asset_ids: ["cccccccc-0000-4ccc-8ccc-000000000001"],
      }).success,
    ).toBe(false);
  });
});

describe("runnerForJob", () => {
  it("sends scanned PDFs to the worker and photos to the browser", () => {
    expect(
      runnerForJob("ocr", { type: "ocr", languages: ["eng"], source: "image" }),
    ).toBe("browser");
    expect(
      runnerForJob("ocr", {
        type: "ocr",
        languages: ["eng"],
        source: "pdf_scan",
      }),
    ).toBe("worker");
  });

  it("sends transcription to the worker", () => {
    expect(
      runnerForJob("transcribe", { type: "transcribe", languages: ["ara"] }),
    ).toBe("worker");
  });

  it("keeps light conversions in the browser", () => {
    expect(
      runnerForJob("convert", { type: "convert", tool: "word_to_markdown" }),
    ).toBe("browser");
    expect(
      runnerForJob("convert", {
        type: "convert",
        tool: "pdf_merge",
        asset_ids: [
          "cccccccc-0000-4ccc-8ccc-000000000001",
          "cccccccc-0000-4ccc-8ccc-000000000002",
        ],
      }),
    ).toBe("browser");
    expect(
      runnerForJob("convert", { type: "convert", tool: "pdf_split" }),
    ).toBe("browser");
  });

  it("sends heavy conversions to the worker", () => {
    expect(
      runnerForJob("convert", { type: "convert", tool: "office_to_pdf" }),
    ).toBe("worker");
    expect(
      runnerForJob("convert", { type: "convert", tool: "video_to_audio" }),
    ).toBe("worker");
    expect(
      runnerForJob("convert", { type: "convert", tool: "compress_video" }),
    ).toBe("worker");
  });
});

describe("jobResultNaming", () => {
  it("names a searchable PDF for scanned OCR", () => {
    const naming = jobResultNaming(
      "ocr",
      { type: "ocr", languages: ["eng"], source: "pdf_scan" },
      "Lecture scan",
    );
    expect(naming.binary).toBe(true);
    expect(naming.resultTitle).toBe("Lecture scan (searchable).pdf");
    expect(naming.title).toContain("Lecture scan");
  });

  it("names text results for image OCR", () => {
    const naming = jobResultNaming(
      "ocr",
      { type: "ocr", languages: ["eng"], source: "image" },
      "Board photo",
      "recognized text",
    );
    expect(naming.binary).toBe(false);
    expect(naming.resultTitle).toBe("Board photo (text).md");
    expect(naming.body).toContain("recognized text");
  });

  it("names each worker conversion result", () => {
    expect(
      jobResultNaming(
        "convert",
        { type: "convert", tool: "office_to_pdf" },
        "Ch1",
      ).resultTitle,
    ).toBe("Ch1 (copy).pdf");
    expect(
      jobResultNaming(
        "convert",
        { type: "convert", tool: "video_to_audio" },
        "Lab",
      ).resultTitle,
    ).toBe("Lab (audio).mp3");
    expect(
      jobResultNaming(
        "convert",
        { type: "convert", tool: "compress_video" },
        "Demo",
      ).resultTitle,
    ).toBe("Demo (small).mp4");
    expect(
      jobResultNaming(
        "convert",
        { type: "convert", tool: "pdf_merge", asset_ids: ["a", "b"] },
        "Set",
      ).resultTitle,
    ).toBe("Set (merged).pdf");
  });

  it("names transcription results", () => {
    const naming = jobResultNaming(
      "transcribe",
      { type: "transcribe", languages: ["eng"] },
      "Recording",
      "hello",
    );
    expect(naming.binary).toBe(false);
    expect(naming.resultTitle).toBe("Recording (text).md");
  });
});

describe("worker API schemas", () => {
  it("accepts a claim with a name", () => {
    expect(
      workerClaimSchema.safeParse({ worker_name: "home-pc" }).success,
    ).toBe(true);
    expect(workerClaimSchema.safeParse({ worker_name: "" }).success).toBe(
      false,
    );
  });

  it("accepts a success report with the result file", () => {
    expect(
      workerCompleteSchema.safeParse({
        job_id: "f6f6f6f5-1000-4f6f-8f6f-000000000001",
        ok: true,
        result_path: "cccc/abc.mp3",
        mime: "audio/mpeg",
        size_bytes: 123,
      }).success,
    ).toBe(true);
  });

  it("accepts a failure report with a reason", () => {
    expect(
      workerCompleteSchema.safeParse({
        job_id: "f6f6f6f5-1000-4f6f-8f6f-000000000001",
        ok: false,
        error: "ffmpeg is missing",
      }).success,
    ).toBe(true);
  });

  it("rejects a report without a job id", () => {
    expect(workerCompleteSchema.safeParse({ ok: true }).success).toBe(false);
  });
});

describe("createJobSchema", () => {
  const base = {
    course_id: "cccccccc-0000-4ccc-8ccc-000000000001",
    input_asset_id: "a1a1a1a1-0000-4a1a-8a1a-000000000001",
  };

  it("accepts a valid OCR job without a runner (the server derives it)", () => {
    const parsed = createJobSchema.safeParse({
      ...base,
      type: "ocr",
      params: { type: "ocr", languages: ["ara"] },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown type", () => {
    expect(
      createJobSchema.safeParse({
        ...base,
        type: "teleport",
        params: { type: "ocr", languages: ["eng"] },
      }).success,
    ).toBe(false);
  });
});

describe("retryDelaySeconds", () => {
  it("grows with each attempt (5s, 15s, 45s)", () => {
    expect(retryDelaySeconds(1)).toBe(5);
    expect(retryDelaySeconds(2)).toBe(15);
    expect(retryDelaySeconds(3)).toBe(45);
  });

  it("never goes below the first delay", () => {
    expect(retryDelaySeconds(0)).toBe(5);
  });

  it("allows at most three attempts", () => {
    expect(MAX_JOB_ATTEMPTS).toBe(3);
  });
});
