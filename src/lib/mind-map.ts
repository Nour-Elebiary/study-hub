/**
 * Mind-map layout and export (spec section 6). The map is generated from the
 * `nodes` tree — nothing is drawn by hand. These functions are pure so they
 * are unit-tested and shared by the React Flow view and the SVG/PNG export.
 */

export type MapNode = {
  id: string;
  parentId: string | null;
  title: string;
  kind: "core" | "course_home" | "section" | "note";
  area: string;
  status: string;
  tags: string[];
};

export type PositionedNode = MapNode & {
  x: number;
  y: number;
  hasChildren: boolean;
};

const NODE_WIDTH = 176;
const NODE_HEIGHT = 44;
const H_GAP = 24;
const LEVEL_GAP = 96;

export const MAP_NODE_SIZE = { width: NODE_WIDTH, height: NODE_HEIGHT };

/** Children of collapsed branches are hidden (spec: collapse and expand). */
export function buildLayout(
  nodes: MapNode[],
  collapsed: ReadonlySet<string>,
): PositionedNode[] {
  const childrenOf = new Map<string, MapNode[]>();
  for (const node of nodes) {
    const key = node.parentId ?? "";
    const list = childrenOf.get(key) ?? [];
    list.push(node);
    childrenOf.set(key, list);
  }

  const visible = (node: MapNode): boolean => {
    let current = node.parentId;
    while (current !== null) {
      if (collapsed.has(current)) return false;
      const parent = nodes.find((n) => n.id === current);
      if (!parent) return false; // dangling parent — hide for safety
      current = parent.parentId;
    }
    return true;
  };

  const positioned: PositionedNode[] = [];
  let nextSlot = 0;

  const walk = (node: MapNode, depth: number): number => {
    const kids = (childrenOf.get(node.id) ?? []).filter(visible);
    const isCollapsed = collapsed.has(node.id);
    const children = isCollapsed ? [] : kids;

    let center: number;
    if (children.length === 0) {
      center = nextSlot * (NODE_WIDTH + H_GAP);
      nextSlot += 1;
    } else {
      const childCenters = children.map((child) => walk(child, depth + 1));
      center = (Math.min(...childCenters) + Math.max(...childCenters)) / 2;
    }

    positioned.push({
      ...node,
      x: center,
      y: depth * LEVEL_GAP,
      hasChildren: (childrenOf.get(node.id) ?? []).length > 0,
    });
    return center;
  };

  for (const root of childrenOf.get("") ?? []) walk(root, 0);
  return positioned;
}

/** Edges between visible nodes, in render order. */
export function buildEdges(
  nodes: MapNode[],
  collapsed: ReadonlySet<string>,
): { from: string; to: string }[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: { from: string; to: string }[] = [];
  for (const node of nodes) {
    if (node.parentId === null) continue;
    if (!byId.has(node.parentId)) continue;
    // Skip edges into collapsed branches — the children are hidden anyway.
    if (isHiddenByCollapse(node, collapsed, byId)) continue;
    edges.push({ from: node.parentId, to: node.id });
  }
  return edges;
}

function isHiddenByCollapse(
  node: MapNode,
  collapsed: ReadonlySet<string>,
  byId: Map<string, MapNode>,
): boolean {
  let current = node.parentId;
  while (current !== null) {
    if (collapsed.has(current)) return true;
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

/** Overall drawing size, for the export canvases. */
export function layoutBounds(positioned: PositionedNode[]): {
  width: number;
  height: number;
} {
  if (positioned.length === 0) {
    return { width: NODE_WIDTH, height: NODE_HEIGHT };
  }
  const maxX = Math.max(...positioned.map((n) => n.x));
  const maxY = Math.max(...positioned.map((n) => n.y));
  return {
    width: maxX + NODE_WIDTH + 40,
    height: maxY + NODE_HEIGHT + 40,
  };
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

const AREA_COLORS: Record<string, string> = {
  official_materials: "#dbeafe",
  student_notes: "#dcfce7",
  quiz_exam_prep: "#fef9c3",
  external_resources: "#f3e8ff",
  glossary: "#ffedd5",
  open_questions: "#fee2e2",
};

/**
 * Builds a standalone SVG of the map. Used for the SVG export and, through a
 * canvas, the PNG export — no extra drawing library needed.
 */
export function layoutToSvg(
  positioned: PositionedNode[],
  edges: { from: string; to: string }[],
  highlightedIds: ReadonlySet<string> = new Set(),
): string {
  const { width, height } = layoutBounds(positioned);
  const byId = new Map(positioned.map((n) => [n.id, n]));

  const edgeLines = edges
    .map((edge) => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) return "";
      const x1 = from.x + NODE_WIDTH / 2;
      const y1 = from.y + NODE_HEIGHT;
      const x2 = to.x + NODE_WIDTH / 2;
      const y2 = to.y;
      const mid = (y1 + y2) / 2;
      return `<path d="M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`;
    })
    .join("\n");

  const nodeRects = positioned
    .map((node) => {
      const fill = highlightedIds.has(node.id)
        ? "#fde047"
        : (AREA_COLORS[node.area] ?? "#e2e8f0");
      const stroke = highlightedIds.has(node.id) ? "#b45309" : "#64748b";
      const label = truncate(node.title || "Untitled", 26);
      const badge = node.kind === "section" ? "📁" : "📝";
      return `<g>
  <rect x="${node.x}" y="${node.y}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${highlightedIds.has(node.id) ? 2.5 : 1}"/>
  <text x="${node.x + 10}" y="${node.y + 27}" font-family="sans-serif" font-size="12" fill="#0f172a">${escapeXml(badge + " " + label)}</text>
</g>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="#ffffff"/>
${edgeLines}
${nodeRects}
</svg>`;
}
