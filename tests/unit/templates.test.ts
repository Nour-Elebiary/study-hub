import { describe, expect, it } from "vitest";
import { getTemplate, noteTemplates } from "@/lib/templates";

describe("note templates (spec section 6)", () => {
  it("offers the five required templates", () => {
    expect(noteTemplates.map((t) => t.id)).toEqual([
      "lecture_note",
      "summary",
      "quiz_prep",
      "glossary",
      "open_questions",
    ]);
  });

  it("uses {title} as the only placeholder — front matter is form fields", () => {
    for (const template of noteTemplates) {
      const placeholders = template.bodyMd.match(/\{[a-z_]+\}/g) ?? [];
      for (const p of placeholders) {
        expect(p).toBe("{title}");
      }
    }
  });

  it("quiz prep contains question and answer blocks", () => {
    const quiz = getTemplate("quiz_prep");
    expect(quiz?.bodyMd).toContain("**Question:**");
    expect(quiz?.bodyMd).toContain("**Answer:**");
  });

  it("every template suggests at least one area", () => {
    for (const template of noteTemplates) {
      expect(template.suggestedAreas.length).toBeGreaterThan(0);
    }
  });

  it("returns undefined for an unknown id", () => {
    expect(getTemplate("nope")).toBeUndefined();
  });
});
