/**
 * Save queue (CANVAS-SPEC section 6.4). Pure and unit-tested with injected
 * timers; the editor wires real setTimeout and the browser online/offline
 * events into it.
 *
 * Spec rules:
 *   * the local state is optimistic — the queue only ships ops;
 *   * flush after 800 ms of quiet, immediately via flushNow() (Ctrl+S,
 *     window blur, visibilitychange to hidden), batches of at most 200 ops;
 *   * consecutive `node.update` ops for the same card coalesce into one op
 *     (fields merge, the last value wins, `ops.ts` keeps the same rule);
 *   * retry with back-off 2 s / 6 s / 18 s, then show "Could not save";
 *     ops are never dropped silently;
 *   * while offline the queue pauses and shows "Offline"; the chip states
 *     are Saved / Saving… / Offline / Could not save;
 *   * the server's `rev` is handed to the editor through the env's onRev
 *     callback (spec: the editor uses it for the focus refetch check).
 */
import type { CanvasOp } from "./schemas";

export type SaveStatus = "saved" | "saving" | "offline" | "error";

export type SendResult =
  { ok: true; rev: number } | { ok: false; error: string; refetch?: boolean };

export const BATCH_LIMIT = 200;
export const QUIET_MS = 800;
export const RETRY_DELAYS_MS = [2_000, 6_000, 18_000] as const;

export type SaveEnv = {
  send: (batch: CanvasOp[]) => Promise<SendResult>;
  /** Called with every accepted server rev, newest last. */
  onRev: (rev: number) => void;
  /** Fake-timer friendly scheduler; window.setTimeout is injected app-side. */
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
  now: () => number;
};

const isNodeUpdate = (
  op: CanvasOp,
): op is Extract<CanvasOp, { op: "node.update" }> => op.op === "node.update";

/**
 * Coalesces the incoming op into the pending tail: a continuing stream of
 * `node.update` ops for the SAME card merges fields (the later value wins).
 * Wholesale coalescing of every same-card op in the pending list would
 * reorder edge ops between them ("consecutive" per spec), so only the tail
 * chain participates.
 */
function coalesceTail(pending: CanvasOp[], op: CanvasOp): boolean {
  if (!isNodeUpdate(op)) return false;
  // Walk backwards over the consecutive node.update ops for this card.
  let index = pending.length - 1;
  while (index >= 0 && isNodeUpdate(pending[index]!)) {
    if (pending[index]!.id === op.id) {
      pending[index] = { ...pending[index]!, ...op };
      return true;
    }
    index--;
  }
  return false;
}

export class SaveQueue {
  private readonly env: SaveEnv;
  private pending: CanvasOp[] = [];
  private timer: unknown = null;
  private inFlight = false;
  private retries = 0;
  private online = true;
  private status: SaveStatus = "saved";
  private readonly listeners = new Set<(status: SaveStatus) => void>();

  constructor(env: SaveEnv) {
    this.env = env;
  }

  subscribe(listener: (status: SaveStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  /** Tracked for the beforeunload warning (spec: while the queue is not empty). */
  hasPending(): boolean {
    return this.pending.length > 0;
  }

  private setStatus(status: SaveStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }

  /** Offline/offline-event wiring: pause and show the offline chip. */
  setOnline(online: boolean): void {
    if (online) {
      this.online = true;
      if (this.pending.length > 0) this.flushNow();
      else if (this.status !== "error") this.setStatus("saved");
      return;
    }
    this.online = false;
    // Stay "error" if a save already failed — the retry button still works.
    if (this.status !== "error") this.setStatus("offline");
  }

  queue(ops: readonly CanvasOp[]): void {
    if (ops.length === 0) return;
    for (const op of ops) {
      if (!coalesceTail(this.pending, op)) this.pending.push(op as CanvasOp);
    }
    this.pending = this.pending.slice(-BATCH_LIMIT * 5); // never grows unbounded
    // Offline pauses everything: the ops sit in the queue until the browser
    // reports online again (then setOnline flushes right away).
    if (this.online) {
      if (this.status !== "saving") this.setStatus("saving");
      this.scheduleQuiet();
    }
  }

  private scheduleQuiet(): void {
    this.cancelQuiet();
    this.timer = this.env.schedule(() => {
      this.timer = null;
      void this.flushNow();
    }, QUIET_MS);
  }

  private cancelQuiet(): void {
    if (this.timer !== null) {
      this.env.cancel(this.timer);
      this.timer = null;
    }
  }

  /** Flush on demand (Ctrl+S, blur, visibilitychange, back online). */
  flushNow(): void {
    this.cancelQuiet();
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.inFlight) return;
    if (this.pending.length === 0) {
      if (this.status !== "error") this.setStatus("saved");
      return;
    }
    if (!this.online) {
      this.setStatus("offline");
      return;
    }
    this.inFlight = true;
    const batch = this.pending.slice(0, BATCH_LIMIT);
    this.pending = this.pending.slice(batch.length);
    this.setStatus("saving");
    let result: SendResult;
    try {
      result = await this.env.send(batch);
    } catch (error) {
      result = {
        ok: false,
        error: error instanceof Error ? error.message : "network",
      };
    }
    this.inFlight = false;

    if (result.ok) {
      this.retries = 0;
      this.env.onRev(result.rev);
      if (this.pending.length > 0) {
        void this.flush();
        return;
      }
      this.setStatus("saved");
      return;
    }

    // Never drop ops silently: put the whole batch back at the front so the
    // next attempt replays it in order.
    this.pending = [...batch, ...this.pending];
    if (this.retries < RETRY_DELAYS_MS.length) {
      const delay = RETRY_DELAYS_MS[this.retries]!;
      this.retries++;
      this.env.schedule(() => void this.flush(), delay);
      return;
    }
    // Three failed attempts: show the "Could not save — Retry" chip and stop.
    this.setStatus("error");
  }

  /** The retry button on the failure chip: give the queue three more tries. */
  retry(): void {
    this.retries = 0;
    void this.flush();
  }
}
