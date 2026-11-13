import { describe, expect, it } from "vitest";
import { getClientIp, settingMax } from "@/lib/rate-limit";

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

describe("settingMax (canvas rate limits read from settings, rule 8)", () => {
  it("accepts a JSON number from the settings row", () => {
    expect(settingMax("canvas_create", 200)).toBe(200);
    expect(settingMax("canvas_ops", 480)).toBe(480);
  });

  it("accepts a text value — settings rows are jsonb and may hold either", () => {
    expect(settingMax("canvas_create", "200")).toBe(200);
    expect(settingMax("canvas_ops", " 480 ")).toBe(480);
  });

  it("falls back to the spec default when the row is missing or unusable", () => {
    expect(settingMax("canvas_create", null)).toBeNull();
    expect(settingMax("canvas_create", undefined)).toBeNull();
    expect(settingMax("canvas_create", "")).toBeNull();
    expect(settingMax("canvas_create", "not-a-number")).toBeNull();
    expect(settingMax("canvas_ops", 0)).toBeNull(); // 0 would disable the limit
    expect(settingMax("canvas_ops", 7.5)).toBeNull();
  });

  it("clamps to the settings screen ranges", () => {
    expect(settingMax("canvas_create", 100_000)).toBe(500);
    expect(settingMax("canvas_ops", 100_000)).toBe(2000);
    expect(settingMax("login", 100_000)).toBe(100);
  });

  it("reads the login limit from settings (rule 8; raised in seed.sql)", () => {
    expect(settingMax("login", 5)).toBe(5);
    expect(settingMax("login", "100")).toBe(100);
    expect(settingMax("login", null)).toBeNull(); // keep the default 5
    expect(settingMax("login", 0)).toBeNull(); // 0 would disable the limit
  });
});
