import { describe, expect, it, vi } from "vitest";
import {
  BATCH_LIMIT,
  QUIET_MS,
  RETRY_DELAYS_MS,
  SaveQueue,
  type SendResult,
  type SaveEnv,
} from "@/lib/canvas/save-queue";
import type { CanvasOp } from "@/lib/canvas/schemas";

type Timer = { fn: () => void; ms: number; id: number };

/** Manual fake-timer harness: injected into SaveQueue, driven test-side. */
function makeEnv(results: SendResult[]): {
  env: SaveEnv;
  sent: CanvasOp[][];
  fireAll: (ms: number) => void;
  pendingTimers: () => Timer[];
} {
  let id = 0;
  const timers: Timer[] = [];
  const sent: CanvasOp[][] = [];
  const env: SaveEnv = {
    send: async (batch) => {
      sent.push(batch);
      const next = results.shift();
      if (!next) throw new Error("no scripted result");
      return next;
    },
    onRev: vi.fn(),
    schedule: (fn, ms) => {
      timers.push({ fn, ms, id: ++id });
      return id;
    },
    cancel: (handle) => {
      const index = timers.findIndex((timer) => timer.id === handle);
      if (index >= 0) timers.splice(index, 1);
    },
    now: () => 0,
  };
  const pendingTimers = () => timers;
  const fireAll = (ms: number) => {
    // Each scheduled timer fires once and is then removed; timers scheduled
    // while firing (a later back-off step) stay for a follow-up fireAll.
    const due = timers.filter((timer) => timer.ms <= ms);
    for (const timer of due) {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
      timer.fn();
    }
  };
  return { env, sent, fireAll, pendingTimers };
}

const moveOp = (id: string, x: number): CanvasOp => ({
  op: "node.update",
  id,
  x,
});
const addOp = (id: string): CanvasOp => ({
  op: "node.add",
  id,
  kind: "text",
  x: 0,
  y: 0,
  width: 120,
  height: 80,
}); // minimal NodeAddOp shape; zod is not involved here
const edgeOp = (id: string, from: string, to: string): CanvasOp => ({
  op: "edge.add",
  id,
  from_node: from,
  to_node: to,
});

const ok = (rev = 1): SendResult => ({ ok: true, rev });
const fail = (error = "boom"): SendResult => ({ ok: false, error });

describe("quiet flush", () => {
  it("waits QUIET_MS then sends the batch and reports the rev", async () => {
    const { env, sent, fireAll, pendingTimers } = makeEnv([ok(7)]);
    const statuses: string[] = [];
    const queue = new SaveQueue(env);
    queue.subscribe((status) => statuses.push(status));

    queue.queue([moveOp("n1", 20)]);
    expect(pendingTimers()).toHaveLength(1);
    expect(pendingTimers()[0]!.ms).toBe(QUIET_MS);
    expect(sent).toHaveLength(0);
    expect(statuses).toContain("saving");

    fireAll(QUIET_MS);
    expect(sent).toEqual([[moveOp("n1", 20)]]);
    await vi.waitFor(() => expect(env.onRev).toHaveBeenCalledWith(7));
    expect(pendingTimers()).toHaveLength(0);

    expect(statuses).toContain("saved");
  });

  it("reschedules on further edits (flushes once at the end)", async () => {
    const { env, sent, fireAll, pendingTimers } = makeEnv([ok(2)]);
    const queue = new SaveQueue(env);
    queue.queue([moveOp("n1", 20)]);
    queue.queue([moveOp("n2", 1)]);
    expect(pendingTimers()).toHaveLength(1);

    fireAll(QUIET_MS);
    expect(sent).toHaveLength(1);
    await vi.waitFor(() => expect(queue.hasPending()).toBe(false));
    expect(sent[0]).toEqual([moveOp("n1", 20), moveOp("n2", 1)]);
  });

  it("flushNow flushes before the quiet timer fires", async () => {
    const { env, sent, pendingTimers } = makeEnv([ok(1)]);
    const queue = new SaveQueue(env);
    queue.queue([addOp("n1")]);
    queue.flushNow();
    expect(pendingTimers()).toHaveLength(0);
    expect(sent).toHaveLength(1);
    await vi.waitFor(() => expect(queue.hasPending()).toBe(false));
  });
});

describe("coalescing (spec: consecutive node.update for one card, last value wins)", () => {
  it("merges consecutive same-card updates into one op", async () => {
    const { env, sent, fireAll } = makeEnv([ok(1)]);
    const queue = new SaveQueue(env);
    queue.queue([moveOp("n1", 20)]);
    queue.queue([moveOp("n1", 40)]);
    queue.queue([{ op: "node.update", id: "n1", body: "hello" }]);
    fireAll(QUIET_MS);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual([
      { op: "node.update", id: "n1", x: 40, body: "hello" },
    ]);
  });

  it("does not merge across an edge op boundary", async () => {
    const { env, sent, fireAll } = makeEnv([ok(1)]);
    const queue = new SaveQueue(env);
    queue.queue([moveOp("n1", 20)]);
    queue.queue([edgeOp("e1", "n1", "n2")]);
    queue.queue([moveOp("n1", 40)]);
    fireAll(QUIET_MS);
    expect(sent[0]).toEqual([
      moveOp("n1", 20),
      edgeOp("e1", "n1", "n2"),
      moveOp("n1", 40),
    ]);
  });

  it("merges into an earlier same-card op while skipping other cards", async () => {
    const { env, sent, fireAll } = makeEnv([ok(1)]);
    const queue = new SaveQueue(env);
    queue.queue([moveOp("n1", 10)]);
    queue.queue([moveOp("n2", 5)]);
    queue.queue([moveOp("n1", 30)]);
    fireAll(QUIET_MS);
    expect(sent[0]).toEqual([moveOp("n1", 30), moveOp("n2", 5)]);
  });
});

describe("batching and order", () => {
  it("sends at most BATCH_LIMIT ops, then the rest in order", async () => {
    const { env, sent, fireAll } = makeEnv([ok(1), ok(2)]);
    const queue = new SaveQueue(env);
    const ops = Array.from({ length: BATCH_LIMIT + 10 }, (_, i) =>
      addOp(`card-${i}`),
    );
    queue.queue(ops);
    fireAll(QUIET_MS);
    await vi.waitFor(() => expect(env.onRev).toHaveBeenCalledWith(2));
    expect(sent).toHaveLength(2);
    expect(sent[0]).toHaveLength(BATCH_LIMIT);
    expect(sent[1]).toHaveLength(10);
    expect(sent[0]![0]).toMatchObject({ id: "card-0" });
    expect(sent[1]![0]).toMatchObject({ id: `card-${BATCH_LIMIT}` });
  });
});

describe("retries and the Could-not-save state (never dropped)", () => {
  it("retries with 2 s then 6 s back-off and succeeds", async () => {
    const { env, sent, fireAll, pendingTimers } = makeEnv([
      fail(),
      fail(),
      ok(3),
    ]);
    const statuses: string[] = [];
    const queue = new SaveQueue(env);
    queue.subscribe((status) => statuses.push(status));

    const batch = [moveOp("n1", 1)];
    queue.queue(batch);
    fireAll(QUIET_MS);
    expect(sent).toHaveLength(1);

    // Wait until the back-off timer of each step is actually scheduled
    // (it is, asynchronously, after the awaited reply returns), then fire it.
    await vi.waitFor(() => expect(pendingTimers()).toHaveLength(1));
    fireAll(RETRY_DELAYS_MS[0]!);
    expect(sent).toHaveLength(2);
    await vi.waitFor(() => expect(pendingTimers()).toHaveLength(1));
    fireAll(RETRY_DELAYS_MS[1]!);
    expect(sent).toHaveLength(3);
    await vi.waitFor(() => expect(statuses).toContain("saved"));
    expect(env.onRev).toHaveBeenCalledWith(3);
    expect(queue.hasPending()).toBe(false);
  });

  it("after three failures the status is error and the ops are kept", async () => {
    const { env, sent, fireAll, pendingTimers } = makeEnv([
      fail(),
      fail(),
      fail(),
      fail(),
    ]);
    const statuses: string[] = [];
    const queue = new SaveQueue(env);
    queue.subscribe((status) => statuses.push(status));

    const batch = [addOp("n1")];
    queue.queue(batch);
    fireAll(QUIET_MS);
    for (let i = 0; i < 3; i++) {
      // Each of the three failed attempts schedules the next back-off.
      await vi.waitFor(() => expect(pendingTimers()).toHaveLength(1));
      fireAll(RETRY_DELAYS_MS[Math.min(i, 2)]!);
    }
    await vi.waitFor(() => expect(statuses).toContain("error"));
    expect(sent).toHaveLength(4);
    expect(queue.hasPending()).toBe(true);

    // Retry (the chip button): clears the back-off count again.
    queue.retry();
    expect(sent).toHaveLength(5);
    expect(sent.at(-1)).toEqual(batch);
  });

  it("a thrown send is a failure, not a drop", async () => {
    const { env, sent, fireAll } = makeEnv([]); // send throws every time
    const queue = new SaveQueue(env);
    const batch = [addOp("n1")];
    queue.queue(batch);
    fireAll(QUIET_MS);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(queue.hasPending()).toBe(true);
  });

  it("a send promise resolves refetch without dropping", async () => {
    const { env, sent, fireAll } = makeEnv([
      { ok: false, error: "Wrong content.", refetch: true },
    ]);
    const queue = new SaveQueue(env);
    queue.queue([addOp("n1")]);
    fireAll(QUIET_MS);
    expect(sent).toHaveLength(1);
    await vi.waitFor(() => expect(queue.hasPending()).toBe(true));
  });
});

describe("offline", () => {
  it("pauses while offline and flushes when back online", async () => {
    const { env, sent, pendingTimers } = makeEnv([ok(1), ok(2)]);
    const statuses: string[] = [];
    const queue = new SaveQueue(env);
    queue.subscribe((status) => statuses.push(status));

    queue.setOnline(false);
    queue.queue([moveOp("n1", 5)]);
    expect(statuses.at(-1)).toBe("offline");
    // No timer and no send while the browser is offline.
    expect(pendingTimers()).toHaveLength(0);
    expect(sent).toHaveLength(0);

    queue.setOnline(true);
    expect(sent).toEqual([[moveOp("n1", 5)]]);
    await vi.waitFor(() => expect(statuses).toContain("saved"));
    expect(queue.hasPending()).toBe(false);
  });

  it("reports saved when going online with an empty queue", () => {
    const { env } = makeEnv([ok(1)]);
    const statuses: string[] = [];
    const queue = new SaveQueue(env);
    queue.subscribe((status) => statuses.push(status));
    queue.setOnline(true);
    expect(statuses.at(-1)).toBe("saved");
  });
});
