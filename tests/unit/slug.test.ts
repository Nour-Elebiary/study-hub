import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/slug";

describe("slugify", () => {
  it("keeps Latin letters and digits", () => {
    expect(slugify("Lecture 1: Cells")).toBe("lecture-1-cells");
  });

  it("keeps Arabic letters readable (spec rule 4)", () => {
    expect(slugify("البناء الضوئي")).toBe("البناء-الضوئي");
  });

  it("collapses punctuation and spaces into single hyphens", () => {
    expect(slugify("  Quiz   #1 — chapter 2!!  ")).toBe("quiz-1-chapter-2");
  });

  it("falls back to 'note' when nothing survives", () => {
    expect(slugify("!!!")).toBe("note");
    expect(slugify("")).toBe("note");
  });

  it("caps the length at 80 characters", () => {
    const long = "a".repeat(200);
    expect(slugify(long)).toHaveLength(80);
  });
});
