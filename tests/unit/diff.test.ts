import { describe, expect, it } from "vitest";
import { diffLines } from "@/lib/diff";

describe("diffLines", () => {
  it("marks identical text as same", () => {
    const diff = diffLines("a\nb", "a\nb");
    expect(diff).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ]);
  });

  it("marks added lines", () => {
    const diff = diffLines("a", "a\nb");
    expect(diff).toEqual([
      { kind: "same", text: "a" },
      { kind: "added", text: "b" },
    ]);
  });

  it("marks removed lines", () => {
    const diff = diffLines("a\nb", "a");
    expect(diff).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
    ]);
  });

  it("keeps common lines in place around an edit", () => {
    const diff = diffLines("a\nb\nc", "a\nB\nc");
    expect(diff).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "same", text: "c" },
    ]);
  });

  it("handles empty inputs", () => {
    expect(diffLines("", "x")).toEqual([{ kind: "added", text: "x" }]);
    expect(diffLines("x", "")).toEqual([{ kind: "removed", text: "x" }]);
    expect(diffLines("", "")).toEqual([]);
  });

  it("is stable for Arabic text", () => {
    const diff = diffLines("السطر الأول", "السطر الأول\nالسطر الثاني");
    expect(diff).toEqual([
      { kind: "same", text: "السطر الأول" },
      { kind: "added", text: "السطر الثاني" },
    ]);
  });
});
