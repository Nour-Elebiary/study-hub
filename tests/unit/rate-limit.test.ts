import { describe, expect, it } from "vitest";
import { getClientIp } from "@/lib/rate-limit";

const headers = (entries: Record<string, string>) =>
  new Headers(Object.entries(entries));

describe("getClientIp", () => {
  it("reads the first address from x-forwarded-for", () => {
    expect(
      getClientIp(
        headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.25, 10.0.0.1" }),
      ),
    ).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    expect(getClientIp(headers({ "x-real-ip": "198.51.100.9" }))).toBe(
      "198.51.100.9",
    );
  });

  it("trims whitespace", () => {
    expect(getClientIp(headers({ "x-forwarded-for": " 203.0.113.7 " }))).toBe(
      "203.0.113.7",
    );
  });

  it("returns 'unknown' when no proxy headers exist (local dev)", () => {
    expect(getClientIp(headers({}))).toBe("unknown");
  });
});
