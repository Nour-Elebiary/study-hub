import { describe, expect, it } from "vitest";
import {
  COALESCE_WINDOW_MS,
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  emptyHistory,
  popRedo,
  popUndo,
  pushRedo,
  pushUndo,
  record,
  type HistoryEntry,
  type HistoryState,
} from "@/lib/canvas/history";
import type { CanvasColor, CanvasOp } from "@/lib/canvas/schemas";
import { applyOps, invertOps } from "@/lib/canvas/ops";
import type { CanvasState } from "@/lib/canvas/types";

const move = (id: string, x: number, y: number): CanvasOp => ({
  op: "node.update",
  id,
  x,
  y,
});

const place = (id: string, width: number, height: number): CanvasOp => ({
  op: "node.update",
  id,
  width,
  height,
});

const repaint = (id: string, color: string): CanvasOp => ({
  op: "node.update",
  id,
  color: color as CanvasColor,
});

describe("record", () => {
  it("pushes an entry and clears the redo stack", () => {
    let history: HistoryState = {
      undo: [{ forward: [], inverse: [], at: 0 }],
      redo: [],
    };
    history = record(
      history,
      [{ op: "node.add", id: "n1" } as CanvasOp],
      [{ op: "node.delete", id: "n1" }],
      100,
    );
    expect(history.undo).toHaveLength(2);
    expect(history.redo).toHaveLength(0);
    expect(canUndo(history)).toBe(true);
  });

  it("records nothing for an empty action", () => {
    const before: HistoryState = { undo: [], redo: [] };
    expect(record(before, [], [], 5)).toEqual(before);
  });

  it("keeps at most 100 entries (oldest discarded)", () => {
    let history = emptyHistory();
    for (let i = 0; i < 150; i++) {
      const forward: CanvasOp[] = [
        { op: "node.update", id: `card-${i}`, x: i },
      ];
      history = record(
        history,
        forward,
        [{ op: "node.update", id: `card-${i}` }],
        i * 10_000,
      );
    }
    expect(history.undo).toHaveLength(HISTORY_LIMIT);
    // The oldest surviving entry is action #50.
    expect(history.undo[0]!.forward[0]).toMatchObject({ id: "card-50" });
    expect(history.undo).toHaveLength(100);
  });
});

describe("coalescing (spec 6.4: typing is one entry per 1.5 s pause)", () => {
  it("merges consecutive same-card position updates inside the window", () => {
    const first: HistoryEntry = {
      forward: [move("n1", 20, 40)],
      inverse: [move("n1", 10, 0)],
      at: 1_000,
    };
    let history: HistoryState = { undo: [first], redo: [] };
    history = record(
      history,
      [place("n1", 200, 100)],
      [place("n1", 300, 300)],
      1_000 + COALESCE_WINDOW_MS - 1,
    );
    expect(history.undo).toHaveLength(1);
    // Later forward wins per field; fields only in the later entry join.
    expect(history.undo[0]!.forward).toEqual([
      { op: "node.update", id: "n1", x: 20, y: 40, width: 200, height: 100 },
    ]);
    // Earlier inverse wins on overlap; new keys join.
    expect(history.undo[0]!.inverse).toEqual([
      { op: "node.update", id: "n1", x: 10, y: 0, width: 300, height: 300 },
    ]);
  });

  it("merges a body update right after a move of the same card", () => {
    const first: HistoryEntry = {
      forward: [move("n1", 20, 40)],
      inverse: [move("n1", 10, 0)],
      at: 0,
    };
    let history: HistoryState = { undo: [first], redo: [] };
    const bodyOp: CanvasOp = { op: "node.update", id: "n1", body: "hi" };
    const bodyUndo: CanvasOp = { op: "node.update", id: "n1", body: "a" };
    history = record(history, [bodyOp], [bodyUndo], COALESCE_WINDOW_MS);
    expect(history.undo[0]!.forward).toEqual([
      { op: "node.update", id: "n1", x: 20, y: 40, body: "hi" },
    ]);
    expect(history.undo[0]!.inverse).toEqual([
      { op: "node.update", id: "n1", x: 10, y: 0, body: "a" },
    ]);
  });

  it("does not merge after the pause window ends", () => {
    let history = emptyHistory();
    history = record(
      { undo: [], redo: [] },
      [move("n1", 20, 40)],
      [move("n1", 10, 0)],
      0,
    );
    history = record(
      history,
      [repaint("n1", "1")],
      [repaint("n1", "2")],
      COALESCE_WINDOW_MS + 1,
    );
    expect(history.undo).toHaveLength(2);
  });

  it("does not merge different cards", () => {
    const first = {
      forward: [move("n1", 20, 40)],
      inverse: [move("n1", 10, 0)],
      at: 0,
    };
    let history: HistoryState = { undo: [first], redo: [] };
    history = record(
      history,
      [move("n2", 1, 1)],
      [move("n2", 0, 0)],
      COALESCE_WINDOW_MS,
    );
    expect(history.undo).toHaveLength(2);
  });

  it("does not merge a multi-card group move with a later drag", () => {
    const first = {
      forward: [move("n1", 20, 40), move("n2", 20, 40)],
      inverse: [move("n2", 0, 0), move("n1", 0, 0)],
      at: 0,
    };
    let history: HistoryState = { undo: [first], redo: [] };
    history = record(
      history,
      [move("n2", 60, 80)],
      [move("n2", 20, 40)],
      COALESCE_WINDOW_MS,
    );
    expect(history.undo).toHaveLength(2);
  });

  it("merged typing round-trips: forward then inverse restores the start", () => {
    const start: CanvasState = {
      cards: {
        n1: {
          id: "n1",
          kind: "text",
          nodeId: null,
          assetId: null,
          url: null,
          x: 10,
          y: 0,
          width: 120,
          height: 80,
          z: 0,
          color: null,
          body: "a",
          label: null,
          studentVisible: true,
        },
      },
      edges: {},
      rev: 0,
    };
    // Step 1: drag. Step 2 (typing, within the window): body change.
    const step1 = record(
      emptyHistory(),
      [move("n1", 20, 40)],
      invertOps(start, [move("n1", 20, 40)]),
      0,
    );
    const step2 = record(
      step1,
      [{ op: "node.update", id: "n1", body: "b" }],
      [{ op: "node.update", id: "n1", body: "a" }],
      COALESCE_WINDOW_MS,
    );
    const entry = step2.undo[0]!;
    const after = applyOps(start, entry.forward);
    const back = applyOps(after, entry.inverse);
    expect(back.cards.n1).toEqual(start.cards.n1);
  });
});

describe("undo / redo stacks", () => {
  const entryA: HistoryEntry = {
    forward: [{ op: "node.add", id: "a" } as CanvasOp],
    inverse: [{ op: "node.delete", id: "a" }],
    at: 1,
  };
  const entryB: HistoryEntry = {
    forward: [{ op: "node.add", id: "b" } as CanvasOp],
    inverse: [{ op: "node.delete", id: "b" }],
    at: 2,
  };

  it("popUndo pops the newest entry and leaves redo intact", () => {
    const history: HistoryState = { undo: [entryA, entryB], redo: [] };
    const popped = popUndo(history)!;
    expect(popped.entry).toBe(entryB);
    expect(popped.after.undo).toEqual([entryA]);
    expect(popped.after.redo).toEqual([]);
  });

  it("pushRedo accumulates and canUndo stays true while undo remains", () => {
    let history: HistoryState = { undo: [entryA], redo: [] };
    history = pushRedo(history, entryB);
    expect(history.redo).toEqual([entryB]);
    expect(canUndo(history)).toBe(true);
    expect(canRedo(history)).toBe(true);
  });

  it("popRedo pops the newest redo entry", () => {
    const history: HistoryState = { undo: [], redo: [entryA, entryB] };
    const popped = popRedo(history)!;
    expect(popped.entry).toBe(entryB);
    expect(popped.after.redo).toEqual([entryA]);
  });

  it("pushUndo keeps the redo stack untouched", () => {
    let history: HistoryState = { undo: [], redo: [entryA] };
    history = pushUndo(history, entryB);
    expect(history.undo).toEqual([entryB]);
    expect(history.redo).toEqual([entryA]);
  });

  it("pops on empty stacks return null", () => {
    expect(popUndo(emptyHistory())).toBeNull();
    expect(popRedo(emptyHistory())).toBeNull();
  });
});
