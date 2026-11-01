/**
 * Shared dagre layout for generated canvases (CANVAS-SPEC section 5.4). The
 * module list names `layout.ts` as the dagre-driven helper every generation
 * path shares; it returns top-left coordinates (dagre itself speaks centres).
 *
 * Deterministic: dagre is deterministic for the same graph input, and no
 * Math.random or Date is used here.
 */
import { Graph, layout } from "@dagrejs/dagre";

export type LayoutBox = { id: string; width: number; height: number };
export type LayoutPair = { from: string; to: string };

export const LAYOUT_DEFAULTS = {
  rankdir: "LR",
  nodesep: 80,
  ranksep: 160,
} as const;

export type LayoutOptions = {
  rankdir?: "LR" | "TB" | "RL" | "BT";
  nodesep?: number;
  ranksep?: number;
};

/**
 * Places every box with dagre and returns the top-left corner of each, keyed
 * by id. Boxes not referenced by any edge still get placed (dagre keeps
 * singletons in one rank); ids missing from `nodes` on either end of a pair
 * are ignored (generators never produce dangling pairs, but the helper stays
 * forgiving so a stale caller cannot break a whole canvas).
 */
export function dagreLayout(
  boxes: readonly LayoutBox[],
  pairs: readonly LayoutPair[],
  options: LayoutOptions = {},
): Record<string, { x: number; y: number }> {
  const graph = new Graph();
  graph.setGraph({ ...LAYOUT_DEFAULTS, ...options });
  graph.setDefaultEdgeLabel(() => ({}));

  const byId = new Map<string, LayoutBox>();
  for (const box of boxes) {
    byId.set(box.id, box);
    graph.setNode(box.id, { width: box.width, height: box.height });
  }
  for (const pair of pairs) {
    if (byId.has(pair.from) && byId.has(pair.to)) graph.setEdge(pair.from, pair.to);
  }

  layout(graph);

  const positions: Record<string, { x: number; y: number }> = {};
  for (const box of boxes) {
    const placed = graph.node(box.id);
    // dagre returns the centre; convert to the top-left corner the canvas
    // state uses for card positions.
    positions[box.id] = {
      x: placed.x - box.width / 2,
      y: placed.y - box.height / 2,
    };
  }
  return positions;
}
