/**
 * Undo/redo history (CANVAS-SPEC section 6.4). Pure and unit-tested, like
 * the rest of `src/lib/canvas/` — the editor keeps a `HistoryState` in a ref
 * and calls these functions.
 *
 * Spec rules:
 *   * a stack of `{ forward, inverse, at }` entries, at most 100;
 *   * a whole user action (drag end, group move, align) is ONE entry — the
 *     editor records the batch it queued;
 *   * typing in a card body coalesces into one entry per 1.5 s pause: two
 *     consecutive all-`node.update` entries that touch exactly the same
 *     cards within the window merge;
 *   * a new action clears the redo stack;
 *   * undo sends the INVERSE ops through the normal save queue (the save
 *     queue coalesces and retries them; skipped ops already tolerate a card
 *     another leader removed).
 *
 * Merge semantics, proven by `ops.ts` Example: when an entry is applied its
 * forward drives the state A→B, its inverse drives B→A. If two entries merge
 * the combined forward must be "the last applied values" (later wins per
 * key) and the combined inverse must be "the values before the first two"
 * (earlier wins per key).
 */
import type { CanvasOp } from "./schemas";

export type HistoryEntry = {
  /** The ops a redo replays (applied forward by the editor). */
  forward: CanvasOp[];
  /** The ops an undo applies (already in application order). */
  inverse: CanvasOp[];
  /** Wall-clock ms of the action that created (or last refreshed) this entry. */
  at: number;
};

export type HistoryState = {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
};

export const HISTORY_LIMIT = 100;
export const COALESCE_WINDOW_MS = 1500;

export const emptyHistory = (): HistoryState => ({ undo: [], redo: [] });

const allNodeUpdatesWithSameIds = (
  a: HistoryEntry,
  b: HistoryEntry,
): boolean => {
  if (
    !a.forward.every((op) => op.op === "node.update") ||
    !b.forward.every((op) => op.op === "node.update")
  ) {
    return false;
  }
  const ids = (entry: HistoryEntry) =>
    entry.forward
      .map((op) => (op.op === "node.update" ? op.id : ""))
      .sort()
      .join("|");
  return ids(a) === ids(b);
};

type UpdateOp = Extract<CanvasOp, { op: "node.update" }>;

/** Forward merges last-wins; inverse merges earlier-wins (original value). */
const mergeUpdates = (
  left: readonly CanvasOp[],
  right: readonly CanvasOp[],
  earlierWins: boolean,
): CanvasOp[] => {
  const byId = new Map<string, UpdateOp>();
  const push = (op: CanvasOp) => {
    if (op.op !== "node.update") return;
    const previous = byId.get(op.id);
    if (!previous) {
      byId.set(op.id, { ...op });
      return;
    }
    const merged: UpdateOp = { ...previous, ...op };
    // Copy only the keys the earlier op carries when the earlier value wins;
    // otherwise the later op's keys spread on top and its absences stay.
    for (const key of Object.keys(op) as (keyof UpdateOp)[]) {
      if (earlierWins && key in previous) {
        (merged as Record<string, unknown>)[key] = previous[key];
      }
    }
    // Keys the later op does not carry keep the earlier value in both
    // directions; `preserve` above only matters for overlapping keys.
    byId.set(op.id, merged);
  };
  for (const op of left) push(op);
  for (const op of right) push(op);
  return [...byId.values()];
};

/**
 * Records one user action. Returns a NEW HistoryState (pure); unchanged
 * input is never mutated. An action with no ops records nothing.
 */
export function record(
  history: HistoryState,
  forward: readonly CanvasOp[],
  inverse: readonly CanvasOp[],
  at: number,
): HistoryState {
  if (forward.length === 0) return history;
  const entry: HistoryEntry = {
    forward: [...forward],
    inverse: [...inverse],
    at,
  };
  const undoAll = history.undo;

  const tail = undoAll[undoAll.length - 1];
  if (
    tail &&
    at - tail.at <= COALESCE_WINDOW_MS &&
    allNodeUpdatesWithSameIds(tail, entry)
  ) {
    const merged: HistoryEntry = {
      forward: mergeUpdates(tail.forward, entry.forward, false),
      inverse: mergeUpdates(tail.inverse, entry.inverse, true),
      at,
    };
    const undo = [...undoAll.slice(0, -1), merged];
    return { undo: undo.slice(-HISTORY_LIMIT), redo: [] };
  }

  const undo = [...undoAll, entry].slice(-HISTORY_LIMIT);
  return { undo, redo: [] };
}

/** Takes the newest entry off the undo stack for the editor to apply. */
export function popUndo(
  history: HistoryState,
): { after: HistoryState; entry: HistoryEntry } | null {
  const entry = history.undo[history.undo.length - 1];
  if (!entry) return null;
  return {
    after: { undo: history.undo.slice(0, -1), redo: history.redo },
    entry,
  };
}

/** Pushes an entry onto the redo stack after its undo was applied. */
export function pushRedo(
  history: HistoryState,
  entry: HistoryEntry,
): HistoryState {
  return {
    undo: history.undo,
    redo: [...history.redo, entry].slice(-HISTORY_LIMIT),
  };
}

/** Takes the newest entry off the redo stack for the editor to re-apply. */
export function popRedo(
  history: HistoryState,
): { after: HistoryState; entry: HistoryEntry } | null {
  const entry = history.redo[history.redo.length - 1];
  if (!entry) return null;
  return {
    after: { undo: history.undo, redo: history.redo.slice(0, -1) },
    entry,
  };
}

/** Pushes an entry back onto the undo stack after its redo was applied. */
export function pushUndo(
  history: HistoryState,
  entry: HistoryEntry,
): HistoryState {
  return {
    undo: [...history.undo, entry].slice(-HISTORY_LIMIT),
    redo: history.redo,
  };
}

/** Whether the `?` shortcuts sheet shows Can undo / Can redo states. */
export const canUndo = (history: HistoryState): boolean =>
  history.undo.length > 0;
export const canRedo = (history: HistoryState): boolean =>
  history.redo.length > 0;
