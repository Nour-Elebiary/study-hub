"use client";

/**
 * The plain-language saving chip (spec 5.6, extended in 6.4): Saved /
 * Saving… / Offline / Could not save — with a visible retry when a batch
 * failed. The status union lives in the pure save queue so editor and chip
 * can never disagree.
 */
import type { SaveStatus } from "@/lib/canvas/save-queue";

export default function SaveStatusChip({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry: () => void;
}) {
  if (status === "saved") {
    return (
      <span
        role="status"
        className="border-border rounded-full border px-2.5 py-1 text-[11px] font-medium"
      >
        Saved
      </span>
    );
  }
  if (status === "saving") {
    return (
      <span
        role="status"
        aria-live="polite"
        className="border-border rounded-full border px-2.5 py-1 text-[11px] font-medium opacity-80"
      >
        Saving…
      </span>
    );
  }
  if (status === "offline") {
    return (
      <span
        role="status"
        aria-live="polite"
        className="rounded-full border border-yellow-500/50 bg-yellow-500/10 px-2.5 py-1 text-[11px] font-semibold"
      >
        Offline
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <span
        role="alert"
        className="bg-destructive/10 text-destructive border-destructive/40 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
      >
        Could not save
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="bg-destructive/10 text-destructive border-destructive/40 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
      >
        Try again
      </button>
    </span>
  );
}
