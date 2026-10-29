import { describe, expect, it } from "vitest";
import { noteFileName, noteFrontmatter, pickNoteBody } from "@/lib/export";

const nodeId = "12345678-9abc-def0-1234-567890abcdef";

describe("pickNoteBody", () => {
  const versions = [
    { id: "v1", node_id: nodeId, version_no: 1, body_md: "version one" },
    { id: "v2", node_id: nodeId, version_no: 2, body_md: "version two" },
  ];

  it("prefers the published version", () => {
    const result = pickNoteBody(
      { draft_body_md: "draft", published_version_id: "v1" },
      versions,
    );
    expect(result).toEqual({ body: "version one", source: "published" });
  });

  it("falls back to the newest version", () => {
    const result = pickNoteBody(
      { draft_body_md: "draft", published_version_id: null },
      versions,
    );
    expect(result).toEqual({ body: "version two", source: "version" });
  });

  it("falls back to the draft when there are no versions", () => {
    const result = pickNoteBody(
      { draft_body_md: "draft", published_version_id: null },
      [],
    );
    expect(result).toEqual({ body: "draft", source: "draft" });
  });

  it("falls back to the newest version when the published one is gone", () => {
    const result = pickNoteBody(
      { draft_body_md: "draft", published_version_id: "missing" },
      versions,
    );
    expect(result).toEqual({ body: "version two", source: "version" });
  });
});

describe("noteFrontmatter", () => {
  it("renders YAML frontmatter Obsidian can read", () => {
    const text = noteFrontmatter({
      title: 'A note "with quotes"',
      course: "CS101 — Introduction",
      area: "student_notes",
      kind: "note",
      status: "published",
      source: "published",
      updatedAt: "2026-10-29T00:00:00.000Z",
    });
    expect(text).toMatch(/^---\n/);
    expect(text).toContain('title: "A note \\"with quotes\\""');
    expect(text).toContain("area: student_notes");
    expect(text).toMatch(/---\n$/);
  });

  it("marks a missing update time as unknown", () => {
    const text = noteFrontmatter({
      title: "t",
      course: "c",
      area: "a",
      kind: "note",
      status: "draft",
      source: "draft",
      updatedAt: null,
    });
    expect(text).toContain("updated: unknown");
  });
});

describe("noteFileName", () => {
  it("uses the slug plus a short id so names never collide", () => {
    expect(noteFileName("Photosynthesis basics", nodeId)).toBe(
      "photosynthesis-basics-12345678.md",
    );
  });

  it("falls back to note when the title is empty", () => {
    expect(noteFileName("", nodeId)).toBe("note-12345678.md");
  });
});
