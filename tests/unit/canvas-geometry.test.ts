import { describe, expect, it } from "vitest";
import {
  alignCards,
  cardsInsideGroup,
  distributeCards,
  nearestSide,
  rectOf,
  snap,
  tidyCards,
  unionRect,
} from "@/lib/canvas/geometry";
import type { CanvasCard } from "@/lib/canvas/types";

const box = (
  id: string,
  x: number,
  y: number,
  overrides: { width?: number; height?: number } = {},
) => ({ id, x, y, width: 100, height: 60, ...overrides });

const asCard = (b: {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}): CanvasCard => ({
  ...b,
  kind: "text",
  nodeId: null,
  assetId: null,
  url: null,
  z: 0,
  color: null,
  body: null,
  label: null,
  studentVisible: true,
});

describe("snap", () => {
  it("rounds to the grid; a zero grid disables snapping", () => {
    expect(snap(14, 20)).toBe(20);
    expect(snap(25, 20)).toBe(20);
    expect(snap(13, 20)).toBe(20); // 0.65 of a cell rounds up to the next cell
    expect(snap(9, 20)).toBe(0);
    expect(snap(-14, 20)).toBe(-20);
    expect(snap(0, 20)).toBe(0);
    expect(snap(7, 0)).toBe(7);
  });
});

describe("rectOf / unionRect", () => {
  it("computes the rectangle with centre and edges", () => {
    const r = rectOf(box("a", 10, 20));
    expect(r).toMatchObject({
      left: 10,
      top: 20,
      right: 110,
      bottom: 80,
      cx: 60,
      cy: 50,
    });
  });

  it("unions several boxes and returns null for an empty list", () => {
    const r = unionRect([
      box("a", 0, 0),
      box("b", 200, 100, { width: 100, height: 60 }),
    ]);
    expect(r).toMatchObject({ left: 0, top: 0, right: 300, bottom: 160 });
    expect(unionRect([])).toBeNull();
  });
});

describe("cardsInsideGroup", () => {
  it("keeps cards whose centre is inside the group rectangle; never a group", () => {
    const group = box("g", 0, 0, { width: 300, height: 300 });
    const inside = asCard(box("in", 50, 50)); // centre (100, 80)
    const outside = asCard(box("out", 400, 400)); // centre (450, 430)
    const nested = asCard(box("nested", 10, 10));
    nested.kind = "group";

    const kept = cardsInsideGroup(group, [inside, outside, nested]);
    expect(kept.map((c) => c.id)).toEqual(["in"]);
  });
});

describe("nearestSide", () => {
  it("returns the nearest side midpoint", () => {
    const b = box("", 0, 0);
    expect(nearestSide(b, { x: -10, y: 30 })).toBe("left");
    expect(nearestSide(b, { x: 50, y: -40 })).toBe("top");
    expect(nearestSide(b, { x: 200, y: 25 })).toBe("right");
    expect(nearestSide(b, { x: 50, y: 200 })).toBe("bottom");
  });
});

describe("alignCards", () => {
  const cards = [box("a", 0, 0), box("b", 200, 100, { width: 80, height: 40 })];
  // Shared bounds: left 0, top 0, right 280, bottom 160.

  it("left keeps a and moves b to the left edge", () => {
    expect(alignCards(cards, "left")).toEqual({
      a: { x: 0, y: 0 },
      b: { x: 0, y: 100 },
    });
  });

  it("bottom moves a down beside b's bottom edge; sizes never change", () => {
    // Shared bounds bottom = 140 (b's bottom); a lands at 140-60, b at 140-40.
    const next = alignCards(cards, "bottom");
    expect(next.a).toEqual({ x: 0, y: 80 });
    expect(next.b).toEqual({ x: 200, y: 100 });
  });

  it("hcenter centers both on the shared middle line", () => {
    const next = alignCards(cards, "hcenter"); // bounds cx = 140
    expect(next.a).toEqual({ x: 90, y: 0 });
    expect(next.b).toEqual({ x: 100, y: 100 });
  });

  it("returns nothing for an empty selection", () => {
    expect(alignCards([], "left")).toEqual({});
  });
});

describe("distributeCards", () => {
  it("spreads the middle boxes evenly; the extremes stay put", () => {
    const cards = [box("a", 0, 0), box("b", 220, 0), box("c", 200, 0)];
    const next = distributeCards(cards, "x");
    expect(next).toEqual({
      a: { x: 0, y: 0 },
      c: { x: 110, y: 0 },
      b: { x: 220, y: 0 },
    });
  });

  it("does nothing with fewer than three boxes", () => {
    expect(distributeCards([box("a", 0, 0), box("b", 200, 0)], "x")).toEqual(
      {},
    );
  });
});

describe("tidyCards", () => {
  it("packs scattered cards into rows and wraps past the width budget", () => {
    // Scattered: b on the top band, c under it, a lower and wide.
    const next = tidyCards(
      [
        box("a", 0, 400, { width: 300, height: 120 }),
        box("b", 200, 0),
        box("c", 0, 200),
      ],
      260,
    );
    // Reading order is b (band 0), c (band 2), a (band 4); the union is
    // 300 px wide, so b and c share row one and wide a wraps to row two.
    expect(next.b).toEqual({ x: 0, y: 0 });
    expect(next.c).toEqual({ x: 140, y: 0 }); // 100 + gap 40, same row
    expect(next.a).toEqual({ x: 0, y: 100 }); // row height 60 + gap 40
  });

  it("keeps sizes untouched and returns nothing for no cards", () => {
    const single = { id: "only", x: 500, y: 500, width: 300, height: 120 };
    const next = tidyCards([single]);
    expect(next.only).toEqual({ x: 500, y: 500 });
    expect(tidyCards([])).toEqual({});
  });

  it("orders rows by 100 px bands, not by name", () => {
    // Alphabetically a-before < m-mid < z-before, but band 0 must be packed
    // first, so z-before takes the leftmost slot of the single row.
    const next = tidyCards([
      box("z-before", 0, 0, { width: 100 }),
      box("a-before", 0, 50, { width: 100 }),
      box("m-mid", 0, 500, { width: 100 }),
    ]);
    expect(next["z-before"]).toEqual({ x: 0, y: 0 });
    expect(next["a-before"]).toEqual({ x: 140, y: 0 });
    expect(next["m-mid"]).toEqual({ x: 280, y: 0 });
  });
});
