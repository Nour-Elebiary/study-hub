import { beforeAll, describe, expect, it } from "vitest";
import {
  generateJoinCode,
  hashJoinCode,
  normalizeJoinCode,
} from "@/lib/join-code";

beforeAll(() => {
  process.env.JOIN_COOKIE_SECRET = "test-secret-for-unit-tests";
});

describe("generateJoinCode", () => {
  it("returns eight characters formatted XXXX-XXXX", () => {
    const code = generateJoinCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("avoids ambiguous characters (0/O, 1/l/I)", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateJoinCode()).not.toMatch(/[01OIilo]/);
    }
  });

  it("generates different codes", () => {
    const seen = new Set(Array.from({ length: 20 }, () => generateJoinCode()));
    expect(seen.size).toBeGreaterThan(15);
  });
});

describe("normalizeJoinCode", () => {
  it("accepts the code in any case, with or without the dash", () => {
    expect(normalizeJoinCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalizeJoinCode(" ABCD EFgh ")).toBe("ABCDEFGH");
    expect(normalizeJoinCode("abcd_efgh!")).toBe("ABCDEFGH");
  });
});

describe("hashJoinCode", () => {
  it("is deterministic for the same code in any spelling", () => {
    expect(hashJoinCode("ABCD-EFGH")).toBe(hashJoinCode("abcd efgh"));
  });

  it("differs for different codes", () => {
    expect(hashJoinCode("ABCD-EFGH")).not.toBe(hashJoinCode("ABCD-EFGJ"));
  });

  it("produces a hex HMAC-SHA256 digest", () => {
    expect(hashJoinCode("ABCD-EFGH")).toMatch(/^[0-9a-f]{64}$/);
  });
});
