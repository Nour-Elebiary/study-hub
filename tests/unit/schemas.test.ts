import { describe, expect, it } from "vitest";
import {
  changePasswordSchema,
  createCanvasSchema,
  signInSchema,
} from "@/lib/schemas";

describe("signInSchema", () => {
  it("accepts a valid email and 10+ character password (spec 11.1)", () => {
    const parsed = signInSchema.safeParse({
      email: "leader@example.com",
      password: "temporary-1🔑",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects passwords shorter than 10 characters", () => {
    const parsed = signInSchema.safeParse({
      email: "leader@example.com",
      password: "short1",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects malformed emails", () => {
    const parsed = signInSchema.safeParse({
      email: "no-an-email",
      password: "long-enough-password",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("changePasswordSchema", () => {
  it("accepts matching 10+ character passwords", () => {
    const parsed = changePasswordSchema.safeParse({
      password: "my-new-password",
      confirm: "my-new-password",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects mismatched passwords", () => {
    const parsed = changePasswordSchema.safeParse({
      password: "my-new-password",
      confirm: "my-new-passw0rd",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toContain("confirm");
    }
  });

  it("rejects a too-short new password", () => {
    const parsed = changePasswordSchema.safeParse({
      password: "tiny",
      confirm: "tiny",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("createCanvasSchema", () => {
  it("accepts a readable seed course id (QUESTIONS #19, #49)", () => {
    // Seed ids like cccccccc-… are valid PostgreSQL UUIDs but not RFC
    // UUIDs; the relaxed hex check must accept them like the canvas op
    // schemas already do.
    const parsed = createCanvasSchema.safeParse({
      course_id: "cccccccc-0000-cccc-0000-000000000001",
      title: "Revision week overview",
    });
    expect(parsed.success).toBe(true);
  });

  it("keeps the plain-language message when the course is missing", () => {
    const parsed = createCanvasSchema.safeParse({
      course_id: "not-a-course",
      title: "Revision week overview",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe("Pick a course first.");
    }
  });

  it("rejects an empty title", () => {
    const parsed = createCanvasSchema.safeParse({
      course_id: "cccccccc-0000-cccc-0000-000000000001",
      title: "   ",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe("Give the map a name.");
    }
  });
});
