import { beforeEach, describe, expect, it } from "vitest";
import {
  acquireThumbnailSlot,
  releaseThumbnailSlot,
  resetThumbnailQueue,
  thumbnailsInFlight,
  thumbnailsWaiting,
} from "@/lib/canvas/thumbnail-queue";

/**
 * The queue keeps at most six signed-URL requests in flight and hands a
 * released slot to the oldest waiter (CANVAS-SPEC 6.10). Each `it` block
 * starts from the module's fresh state, so the counts below are exact.
 */
describe("thumbnail queue", () => {
  beforeEach(() => resetThumbnailQueue());

  it("allows six requests at once and queues the seventh", async () => {
    const started: Promise<void>[] = [];
    for (let i = 0; i < 6; i += 1) started.push(acquireThumbnailSlot());
    void acquireThumbnailSlot(); // the seventh waits
    await Promise.all(started);
    expect(thumbnailsInFlight()).toBe(6);
    expect(thumbnailsWaiting()).toBe(1);

    // The released slot skips the idle state and goes to the waiter.
    releaseThumbnailSlot();
    expect(thumbnailsInFlight()).toBe(6);
    expect(thumbnailsWaiting()).toBe(0);

    // With nobody waiting, releases count down to zero.
    for (let i = 6; i > 0; i -= 1) releaseThumbnailSlot();
    expect(thumbnailsInFlight()).toBe(0);
  });

  it("hands released slots to waiters in first-come order", async () => {
    const started: Promise<void>[] = [];
    for (let i = 0; i < 6; i += 1) started.push(acquireThumbnailSlot());
    const first = acquireThumbnailSlot();
    const second = acquireThumbnailSlot();
    await Promise.all(started);
    expect(thumbnailsWaiting()).toBe(2);

    const order: string[] = [];
    void first.then(() => order.push("first"));
    void second.then(() => order.push("second"));
    // Nothing has resolved yet, so both slots are still held.
    expect(order).toEqual([]);
    releaseThumbnailSlot();
    await first;
    releaseThumbnailSlot();
    await second;
    expect(order).toEqual(["first", "second"]);
    expect(thumbnailsInFlight()).toBe(6);
  });
});
