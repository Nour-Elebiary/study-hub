import { describe, expect, it } from "vitest";
import { dagreLayout, LAYOUT_DEFAULTS } from "@/lib/canvas/layout";

describe("dagreLayout", () => {
  it("places the second rank to the right and returns top-left corners", () => {
    const boxes = [
      { id: "core", width: 360, height: 200 },
      { id: "g1", width: 400, height: 300 },
      { id: "g2", width: 400, height: 300 },
    ];
    const pairs = [
      { from: "core", to: "g1" },
      { from: "core", to: "g2" },
    ];
    const placed = dagreLayout(boxes, pairs);
    expect(placed.core!.x).toBeLessThan(placed.g1!.x);
    expect(placed.g1!.x).toBe(placed.g2!.x); // same rank
    // Two groups of the same size are separated by nodesep.
    expect(placed.g1!.y).toBe(placed.g2!.y + 300 + LAYOUT_DEFAULTS.nodesep);
    // Top-left = centre − half size.
    expect(placed.core!.x + 360 / 2).toBeGreaterThan(0);
  });

  it("is deterministic: two runs of the same graph give the same result", () => {
    const boxes = [
      { id: "a", width: 200, height: 100 },
      { id: "b", width: 200, height: 100 },
    ];
    const pairs = [{ from: "a", to: "b" }];
    expect(dagreLayout(boxes, pairs)).toEqual(dagreLayout(boxes, pairs));
  });

  it("ignores pairs whose endpoints are not in the box list", () => {
    const boxes = [{ id: "a", width: 100, height: 100 }];
    const placed = dagreLayout(boxes, [{ from: "a", to: "ghost" }]);
    expect(Object.keys(placed)).toEqual(["a"]);
    expect(placed.a!.x).toBe(0);
    expect(placed.a!.y).toBe(0);
  });

  it("places a single box at the origin", () => {
    const placed = dagreLayout([{ id: "solo", width: 100, height: 50 }], []);
    expect(placed.solo).toEqual({ x: 0, y: 0 });
  });
});
