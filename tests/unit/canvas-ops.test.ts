import { describe, expect, it } from "vitest";
import { applyOps, invertOps } from "@/lib/canvas/ops";
import { canvasOp, type CanvasOp } from "@/lib/canvas/schemas";
import type { CanvasCard, CanvasEdge, CanvasState } from "@/lib/canvas/types";

const CARD_A = "aaaaaaaa-0000-8000-0000-000000000001";
const CARD_B = "aaaaaaaa-0000-8000-0000-000000000002";
const CARD_C = "aaaaaaaa-0000-8000-0000-000000000003";
const CARD_D = "aaaaaaaa-0000-8000-0000-000000000004";
const EDGE_AB = "aaaaaaaa-0000-2000-0000-000000000001";
const EDGE_BC = "aaaaaaaa-0000-2000-0000-000000000002";
const NOTE_1 = "eeeeeeee-0000-eeee-0000-000000000001";

const card = (id: string, overrides: Partial<CanvasCard> = {}): CanvasCard => ({
  id,
  kind: "text",
  nodeId: null,
  assetId: null,
  url: null,
  x: 0,
  y: 0,
  width: 260,
  height: 140,
  z: 0,
  color: null,
  body: "text",
  label: null,
  studentVisible: true,
  ...overrides,
});

const edge = (id: string, from: string, to: string): CanvasEdge => ({
  id,
  from,
  to,
  fromSide: "right",
  toSide: "left",
  fromEnd: "none",
  toEnd: "arrow",
  label: null,
  color: null,
});

const START: CanvasState = {
  cards: {
    [CARD_A]: card(CARD_A, { color: "4" }),
    [CARD_B]: card(CARD_B, { color: null }),
    [CARD_C]: card(CARD_C, { kind: "link", url: "https://example.com", body: null }),
    [CARD_D]: card(CARD_D, { kind: "note", nodeId: NOTE_1, body: null, x: 40, y: 60 }),
  },
  edges: {
    [EDGE_AB]: edge(EDGE_AB, CARD_A, CARD_B),
    [EDGE_BC]: edge(EDGE_BC, CARD_B, CARD_C),
  },
  rev: 7,
};

const parse = (op: unknown): CanvasOp => canvasOp.parse(op);

// A tiny deterministic PRNG (mulberry32) for the property test.
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng: () => number, list: string[]): string | null =>
  list.length === 0 ? null : list[Math.floor(rng() * list.length)]!;

describe("applyOps", () => {
  it("adds, updates and deletes cards; unknown ids are skipped, never thrown", () => {
    const ops = [
      parse({
        op: "node.add",
        id: CARD_C,
        kind: "text",
        body: "rebind",
        x: 10,
        y: 20,
        width: 260,
        height: 140,
      }),
      parse({ op: "node.update", id: CARD_A, x: 100, y: 120, color: "2" }),
      parse({ op: "node.update", id: "99999999-0000-8000-0000-000000000009", x: 5 }),
      parse({ op: "node.delete", id: CARD_B }),
      parse({ op: "node.delete", id: "99999999-0000-8000-0000-000000000009" }),
      parse({
        op: "edge.add",
        id: "aaaaaaaa-0000-2000-0000-000000000009",
        from_node: CARD_A,
        to_node: "99999999-0000-8000-0000-000000000009", // unknown target: the DB would refuse the whole batch, the mirror just skips it
      }),
    ];
    const next = applyOps(START, ops);
    expect(next.rev).toBe(8);
    expect(next.cards[CARD_A]).toMatchObject({ x: 100, y: 120, color: "2" });
    expect(next.cards[CARD_B]).toBeUndefined();
    expect(next.edges[EDGE_AB]).toBeUndefined(); // cascaded away by the delete
    expect(next.edges[EDGE_BC]).toBeUndefined(); // it hung off CARD_B too
    expect(next.edges["aaaaaaaa-0000-2000-0000-000000000009"]).toBeUndefined(); // skipped add
    // CARD_C existed before the duplicate add attempt, so the add was skipped.
    expect(next.cards[CARD_C]).toMatchObject({ kind: "link", url: "https://example.com" });
  });

  it("treats an explicit null as a set (colour/label clear), a missing key as keep", () => {
    const next = applyOps(START, [
      parse({ op: "node.update", id: CARD_A, color: null, label: null }),
      parse({ op: "node.update", id: CARD_C, url: null }),
    ]);
    expect(next.cards[CARD_A]).toMatchObject({ color: null, label: null });
    expect(next.cards[CARD_C]).toMatchObject({ url: null });
    // Untouched fields keep their values (no accidental resets).
    expect(next.cards[CARD_A]).toMatchObject({ x: 0, body: "text" });
  });

  it("applies ops in order with last-write-wins inside one batch (D6)", () => {
    const next = applyOps(START, [
      parse({ op: "node.update", id: CARD_A, x: 1 }),
      parse({ op: "node.update", id: CARD_A, x: 2 }),
      parse({ op: "node.update", id: CARD_A, x: 3 }),
    ]);
    expect(next.cards[CARD_A]!.x).toBe(3);
  });

  it("does not mutate the input state", () => {
    applyOps(START, [
      parse({ op: "node.update", id: CARD_A, x: 500, color: "1" }),
      parse({ op: "node.delete", id: CARD_B }),
    ]);
    expect(START.cards[CARD_A]!.x).toBe(0);
    expect(START.cards[CARD_B]).toBeDefined();
  });
});

describe("invertOps", () => {
  it("un-does a plain sequence in reverse order (add/delete/update/edges)", () => {
    const ops = [
      parse({
        op: "node.add",
        id: "aaaaaaaa-0000-8000-0000-0000000000f0",
        kind: "text",
        body: "new",
        x: 900,
        y: 900,
        width: 260,
        height: 140,
      }),
      parse({ op: "node.delete", id: CARD_A }),
      parse({ op: "node.update", id: CARD_C, x: 777, color: "5" }),
      parse({ op: "edge.update", id: EDGE_AB, label: "after" }),
      parse({ op: "edge.delete", id: EDGE_BC }),
    ];
    const after = applyOps(START, ops);
    const inverse = invertOps(START, ops);
    const restored = applyOps(after, inverse);
    expect(restored.cards).toEqual(START.cards);
    expect(restored.edges).toEqual(START.edges);
  });

  it("restores a deleted card together with every edge the delete cascaded", () => {
    const ops = [parse({ op: "node.delete", id: CARD_B })];
    const inverse = invertOps(START, ops);
    expect(inverse[0]).toMatchObject({ op: "node.add", id: CARD_B });
    expect(inverse.slice(1).map((op) => `${op.op}:${op.id}`)).toEqual([
      `edge.add:${EDGE_AB}`,
      `edge.add:${EDGE_BC}`,
    ]);
    const restored = applyOps(applyOps(START, ops), inverse);
    expect(restored.cards).toEqual(START.cards);
    expect(restored.edges).toEqual(START.edges);
  });

  it("round-trips node.update including null colour and cleared label", () => {
    const ops = [
      parse({ op: "node.update", id: CARD_A, color: null, label: "temp" }),
      parse({ op: "node.update", id: CARD_A, width: 300 }),
    ];
    const after = applyOps(START, ops);
    expect(after.cards[CARD_A]!.color).toBeNull();
    const restored = applyOps(after, invertOps(START, ops));
    expect(restored.cards[CARD_A]).toEqual(START.cards[CARD_A]);
  });

  it("restores an edge.update with the previous side and arrows", () => {
    const ops = [
      parse({ op: "edge.update", id: EDGE_AB, from_side: "top", to_end: "none", label: null }),
    ];
    const restored = applyOps(applyOps(START, ops), invertOps(START, ops));
    expect(restored.edges[EDGE_AB]).toEqual(START.edges[EDGE_AB]);
  });

  it("skipped ops contribute nothing to the inverse (unknown id, wrong shape)", () => {
    const ops = [
      parse({ op: "node.update", id: "99999999-0000-8000-0000-000000000009", x: 3 }),
      parse({ op: "node.delete", id: "99999999-0000-8000-0000-000000000009" }),
      parse({ op: "edge.update", id: "99999999-0000-2000-0000-000000000009", label: "x" }),
      parse({ op: "node.update", id: CARD_A, x: 500 }),
    ];
    expect(invertOps(START, ops)).toEqual([
      parse({ op: "node.update", id: CARD_A, x: START.cards[CARD_A]!.x }),
    ]);
  });
});

describe("property: apply → invert → apply returns the original state", () => {
  it("for 200 seeded op sequences", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = mulberry32(seed * 7919);
      const ops: CanvasOp[] = [];
      for (let step = 0; step < 8; step++) {
        const roll = rng();
        const cardIds = Object.keys(START.cards).concat(
          Object.keys((ops.length ? applyOps(START, ops) : START).cards).filter(
            (id) => !START.cards[id],
          ),
        );
        if (roll < 0.15) {
          // add a fresh text card
          const id = `dddddddd-1000-8000-0000-${(seed * 100 + step).toString().padStart(12, "0")}`;
          ops.push(
            parse({
              op: "node.add",
              id,
              kind: "text",
              body: `body ${seed}-${step}`,
              x: Math.floor(rng() * 1000),
              y: Math.floor(rng() * 1000),
              width: 260,
              height: 140,
            }),
          );
        } else if (roll < 0.45) {
          const id = pick(rng, cardIds);
          if (!id) continue;
          ops.push(parse({ op: "node.delete", id }));
        } else {
          // update a live card; body only when it is already a string
          const live = applyOps(START, ops);
          const options = Object.values(live.cards)
            .filter((c) => c.body === null || typeof c.body === "string")
            .map((c) => c.id);
          const id = pick(rng, options);
          if (!id) continue;
          const target = live.cards[id]!;
          const patch: Record<string, unknown> = {
            op: "node.update",
            id,
            x: Math.floor(rng() * 800),
            y: Math.floor(rng() * 800),
          };
          if (rng() < 0.5) patch.color = rng() < 0.5 ? null : "3";
          if (rng() < 0.5) patch.label = rng() < 0.5 ? null : `label ${step}`;
          if (typeof target.body === "string" && rng() < 0.5) patch.body = `rewritten ${step}`;
          ops.push(parse(patch));
        }
      }

      const before = ops;
      const after = applyOps(START, before);
      const restored = applyOps(after, invertOps(START, before));
      expect(restored.cards, `seed ${seed} cards`).toEqual(START.cards);
      expect(restored.edges, `seed ${seed} edges`).toEqual(START.edges);
    }
  });
});
