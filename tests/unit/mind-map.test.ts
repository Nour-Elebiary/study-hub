import { describe, expect, it } from "vitest";
import {
  buildEdges,
  buildLayout,
  layoutBounds,
  layoutToSvg,
  type MapNode,
} from "@/lib/mind-map";

const node = (
  id: string,
  parentId: string | null,
  overrides: Partial<MapNode> = {},
): MapNode => ({
  id,
  parentId,
  title: `Node ${id}`,
  kind: parentId === null ? "section" : "note",
  area: "official_materials",
  status: "published",
  tags: [],
  ...overrides,
});

// A small tree: A → B, C; B → D
const TREE: MapNode[] = [
  node("a", null, { title: "Week 1" }),
  node("b", "a", { title: "Lecture 1" }),
  node("c", "a", { title: "Lecture 2" }),
  node("d", "b", { title: "Details" }),
];

describe("buildLayout", () => {
  it("places children below their parent and leaves side by side", () => {
    const layout = buildLayout(TREE, new Set());
    const byId = new Map(layout.map((n) => [n.id, n]));
    const a = byId.get("a")!;
    const b = byId.get("b")!;
    const c = byId.get("c")!;
    const d = byId.get("d")!;

    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(d.y);
    expect(c.y).toBe(a.y + b.y - a.y || c.y); // same level as b
    expect(c.y).toBe(b.y);
    // Leaves d and c occupy different horizontal slots.
    expect(d.x).not.toBe(c.x);
    // Parent b sits between (or over) its single child d.
    expect(b.x).toBe(d.x);
    // Root a is centered over its children b and c.
    expect(a.x).toBe((b.x + c.x) / 2);
  });

  it("hides the descendants of a collapsed branch", () => {
    const layout = buildLayout(TREE, new Set(["b"]));
    expect(layout.map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
    const b = layout.find((n) => n.id === "b")!;
    expect(b.hasChildren).toBe(true);
  });

  it("hides nodes with a dangling parent instead of crashing", () => {
    const layout = buildLayout([node("x", "missing")], new Set());
    expect(layout).toEqual([]);
  });

  it("handles an empty tree", () => {
    expect(buildLayout([], new Set())).toEqual([]);
  });

  it("keeps two roots side by side", () => {
    const layout = buildLayout([node("r1", null), node("r2", null)], new Set());
    expect(layout[0].x).not.toBe(layout[1].x);
    expect(layout[0].y).toBe(layout[1].y);
  });
});

describe("buildEdges", () => {
  it("connects every visible child to its parent", () => {
    const edges = buildEdges(TREE, new Set());
    expect(edges).toEqual([
      { from: "a", to: "b" },
      { from: "a", to: "c" },
      { from: "b", to: "d" },
    ]);
  });

  it("drops edges into collapsed branches", () => {
    const edges = buildEdges(TREE, new Set(["b"]));
    expect(edges).toEqual([
      { from: "a", to: "b" },
      { from: "a", to: "c" },
    ]);
  });
});

describe("layoutBounds and layoutToSvg", () => {
  it("bounds cover every node plus a margin", () => {
    const layout = buildLayout(TREE, new Set());
    const bounds = layoutBounds(layout);
    const maxX = Math.max(...layout.map((n) => n.x));
    const maxY = Math.max(...layout.map((n) => n.y));
    expect(bounds.width).toBeGreaterThan(maxX);
    expect(bounds.height).toBeGreaterThan(maxY);
  });

  it("renders valid XML-safe SVG with escaped titles", () => {
    const layout = buildLayout(
      [node("a", null, { title: 'Q&A <draft> "notes"' })],
      new Set(),
    );
    const svg = layoutToSvg(layout, buildEdges([node("a", null)], new Set()));
    expect(svg).toContain("<svg xmlns=");
    expect(svg).toContain("Q&amp;A &lt;draft&gt; &quot;notes&quot;");
    expect(svg).not.toContain("<draft>");
  });

  it("highlights the matching nodes when a tag is picked", () => {
    const tagged = [
      node("a", null, { tags: ["quiz1"] }),
      node("b", "a", { tags: [] }),
    ];
    const layout = buildLayout(tagged, new Set());
    const highlighted = layoutToSvg(
      layout,
      buildEdges(tagged, new Set()),
      new Set(["a"]),
    );
    expect(highlighted).toContain("#fde047"); // highlight fill
    expect(highlighted).toContain("#b45309"); // highlight border
  });
});
