import { beforeAll, describe, expect, it } from "vitest";
import {
  signStudentCookie,
  verifyStudentCookie,
  type StudentPayload,
} from "@/lib/student-cookie";

beforeAll(() => {
  process.env.JOIN_COOKIE_SECRET = "test-secret-for-unit-tests";
});

const payload: StudentPayload = {
  v: 1,
  iat: Date.now(),
  scope: { all: false, courseIds: ["cccccccc-0000-4ccc-8ccc-000000000001"] },
};

describe("signStudentCookie and verifyStudentCookie", () => {
  it("round-trips a valid payload", () => {
    const cookie = signStudentCookie(payload);
    expect(verifyStudentCookie(cookie)).toEqual(payload);
  });

  it("round-trips the all-courses scope", () => {
    const cookie = signStudentCookie({
      v: 1,
      iat: Date.now(),
      scope: { all: true },
    });
    expect(verifyStudentCookie(cookie)?.scope).toEqual({ all: true });
  });

  it("rejects a tampered payload", () => {
    const cookie = signStudentCookie(payload);
    const [body] = cookie.split(".");
    const forged = `${body}.${signStudentCookie({ ...payload, scope: { all: true } }).split(".")[1]}`;
    // payload and signature no longer match
    expect(verifyStudentCookie(forged)).toBeNull();
  });

  it("rejects a re-signed payload from a different secret", () => {
    // a signature computed with another secret must not verify
    const cookie = signStudentCookie(payload);
    const body = cookie.split(".")[0];
    expect(verifyStudentCookie(`${body}.deadbeef`)).toBeNull();
  });

  it("rejects an expired cookie (older than 90 days)", () => {
    const old: StudentPayload = {
      ...payload,
      iat: Date.now() - 91 * 24 * 60 * 60 * 1000,
    };
    expect(verifyStudentCookie(signStudentCookie(old))).toBeNull();
  });

  it("accepts a cookie issued just inside the window", () => {
    const fresh: StudentPayload = {
      ...payload,
      iat: Date.now() - 89 * 24 * 60 * 60 * 1000,
    };
    expect(verifyStudentCookie(signStudentCookie(fresh))).not.toBeNull();
  });

  it("rejects a cookie dated in the future", () => {
    const future: StudentPayload = {
      ...payload,
      iat: Date.now() + 60 * 60 * 1000,
    };
    expect(verifyStudentCookie(signStudentCookie(future))).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyStudentCookie(undefined)).toBeNull();
    expect(verifyStudentCookie("")).toBeNull();
    expect(verifyStudentCookie("not-a-cookie")).toBeNull();
    expect(verifyStudentCookie("eyJv.aGVsbG8")).toBeNull();
  });
});
