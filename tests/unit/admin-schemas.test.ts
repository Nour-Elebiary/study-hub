import { describe, expect, it } from "vitest";
import {
  courseCreateSchema,
  leaderCreateSchema,
  membershipSchema,
  settingsUpdateSchema,
} from "@/lib/schemas";

describe("leaderCreateSchema", () => {
  it("accepts a name and email", () => {
    const parsed = leaderCreateSchema.safeParse({
      display_name: "Sarah Ahmed",
      email: "sarah@example.com",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a one-character name", () => {
    const parsed = leaderCreateSchema.safeParse({
      display_name: "S",
      email: "sarah@example.com",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a malformed email", () => {
    const parsed = leaderCreateSchema.safeParse({
      display_name: "Sarah Ahmed",
      email: "not-an-email",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("courseCreateSchema", () => {
  it("uppercases the code", () => {
    const parsed = courseCreateSchema.safeParse({
      code: "math-101",
      title: "Mathematics",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.code).toBe("MATH-101");
  });

  it("rejects codes with forbidden characters", () => {
    const parsed = courseCreateSchema.safeParse({
      code: "MATH 101!",
      title: "Mathematics",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a one-character code", () => {
    const parsed = courseCreateSchema.safeParse({
      code: "M",
      title: "Mathematics",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("membershipSchema", () => {
  const base = {
    course_id: "ccccc0c0-0000-4ccc-8000-000000000001",
    user_id: "ddddd0dd-dddd-4ddd-8ddd-dddddddddd01",
    role: "editor" as const,
    areas: ["official_materials" as const],
  };

  it("accepts a membership with areas", () => {
    const parsed = membershipSchema.safeParse(base);
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty area list", () => {
    const parsed = membershipSchema.safeParse({ ...base, areas: [] });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown role", () => {
    const parsed = membershipSchema.safeParse({ ...base, role: "boss" });
    expect(parsed.success).toBe(false);
  });

  it("rejects an end date before the start date", () => {
    const parsed = membershipSchema.safeParse({
      ...base,
      valid_from: "2026-03-01",
      valid_until: "2026-02-01",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a valid date range", () => {
    const parsed = membershipSchema.safeParse({
      ...base,
      valid_from: "2026-02-01",
      valid_until: "2026-03-01",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("settingsUpdateSchema", () => {
  const base = {
    site_name: "Study Hub",
    max_file_mb: 10,
    retention_ai_days: 90,
    retention_audit_days: 365,
    retention_deleted_note_days: 30,
    ai_daily_allowance_per_leader: 0,
    db_limit_mb: 500,
    storage_limit_mb: 1024,
    max_canvas_cards: 20,
    max_canvases_per_course: 20,
    canvas_version_keep_auto: 30,
    canvas_import_max_kb: 1024,
    vault_export_max_mb: 200,
    realtime_enabled: 1,
    max_live_editors_per_canvas: 5,
    max_events_per_course: 200,
    retention_view_counts_days: 365,
  };

  it("accepts a save without the password (recent login path)", () => {
    // The client only sends the password after the 401 prompt; a save
    // without it must reach the recent-login check, not the schema
    // (QUESTIONS #52).
    const parsed = settingsUpdateSchema.safeParse(base);
    expect(parsed.success).toBe(true);
  });

  it("accepts a save with the password", () => {
    const parsed = settingsUpdateSchema.safeParse({
      ...base,
      password: "LEADER-PASS-2026",
    });
    expect(parsed.success).toBe(true);
  });
});
