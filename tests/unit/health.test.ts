import { describe, expect, it } from "vitest";
import { usageVerdict } from "@/lib/health";

const MB = 1024 * 1024;

describe("usageVerdict", () => {
  it("is ok below 70%", () => {
    expect(usageVerdict(300 * MB, 500)).toEqual({ pct: 60, level: "ok" });
  });

  it("warns at 70% and up to 99%", () => {
    expect(usageVerdict(350 * MB, 500)).toEqual({ pct: 70, level: "warn" });
    expect(usageVerdict(495 * MB, 500)).toEqual({ pct: 99, level: "warn" });
  });

  it("is full at 100% and over", () => {
    expect(usageVerdict(500 * MB, 500)).toEqual({ pct: 100, level: "full" });
    expect(usageVerdict(600 * MB, 500)).toEqual({ pct: 120, level: "full" });
  });

  it("never divides by zero", () => {
    expect(usageVerdict(10, 0)).toEqual({ pct: 0, level: "ok" });
  });
});
