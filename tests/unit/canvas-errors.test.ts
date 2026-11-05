import { describe, expect, it } from "vitest";
import { mapDbError } from "@/lib/canvas/errors";

/**
 * The plain-language mapping (spec 5.5, applyCanvasOps row): raw constraint
 * messages must never reach a leader. Pure function — the card limit is
 * passed in, so each case is a string-in, string-out check.
 */
describe("mapDbError", () => {
  const LIMITS = { cardLimit: 300 };

  it("turns the card-cap message into a plain line that names the limit", () => {
    const result = mapDbError(
      'new row for relation "canvas_nodes" violates check constraint "canvas_nodes_card_limit": canvas card limit reached (300)',
      LIMITS,
    );
    expect(result.user).toContain("300");
    expect(result.user).not.toContain("constraint");
    expect(result.user).not.toContain("canvas_nodes");
  });

  it("uses the live setting value, not a hard-coded one", () => {
    const result = mapDbError("canvas card limit reached", { cardLimit: 42 });
    expect(result.user).toContain("42");
  });

  it("tells a leader the map vanished without database words", () => {
    for (const msg of ["canvas not found", "CANVAS NOT FOUND: dead row"]) {
      const result = mapDbError(msg, LIMITS);
      expect(result.user).toContain("no longer exists");
      expect(result.user).not.toContain("canvas not found");
    }
  });

  it("points cross-course content errors at the picker", () => {
    expect(mapDbError("note belongs to another course", LIMITS).user).toContain(
      "another course",
    );
    expect(mapDbError("file belongs to another course", LIMITS).user).toContain(
      "another course",
    );
  });

  it("explains that arrows connect only cards of the same canvas", () => {
    const result = mapDbError(
      "edge endpoints must be cards of the same canvas",
      LIMITS,
    );
    expect(result.user).toContain("same map");
  });

  it("explains a duplicate arrow without the constraint name", () => {
    const result = mapDbError(
      'duplicate key value violates unique constraint "canvas_edges_unique"',
      LIMITS,
    );
    expect(result.user).toContain("already");
    expect(result.user).not.toContain("unique constraint");
  });

  it("tells the leader a backup is gone", () => {
    expect(mapDbError("version not found", LIMITS).user).toContain(
      "no longer exists",
    );
    expect(mapDbError("snapshot not found", LIMITS).user).toContain(
      "no longer exists",
    );
  });

  it("falls back to a safe generic line for anything unknown", () => {
    const result = mapDbError(
      "connection reset by peer after pgbouncer restarted",
      LIMITS,
    );
    expect(result.user).toContain("Try again");
  });
});
