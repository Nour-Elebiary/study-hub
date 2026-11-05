import { describe, expect, it } from "vitest";
import {
  areaColorOf,
  generatePlan,
  gridCellPosition,
  gridColumns,
  groupSize,
  chunkOps,
  type CourseTreeInput,
  type IdGenerator,
} from "@/lib/canvas/generate";
import {
  NOTE_CARD_SIZE,
  SECTION_GAP,
  SECTION_HEADER,
  SECTION_PADDING,
} from "@/lib/canvas/generate";
import { canvasOp } from "@/lib/canvas/schemas";

const counterIds = (prefix = "0d0d0d0d-0000-8000-0000"): IdGenerator => {
  let n = 0;
  return () => `${prefix}-${(++n).toString(16).padStart(12, "0")}`;
};

// A full course tree: core home (the seed admin's course home id shape), two
// sections, and the readable seed-style note ids.
const baseTree = (): CourseTreeInput => ({
  courseTitle: "Physics 101",
  home: { id: "eeeeeeee-0000-eeee-0000-000000000001", title: "Course home" },
  sections: [
    {
      id: "ssssssss-0000-ssss-0000-000000000001",
      title: "Week 1",
      area: "official_materials",
      notes: [
        { id: "eeeeeeee-0000-eeee-0000-000000000011", title: "Lecture 1" },
        { id: "eeeeeeee-0000-eeee-0000-000000000012", title: "Lecture 2" },
        { id: "eeeeeeee-0000-eeee-0000-000000000013", title: "Lecture 3" },
      ],
    },
    {
      id: "ssssssss-0000-ssss-0000-000000000002",
      title: "Practice",
      area: "quiz_exam_prep",
      notes: [
        { id: "eeeeeeee-0000-eeee-0000-000000000021", title: "Quiz bank" },
      ],
    },
  ],
});

describe("grid helpers", () => {
  it("clamps columns between 1 and 4", () => {
    expect(gridColumns(0)).toBe(1);
    expect(gridColumns(2)).toBe(2); // ceil(sqrt(2)) = 2
    expect(gridColumns(4)).toBe(2);
    expect(gridColumns(5)).toBe(3);
    expect(gridColumns(50)).toBe(4);
  });

  it("positions grid cells leaving header and padding margins", () => {
    expect(gridCellPosition(0, 1)).toEqual({
      x: SECTION_PADDING,
      y: SECTION_HEADER + SECTION_PADDING,
    });
    expect(gridCellPosition(3, 4)).toEqual({
      x: SECTION_PADDING + 3 * (NOTE_CARD_SIZE.width + SECTION_GAP),
      y: SECTION_HEADER + SECTION_PADDING,
    });
    expect(gridCellPosition(4, 2).y).toBeGreaterThan(gridCellPosition(0, 2).y);
  });

  it("computes the group size from its grid", () => {
    // 2 notes → 2 columns, 1 row.
    expect(groupSize(2)).toEqual({
      width: SECTION_PADDING * 2 + 2 * NOTE_CARD_SIZE.width + SECTION_GAP,
      height: SECTION_HEADER + SECTION_PADDING * 2 + NOTE_CARD_SIZE.height,
    });
    // 5 notes → 3 columns, 2 rows.
    const five = groupSize(5);
    expect(five.width).toBe(
      SECTION_PADDING * 2 + 3 * NOTE_CARD_SIZE.width + 2 * SECTION_GAP,
    );
    expect(five.height).toBe(
      SECTION_HEADER +
        SECTION_PADDING * 2 +
        2 * NOTE_CARD_SIZE.height +
        SECTION_GAP,
    );
  });
});

describe("area colours", () => {
  it("maps every known area and falls back for an unknown one", () => {
    expect(areaColorOf("official_materials")).toBe("4");
    expect(areaColorOf("student_notes")).toBe("5");
    expect(areaColorOf("quiz_exam_prep")).toBe("2");
    expect(areaColorOf("external_resources")).toBe("3");
    expect(areaColorOf("glossary")).toBe("6");
    expect(areaColorOf("open_questions")).toBe("1");
    expect(areaColorOf("something_new")).toBe("4");
  });
});

describe("generatePlan — single canvas under the cap", () => {
  const plan = generatePlan(baseTree(), 200, counterIds());

  it("returns one course canvas whose every op passes the wire schema", () => {
    expect(plan).toHaveLength(1);
    const canvas = plan[0]!;
    expect(canvas.title).toBe("Physics 101");
    expect(canvas.kind).toBe("course");
    // 2 groups + 1 core + 4 notes + 2 edges
    expect(canvas.ops).toHaveLength(9);
    for (const op of canvas.ops) {
      expect(canvasOp.safeParse(op).success, JSON.stringify(op)).toBe(true);
    }
  });

  it("orders ops groups → cards → edges, with the core card at (0,0) colour 6", () => {
    const ops = plan[0]!.ops;
    expect(ops.slice(0, 2).map((op) => op.op)).toEqual([
      "node.add",
      "node.add",
    ]);
    expect(ops.slice(0, 2).map((op) => (op as { kind: string }).kind)).toEqual([
      "group",
      "group",
    ]);
    expect(
      ops.slice(2, 7).map((op) => (op as { kind: string }).kind ?? "note"),
    ).toContain("note");
    const last = ops[ops.length - 1]!;
    expect(last).toMatchObject({
      op: "edge.add",
      from_side: "right",
      to_side: "left",
    });
    const core = ops.find(
      (op) =>
        op.op === "node.add" &&
        (op as { kind: string }).kind === "note" &&
        (op as { node_id?: string }).node_id ===
          "eeeeeeee-0000-eeee-0000-000000000001",
    )!;
    expect(core).toMatchObject({
      x: 0,
      y: 0,
      color: "6",
      width: 360,
      height: 200,
    });
    expect(ops.filter((op) => op.op === "edge.add")).toHaveLength(2);
  });

  it("puts note cards inside their group grid using the area colour", () => {
    const ops = plan[0]!.ops;
    const week1 = ops[0] as { x: number; y: number; kind: string };
    expect(week1.kind).toBe("group");
    const firstNote = ops[2] as { x: number; y: number; color: string };
    expect(firstNote.color).toBe("4"); // official_materials
    expect(firstNote.x).toBe(week1.x + SECTION_PADDING);
    expect(firstNote.y).toBe(week1.y + SECTION_HEADER + SECTION_PADDING);
  });

  it("is deterministic and matches the stored snapshot", () => {
    const again = generatePlan(baseTree(), 200, counterIds());
    expect(again).toEqual(plan);
    expect(plan[0]!.ops).toMatchSnapshot();
  });
});

describe("generatePlan — over the cap → chunked canvases", () => {
  // The tree totals 1 core + (1 + 3) + (1 + 1) = 7 cards; a cap of 4 forces
  // the "one canvas per section" path.
  const plan = generatePlan(baseTree(), 4, counterIds());

  it("creates a core canvas first plus one subject canvas per section", () => {
    expect(plan).toHaveLength(3);
    expect(plan[0]).toMatchObject({ title: "Physics 101", kind: "course" });
    expect(plan[1]).toMatchObject({ title: "Week 1", kind: "subject" });
    expect(plan[2]).toMatchObject({ title: "Practice", kind: "subject" });
  });

  it("subject canvases hold the group at (0,0) and its note grid, no edges", () => {
    const ops = plan[1]!.ops;
    expect(ops[0]).toMatchObject({ op: "node.add", kind: "group", x: 0, y: 0 });
    expect(ops.filter((op) => op.op === "edge.add")).toHaveLength(0);
    for (const op of ops) {
      expect(canvasOp.safeParse(op).success, JSON.stringify(op)).toBe(true);
    }
  });

  it("the core canvas keeps the core card and one note card per noted section", () => {
    const ops = plan[0]!.ops;
    expect(
      ops.filter(
        (op) =>
          op.op === "node.add" && (op as { kind: string }).kind === "note",
      ),
    ).toHaveLength(3); // one per section (both have notes) + the core card
    expect(ops.filter((op) => op.op === "edge.add")).toHaveLength(2);
  });
});

describe("generatePlan — a course with no sections", () => {
  it("still produces the minimal map: just the core card", () => {
    const tree = baseTree();
    tree.sections = [];
    const plan = generatePlan(tree, 200, counterIds());
    expect(plan).toHaveLength(1);
    expect(plan[0]!.ops).toHaveLength(1);
    expect(plan[0]!.ops[0]).toMatchObject({
      op: "node.add",
      kind: "note",
      x: 0,
      y: 0,
    });
  });
});

describe("chunkOps", () => {
  it("splits at most 200 ops per chunk", () => {
    const op = {
      op: "node.update",
      id: "cccccccc-0000-cccc-0000-000000000001",
      x: 1,
    } as const;
    const ops = Array.from({ length: 450 }, () => op);
    const chunks = chunkOps(ops);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(200);
    expect(chunks[1]).toHaveLength(200);
    expect(chunks[2]).toHaveLength(50);
  });

  it("keeps an empty list empty and respects a custom size", () => {
    expect(chunkOps([])).toEqual([]);
    const op = {
      op: "node.update",
      id: "cccccccc-0000-cccc-0000-000000000001",
      x: 1,
    } as const;
    expect(chunkOps([op, op, op], 2)).toHaveLength(2);
  });
});
