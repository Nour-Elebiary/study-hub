import { describe, expect, it } from "vitest";
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
