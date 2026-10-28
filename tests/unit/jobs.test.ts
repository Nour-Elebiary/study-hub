import { describe, expect, it } from "vitest";
import {
  createJobSchema,
  jobParamsSchema,
  MAX_JOB_ATTEMPTS,
  retryDelaySeconds,
} from "@/lib/jobs";

describe("job params schemas", () => {
  it("accepts OCR with English and Arabic", () => {
    const parsed = jobParamsSchema.safeParse({
      type: "ocr",
      languages: ["eng", "ara"],
    });
    expect(parsed.success).toBe(true);
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

describe("createJobSchema", () => {
  const base = {
    course_id: "cccccccc-0000-4ccc-8ccc-000000000001",
    runner: "browser" as const,
    input_asset_id: "a1a1a1a1-0000-4a1a-8a1a-000000000001",
  };

  it("accepts a valid browser OCR job", () => {
    const parsed = createJobSchema.safeParse({
      ...base,
      type: "ocr",
      params: { type: "ocr", languages: ["ara"] },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown runner or type", () => {
    expect(
      createJobSchema.safeParse({
        ...base,
        type: "teleport",
        params: { type: "ocr", languages: ["eng"] },
      }).success,
    ).toBe(false);
    expect(
      createJobSchema.safeParse({
        ...base,
        type: "ocr",
        runner: "fax",
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
