/**
 * Thumbnail request slots (CANVAS-SPEC section 6.10 performance budget):
 * at most 6 signed-URL requests in flight. A card acquires a slot before
 * asking storage for a signed URL and releases it when the request
 * settles, so a big map never fires dozens of storage calls at once.
 * PURE BOOKKEEPING — no browser types, so the unit test runs it bare.
 */
const MAX_IN_FLIGHT = 6;

let inFlight = 0;
const waiters: Array<() => void> = [];

/** Resolves once a slot is free and held for the caller. */ export function acquireThumbnailSlot(): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    // The resolver deliberately does NOT bump the count: the slot is
    // transferred from the releaser, so the number in flight stays the same.
    waiters.push(resolve);
  });
}

/** Gives the slot back; the longest-waiting caller takes it over. */
export function releaseThumbnailSlot(): void {
  const next = waiters.shift();
  if (next) next();
  else inFlight = Math.max(0, inFlight - 1);
}

/** Test hook: current in-flight count (the real limit stays frozen). */
export function thumbnailsInFlight(): number {
  return inFlight;
}

/** Test hook: queued-but-not-started callers. */
export function thumbnailsWaiting(): number {
  return waiters.length;
}

/** Test hook: empties the queue so a test starts from a known state. */
export function resetThumbnailQueue(): void {
  inFlight = 0;
  waiters.length = 0;
}
