/**
 * "Generate a map from the course" (CANVAS-SPEC section 5.8). Pure: it takes
 * the course tree (sorted by the caller into stored order), a hard card-cap
 * number from `settings`, and an injected id generator, and returns one op
 * list per canvas to create. Determinism is contractual: the same tree and
 * the same id sequence always produce the same ops (unit-tested).
 *
 * What stays OUT of this module: creating the canvases, applying the ops in
 * ≤200-op chunks, marking the first canvas as default, and soft-deleting a
 * half-built canvas on failure — those belong to the server action.
 *
 * Known limit (documented, not invented): a single section with more note
 * cards than the cap allows cannot fit one canvas; the server action's apply
 * then fails and soft-deletes the half-built canvas (spec step 7). Splitting
 * a section across several maps is a question for the owner.
 */
import type { CanvasColor, CanvasOp, EdgeAddOp, NodeAddOp } from "./schemas";
import { dagreLayout } from "./layout";
import type { CardSize } from "./defaults";

export type CourseNoteRef = { id: string; title: string };
export type CourseSectionRef = {
  id: string;
  title: string;
  area: string;
  notes: CourseNoteRef[];
};
export type CourseTreeInput = {
  courseTitle: string;
  /** The course home note; null → the core card is a text card instead. */
  home: CourseNoteRef | null;
  sections: CourseSectionRef[];
};

export type IdGenerator = () => string;

export type GeneratedCanvas = {
  title: string;
  /** The `canvases.kind` column value for the canvas being created. */
  kind: "course" | "subject";
  ops: CanvasOp[];
};

// Spec section 5.8 step 6: group colour from the area. Values match the
// `nodes.area` enum in migration 00005.
export const AREA_COLORS: Record<string, CanvasColor> = {
  official_materials: "4",
  student_notes: "5",
  quiz_exam_prep: "2",
  external_resources: "3",
  glossary: "6",
  open_questions: "1",
};
export const DEFAULT_AREA_COLOR: CanvasColor = "4";

// Spec section 5.8 step 4 grid constants.
export const NOTE_CARD_SIZE: CardSize = { width: 320, height: 200 };
export const CORE_CARD_SIZE: CardSize = { width: 360, height: 200 };
export const SECTION_PADDING = 40;
export const SECTION_GAP = 40;
export const SECTION_HEADER = 56;
export const MAX_GRID_COLUMNS = 4;

/** Columns = clamp(ceil(sqrt(n)), 1, 4). */
export function gridColumns(count: number): number {
  return Math.max(1, Math.min(MAX_GRID_COLUMNS, Math.ceil(Math.sqrt(count))));
}

/** Position of grid cell `index` inside a group's top-left corner. */
export function gridCellPosition(
  index: number,
  columns: number,
): { x: number; y: number } {
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: SECTION_PADDING + column * (NOTE_CARD_SIZE.width + SECTION_GAP),
    y:
      SECTION_HEADER +
      SECTION_PADDING +
      row * (NOTE_CARD_SIZE.height + SECTION_GAP),
  };
}

/** A group's size is computed from its grid (header above, padding around). */
export function groupSize(count: number): CardSize {
  const n = Math.max(count, 1);
  const columns = gridColumns(n);
  const rows = Math.ceil(n / columns);
  return {
    width:
      SECTION_PADDING * 2 +
      columns * NOTE_CARD_SIZE.width +
      (columns - 1) * SECTION_GAP,
    height:
      SECTION_HEADER +
      SECTION_PADDING * 2 +
      rows * NOTE_CARD_SIZE.height +
      (rows - 1) * SECTION_GAP,
  };
}

export function areaColorOf(area: string): CanvasColor {
  return AREA_COLORS[area] ?? DEFAULT_AREA_COLOR;
}

const noteCardOp = (
  id: string,
  nodeId: string,
  x: number,
  y: number,
  color: CanvasColor | null,
): NodeAddOp => ({
  op: "node.add",
  id,
  kind: "note",
  node_id: nodeId,
  x,
  y,
  width: NOTE_CARD_SIZE.width,
  height: NOTE_CARD_SIZE.height,
  color,
});

/** The core card: a note card for the course home, or a text card otherwise. */
const coreCardOp = (
  id: string,
  tree: CourseTreeInput,
  x: number,
  y: number,
): NodeAddOp => {
  const base: NodeAddOp = tree.home
    ? noteCardOp(id, tree.home.id, x, y, "6")
    : {
        op: "node.add",
        id,
        kind: "text",
        body: tree.courseTitle,
        x,
        y,
        width: CORE_CARD_SIZE.width,
        height: CORE_CARD_SIZE.height,
        color: "6",
      };
  // Both core shapes are fixed at 360×200 (spec section 5.8 step 3).
  base.width = CORE_CARD_SIZE.width;
  base.height = CORE_CARD_SIZE.height;
  return base;
};

const groupCardOp = (
  id: string,
  section: CourseSectionRef,
  x: number,
  y: number,
): NodeAddOp => ({
  op: "node.add",
  id,
  kind: "group",
  label: section.title,
  x,
  y,
  ...groupSize(section.notes.length),
  color: areaColorOf(section.area),
});

const coreToGroupEdge = (id: string, from: string, to: string): EdgeAddOp => ({
  op: "edge.add",
  id,
  from_node: from,
  to_node: to,
  from_side: "right",
  to_side: "left",
});

/** Chunks a long op list into pieces the RPC accepts (at most 200 each). */
export function chunkOps(ops: readonly CanvasOp[], max = 200): CanvasOp[][] {
  const chunks: CanvasOp[][] = [];
  for (let i = 0; i < ops.length; i += max) chunks.push(ops.slice(i, i + max));
  return chunks;
}

/**
 * Builds the plan. Under the card cap → one `course` canvas; over it → one
 * `subject` canvas per section plus a core `course` canvas holding the core
 * card and one note card per section (the section's first stored note;
 * sections without notes carry no core note card). The core canvas comes
 * first, so the server action can make it the default.
 */
export function generatePlan(
  tree: CourseTreeInput,
  maxCards: number,
  nextId: IdGenerator,
): GeneratedCanvas[] {
  const totals = tree.sections.reduce(
    (sum, section) => sum + 1 + section.notes.length,
    1, // the core card
  );
  if (totals <= maxCards && tree.sections.length > 0) {
    return [singleCourseCanvas(tree, nextId)];
  }
  return chunkedCanvases(tree, nextId);
}

// ---------------------------------------------------------------------------
// Single-canvas course map: core card, one group per section with its note
// grid; dagre places core (left) and groups (right); edges core → group.
// ---------------------------------------------------------------------------

function singleCourseCanvas(
  tree: CourseTreeInput,
  nextId: IdGenerator,
): GeneratedCanvas {
  const coreId = nextId();
  const core = coreCardOp(coreId, tree, 0, 0);

  const boxes = [
    { id: coreId, width: CORE_CARD_SIZE.width, height: CORE_CARD_SIZE.height },
    ...tree.sections.map((section) => ({
      id: `group:${section.id}`,
      ...groupSize(section.notes.length),
    })),
  ];
  const pairs = tree.sections.map((section) => ({
    from: coreId,
    to: `group:${section.id}`,
  }));
  const placements = dagreLayout(boxes, pairs);

  // Translate so the core card's top-left is exactly (0,0) (spec step 3).
  const dx = placements[coreId]!.x;
  const dy = placements[coreId]!.y;
  const at = (key: string) => ({
    x: placements[key]!.x - dx,
    y: placements[key]!.y - dy,
  });

  const groups: NodeAddOp[] = [];
  const cards: NodeAddOp[] = [];
  const edges: EdgeAddOp[] = [];

  for (const section of tree.sections) {
    const groupId = nextId();
    const [gx, gy] = [at(`group:${section.id}`).x, at(`group:${section.id}`).y];
    groups.push(groupCardOp(groupId, section, gx, gy));

    const columns = gridColumns(section.notes.length);
    section.notes.forEach((note, index) => {
      const cell = gridCellPosition(index, columns);
      cards.push(
        noteCardOp(
          nextId(),
          note.id,
          gx + cell.x,
          gy + cell.y,
          areaColorOf(section.area),
        ),
      );
    });

    edges.push(coreToGroupEdge(nextId(), coreId, groupId));
  }

  // Spec section 5.8 step 3: the core card sits at (0,0).
  core.x = at(coreId).x;
  core.y = at(coreId).y;

  // Spec section 5.8 step 7: groups, then cards, then edges.
  return {
    title: tree.courseTitle,
    kind: "course",
    ops: [...groups, ...cards, core, ...edges],
  };
}

// ---------------------------------------------------------------------------
// Over the cap: one `subject` canvas per section (its group at (0,0) with the
// note grid inside), plus a core canvas with the core card and one note card
// per section. No edges inside a subject canvas; core → note edges on the
// core canvas, placed with dagre like the single map.
// ---------------------------------------------------------------------------

function chunkedCanvases(
  tree: CourseTreeInput,
  nextId: IdGenerator,
): GeneratedCanvas[] {
  const canvases: GeneratedCanvas[] = [];

  for (const section of tree.sections) {
    const columns = gridColumns(section.notes.length);
    const groups: NodeAddOp[] = [groupCardOp(nextId(), section, 0, 0)];
    const cards: NodeAddOp[] = section.notes.map((note, index) => {
      const cell = gridCellPosition(index, columns);
      return noteCardOp(
        nextId(),
        note.id,
        cell.x,
        cell.y,
        areaColorOf(section.area),
      );
    });
    // Order per spec step 7: groups, then cards, then edges.
    canvases.push({
      title: section.title,
      kind: "subject",
      ops: [...groups, ...cards],
    });
  }

  // The core canvas: core card + one note card per noted section.
  const coreId = nextId();
  const core = coreCardOp(coreId, tree, 0, 0);
  const noted = tree.sections.filter((section) => section.notes.length > 0);
  const sectionsWithNotes = noted.map((section, index) => ({
    ...section,
    note: section.notes[0],
    key: `note:${index}:${section.id}`,
  }));

  const boxes = [
    { id: coreId, width: CORE_CARD_SIZE.width, height: CORE_CARD_SIZE.height },
    ...sectionsWithNotes.map((entry) => ({
      id: entry.key,
      ...NOTE_CARD_SIZE,
    })),
  ];
  const pairs = sectionsWithNotes.map((entry) => ({
    from: coreId,
    to: entry.key,
  }));
  const placements = dagreLayout(boxes, pairs);
  const dx = placements[coreId]!.x;
  const dy = placements[coreId]!.y;

  const cards: NodeAddOp[] = [];
  const edges: EdgeAddOp[] = [];
  for (const entry of sectionsWithNotes) {
    const at = placements[entry.key]!;
    const noteId = nextId();
    cards.push(
      noteCardOp(
        noteId,
        entry.note.id,
        at.x - dx,
        at.y - dy,
        areaColorOf(entry.area),
      ),
    );
    edges.push(coreToGroupEdge(nextId(), coreId, noteId));
  }
  core.x = placements[coreId]!.x - dx;
  core.y = placements[coreId]!.y - dy;

  canvases.unshift({
    title: tree.courseTitle,
    kind: "course",
    ops: [core, ...cards, ...edges],
  });

  return canvases;
}
