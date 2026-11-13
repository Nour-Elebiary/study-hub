/**
 * Pure geometry helpers for the canvas editor (CANVAS-SPEC section 5.4).
 * Nothing here touches React Flow or the database; the components call these
 * and turn the results into ops.
 *
 * Helpers take small "box" shapes (id + position + size) so tests and the
 * editor can pass real CanvasCards or plain selection boxes alike.
 */
import { GRID_SIZE } from "./defaults";
import type { CanvasCard, Point } from "./types";

export type CardBox = Pick<CanvasCard, "id" | "x" | "y" | "width" | "height">;

export type Rect = CardBox & {
  left: number;
  top: number;
  right: number;
  bottom: number;
  cx: number;
  cy: number;
};

/** Rounds `value` to the snap grid (default 20). */
export function snap(value: number, grid: number = GRID_SIZE): number {
  if (grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

/** The full rectangle of a box, including centre point and edges. */
export function rectOf(box: Omit<CardBox, "id">): Rect {
  const left = box.x;
  const top = box.y;
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  return {
    id: "",
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    left,
    top,
    right,
    bottom,
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
  };
}

/** Cards belong to a group when their centre is inside the group rectangle. */
export function cardsInsideGroup(
  group: CardBox,
  cards: CanvasCard[],
): CanvasCard[] {
  const r = rectOf(group);
  return cards.filter(
    // Groups never belong to groups (no nesting, spec D4).
    (card) =>
      card.kind !== "group" &&
      card.x + card.width / 2 >= r.left &&
      card.x + card.width / 2 <= r.right &&
      card.y + card.height / 2 >= r.top &&
      card.y + card.height / 2 <= r.bottom,
  );
}

/** The smallest rectangle covering all boxes; null when boxes is empty. */
export function unionRect(boxes: Array<Omit<CardBox, "id">>): Rect | null {
  if (boxes.length === 0) return null;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    const r = rectOf(box);
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  return rectOf({ x: left, y: top, width: right - left, height: bottom - top });
}

export type CanvasEdgeSide = "top" | "right" | "bottom" | "left";

/** Which side midpoint of the box is nearest to `point`. */
export function nearestSide(
  box: Omit<CardBox, "id">,
  point: Point,
): CanvasEdgeSide {
  const r = rectOf(box);
  const mids: Array<{ side: CanvasEdgeSide; x: number; y: number }> = [
    { side: "top", x: (r.left + r.right) / 2, y: r.top },
    { side: "right", x: r.right, y: (r.top + r.bottom) / 2 },
    { side: "bottom", x: (r.left + r.right) / 2, y: r.bottom },
    { side: "left", x: r.left, y: (r.top + r.bottom) / 2 },
  ];
  let best = mids[0]!;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const mid of mids) {
    const d = (mid.x - point.x) ** 2 + (mid.y - point.y) ** 2;
    // Keep the first of equal distances: deterministic top/right/bottom/left.
    if (d < bestDist) {
      bestDist = d;
      best = mid;
    }
  }
  return best.side;
}

export const ALIGN_MODES = [
  "left",
  "right",
  "top",
  "bottom",
  "hcenter",
  "vcenter",
] as const;
export type AlignMode = (typeof ALIGN_MODES)[number];

/**
 * Aligns boxes inside their shared bounding rectangle and returns the new
 * positions keyed by id. Sizes never change; the caller turns the result
 * into node.update ops.
 */
export function alignCards(
  boxes: CardBox[],
  mode: AlignMode,
): Record<string, { x: number; y: number }> {
  const bounds = unionRect(boxes);
  const positions: Record<string, { x: number; y: number }> = {};
  if (!bounds) return positions;
  for (const box of boxes) {
    let x = box.x;
    let y = box.y;
    switch (mode) {
      case "left":
        x = bounds.left;
        break;
      case "right":
        x = bounds.right - box.width;
        break;
      case "top":
        y = bounds.top;
        break;
      case "bottom":
        y = bounds.bottom - box.height;
        break;
      case "hcenter":
        x = bounds.cx - box.width / 2;
        break;
      case "vcenter":
        y = bounds.cy - box.height / 2;
        break;
    }
    positions[box.id] = { x, y };
  }
  return positions;
}

export const DISTRIBUTE_AXES = ["x", "y"] as const;
export type DistributeAxis = (typeof DISTRIBUTE_AXES)[number];

/**
 * Spreads boxes evenly along one axis between the two extremes of the
 * selection. The first and last keep their positions; with fewer than three
 * boxes nothing changes (nothing can move).
 */
export function distributeCards(
  boxes: CardBox[],
  axis: DistributeAxis,
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  if (boxes.length < 3) return positions;
  const sorted = [...boxes].sort((a, b) => a[axis] - b[axis]);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const span = last[axis] - first[axis];
  for (const box of sorted) {
    const index = sorted.indexOf(box);
    const value =
      span === 0
        ? first[axis]
        : first[axis] + (span * index) / (sorted.length - 1);
    const other = axis === "x" ? box.y : box.x;
    positions[box.id] =
      axis === "x" ? { x: value, y: other } : { x: other, y: value };
  }
  return positions;
}

/**
 * "Tidy up" (spec 6.7): packs every card into rows that follow the reading
 * order (top rows first, then left to right), keeping roughly the map's
 * current width. Sizes never change; the caller turns the result into
 * node.update ops. Group frames are packed after the plain cards so the
 * rewrapped members are not covered mid-pack.
 */
export function tidyCards(
  boxes: CardBox[],
  maxWidth: number = 1200,
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  if (boxes.length === 0) return positions;
  const bounds = unionRect(boxes);
  const budget = Math.max(bounds ? bounds.width : 0, maxWidth);
  const gap = GRID_SIZE * 2;
  // Reading order: 100 px row bands top-down, then left-to-right (same
  // as the Tab walk in the editor). Groups go last.
  const isPlain = <T extends CardBox & { kind?: string }>(box: T): boolean =>
    !("kind" in box) || box.kind !== "group";
  const plain = boxes.filter(isPlain);
  const groups = boxes.filter((box) => !isPlain(box));
  const rowBand = GRID_SIZE * 5;
  const byReadingOrder = (list: CardBox[]): CardBox[] =>
    [...list].sort(
      (a, b) =>
        Math.round(a.y / rowBand) - Math.round(b.y / rowBand) ||
        a.x - b.x ||
        a.id.localeCompare(b.id),
    );
  const originX = bounds ? bounds.left : 0;
  const originY = bounds ? bounds.top : 0;
  let cursorX = originX;
  let cursorY = originY;
  let rowHeight = 0;
  const pack = (list: readonly CardBox[]) => {
    for (const box of list) {
      if (rowHeight > 0 && cursorX + box.width > originX + budget) {
        // Row is full — start on the next line.
        cursorX = originX;
        cursorY += rowHeight + gap;
        rowHeight = 0;
      }
      positions[box.id] = { x: cursorX, y: cursorY };
      cursorX += box.width + gap;
      rowHeight = Math.max(rowHeight, box.height);
    }
  };
  pack(byReadingOrder(plain));
  cursorX = originX;
  cursorY += rowHeight === 0 ? 0 : rowHeight + gap;
  rowHeight = 0;
  pack(byReadingOrder(groups));
  return positions;
}
