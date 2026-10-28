import { describe, expect, it } from "vitest";
import {
  addCommentSchema,
  assignNodeSchema,
  createNodeSchema,
  restoreVersionSchema,
  saveVersionSchema,
  searchSchema,
  setNodeStatusSchema,
  setNodeTagsSchema,
} from "@/lib/schemas";

// zod v4 validates UUID version nibbles, so fixtures must be real v4 shapes.
const COURSE = "cccccccc-0000-4ccc-8ccc-000000000001";
const NODE = "eeeeeeee-0000-4eee-8eee-000000000002";
const LEADER = "dddddddd-0000-4ddd-8ddd-000000000001";

describe("createNodeSchema", () => {
  it("accepts a section or note with a title", () => {
    const parsed = createNodeSchema.safeParse({
      course_id: COURSE,
      parent_id: null,
      area: "official_materials",
      kind: "note",
      title: "Lecture 1",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty title and unknown areas", () => {
    expect(
      createNodeSchema.safeParse({
        course_id: COURSE,
        parent_id: null,
        area: "official_materials",
        kind: "note",
        title: "   ",
      }).success,
    ).toBe(false);
    expect(
      createNodeSchema.safeParse({
        course_id: COURSE,
        parent_id: null,
        area: "not-an-area",
        kind: "note",
        title: "x",
      }).success,
    ).toBe(false);
  });

  it("rejects core kinds — only sections and notes are created here", () => {
    expect(
      createNodeSchema.safeParse({
        course_id: COURSE,
        parent_id: null,
        area: "glossary",
        kind: "core",
        title: "x",
      }).success,
    ).toBe(false);
  });
});

describe("saveVersionSchema", () => {
  it("accepts a save with an optional change note", () => {
    expect(
      saveVersionSchema.safeParse({ node_id: NODE, body_md: "# Hi" }).success,
    ).toBe(true);
    expect(
      saveVersionSchema.safeParse({
        node_id: NODE,
        body_md: "# Hi",
        change_note: "added example",
      }).success,
    ).toBe(true);
  });

  it("rejects huge bodies", () => {
    expect(
      saveVersionSchema.safeParse({
        node_id: NODE,
        body_md: "x".repeat(500_001),
      }).success,
    ).toBe(false);
  });
});

describe("setNodeStatusSchema", () => {
  it("requires a comment when sending back to draft (spec section 6)", () => {
    const sendBack = setNodeStatusSchema.safeParse({
      node_id: NODE,
      status: "draft",
    });
    expect(sendBack.success).toBe(false);

    const withComment = setNodeStatusSchema.safeParse({
      node_id: NODE,
      status: "draft",
      send_back_comment: "Add the second example.",
    });
    expect(withComment.success).toBe(true);
  });

  it("allows publish and send-for-review without a comment", () => {
    expect(
      setNodeStatusSchema.safeParse({ node_id: NODE, status: "published" })
        .success,
    ).toBe(true);
    expect(
      setNodeStatusSchema.safeParse({ node_id: NODE, status: "in_review" })
        .success,
    ).toBe(true);
  });

  it("rejects unknown statuses", () => {
    expect(
      setNodeStatusSchema.safeParse({ node_id: NODE, status: "archived" })
        .success,
    ).toBe(false);
  });
});

describe("assignNodeSchema", () => {
  it("accepts a leader and a date, or nobody", () => {
    expect(
      assignNodeSchema.safeParse({
        node_id: NODE,
        assigned_to: LEADER,
        due_date: "2026-11-01",
      }).success,
    ).toBe(true);
    expect(
      assignNodeSchema.safeParse({
        node_id: NODE,
        assigned_to: null,
        due_date: "",
      }).success,
    ).toBe(true);
  });

  it("rejects a malformed date", () => {
    expect(
      assignNodeSchema.safeParse({
        node_id: NODE,
        assigned_to: LEADER,
        due_date: "tomorrow",
      }).success,
    ).toBe(false);
  });
});

describe("setNodeTagsSchema", () => {
  it("accepts plain tags in English and Arabic", () => {
    expect(
      setNodeTagsSchema.safeParse({
        node_id: NODE,
        tags: ["quiz1", "البناء", "final_exam"],
      }).success,
    ).toBe(true);
  });

  it("rejects spaces and special characters in tags", () => {
    expect(
      setNodeTagsSchema.safeParse({
        node_id: NODE,
        tags: ["two words"],
      }).success,
    ).toBe(false);
  });

  it("caps the number of tags at 20", () => {
    expect(
      setNodeTagsSchema.safeParse({
        node_id: NODE,
        tags: Array.from({ length: 21 }, (_, i) => `t${i}`),
      }).success,
    ).toBe(false);
  });
});

describe("addCommentSchema", () => {
  it("accepts a comment with or without a parent", () => {
    expect(
      addCommentSchema.safeParse({
        node_id: NODE,
        parent_id: null,
        body: "Please add the second example.",
      }).success,
    ).toBe(true);
    expect(
      addCommentSchema.safeParse({
        node_id: NODE,
        parent_id: NODE,
        body: "reply",
      }).success,
    ).toBe(true);
  });

  it("rejects an empty comment", () => {
    expect(
      addCommentSchema.safeParse({ node_id: NODE, parent_id: null, body: "  " })
        .success,
    ).toBe(false);
  });
});

describe("restoreVersionSchema", () => {
  it("accepts a positive version number", () => {
    expect(
      restoreVersionSchema.safeParse({ node_id: NODE, version_no: 3 }).success,
    ).toBe(true);
  });

  it("rejects zero, negatives and fractions", () => {
    expect(
      restoreVersionSchema.safeParse({ node_id: NODE, version_no: 0 }).success,
    ).toBe(false);
    expect(
      restoreVersionSchema.safeParse({ node_id: NODE, version_no: 1.5 })
        .success,
    ).toBe(false);
  });
});

describe("searchSchema", () => {
  it("defaults the query to empty and accepts filters", () => {
    const parsed = searchSchema.parse({
      q: "photosynthesis",
      course_id: COURSE,
      area: "official_materials",
      status: "published",
      tag: "quiz1",
    });
    expect(parsed.q).toBe("photosynthesis");
    expect(parsed.course_id).toBe(COURSE);
  });

  it("accepts an empty search", () => {
    const parsed = searchSchema.parse({});
    expect(parsed.q).toBe("");
  });

  it("rejects an over-long query", () => {
    expect(searchSchema.safeParse({ q: "x".repeat(201) }).success).toBe(false);
  });
});
