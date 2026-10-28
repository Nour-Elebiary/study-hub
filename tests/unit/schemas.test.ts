import { describe, expect, it } from "vitest";
import { changePasswordSchema, signInSchema } from "@/lib/schemas";

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
