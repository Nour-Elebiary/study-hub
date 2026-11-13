import { describe, expect, it } from "vitest";
import { registerUploadSchema, addLinkAssetSchema } from "@/lib/schemas";
import { createJobSchema, jobIdSchema } from "@/lib/jobs";
import { chatRequestSchema, taskRequestSchema } from "@/lib/ai/chat";

/**
 * The seed's readable ids (courses cccccc…, notes eeeeee…, profiles aaaa…)
 * are valid Postgres uuids but not RFC 9562 uuids: zod's z.uuid() also
 * checks the version and variant nibbles and rejected them — the canvas
 * upload returned "Invalid UUID" for every file dropped on a seeded
 * course's map (CI run 42819916170). Ids that can name seeded content
 * therefore validate with uuidLike; ids Postgres generates itself keep
 * the strict check ("Any 8-4-4-4-12 hex" convention, QUESTIONS #19/#49).
 */
const SEED_COURSE = "cccccccc-0000-cccc-0000-000000000001";
const SEED_NOTE = "eeeeeeee-0000-eeee-0000-000000000003";
const GENERATED_ASSET = "a1a1a1a1-0000-4a1a-8a1a-000000000001";

describe("id schemas accept the readable seed ids", () => {
  it("registerUploadSchema: the exact canvas upload the CI trace captured", () => {
    const parsed = registerUploadSchema.safeParse({
      course_id: SEED_COURSE,
      node_id: null, // canvas files attach to the course, not one note
      kind: "image",
      path_or_url: `${SEED_COURSE}/a5c9d3e8feb0402fadc018946bd629cc.png`,
      title: "m10-drop.png",
      mime: "image/png",
      size_bytes: 70,
    });
    expect(parsed.success).toBe(true);
  });

  it("registerUploadSchema: a seeded note id works for note-page uploads", () => {
    const parsed = registerUploadSchema.safeParse({
      course_id: SEED_COURSE,
      node_id: SEED_NOTE,
      kind: "document",
      path_or_url: `${SEED_COURSE}/double01d55f8c839661a2b9d629cc.pdf`,
      title: "handout.pdf",
      mime: "application/pdf",
      size_bytes: 2048,
    });
    expect(parsed.success).toBe(true);
  });

  it("registerUploadSchema: still rejects a nonsense id", () => {
    const parsed = registerUploadSchema.safeParse({
      course_id: "not-an-id",
      node_id: null,
      kind: "image",
      path_or_url: "x/y.png",
      title: "t.png",
      mime: "image/png",
      size_bytes: 70,
    });
    expect(parsed.success).toBe(false);
  });

  it("addLinkAssetSchema: seeded course and note ids pass", () => {
    const parsed = addLinkAssetSchema.safeParse({
      course_id: SEED_COURSE,
      node_id: SEED_NOTE,
      kind: "document",
      storage: "drive",
      url: "https://drive.google.com/file/d/1EXAMPLE/view",
      title: "Quiz 1 answer sheet (on Drive)",
    });
    expect(parsed.success).toBe(true);
  });

  it("createJobSchema: a browser job can run on a seeded course and asset", () => {
    const parsed = createJobSchema.safeParse({
      course_id: SEED_COURSE,
      type: "transcribe",
      input_asset_id: GENERATED_ASSET,
      params: { type: "transcribe", languages: ["eng"] },
    });
    expect(parsed.success).toBe(true);
  });

  it("chat schemas: questions about a seeded course and note pass", () => {
    expect(
      chatRequestSchema.safeParse({
        course_id: SEED_COURSE,
        message: "Summarise this note.",
        context: { note_id: SEED_NOTE },
      }).success,
    ).toBe(true);
    expect(
      taskRequestSchema.safeParse({ course_id: SEED_COURSE, prompt: "Quiz" })
        .success,
    ).toBe(true);
  });

  it("generated-only ids keep the strict RFC check", () => {
    // The seeded course id is NOT a generated value — a job id could never
    // carry it, and z.uuid() must still reject it there.
    expect(jobIdSchema.safeParse({ job_id: SEED_COURSE }).success).toBe(false);
    expect(jobIdSchema.safeParse({ job_id: GENERATED_ASSET }).success).toBe(
      true,
    );
  });
});
