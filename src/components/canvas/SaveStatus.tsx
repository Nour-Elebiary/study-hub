"use client";

export type SaveStatus = "saved" | "saving" | "error";

/**
 * The plain-language saving chip (spec 5.6): Saved / Saving… / Could not
 * save — with a visible retry when a batch failed.
 */
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
        className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium"
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
        className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium opacity-80"
      >
        Saving…
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <span
        role="alert"
        className="bg-destructive/10 text-destructive rounded-full border border-destructive/40 px-2.5 py-1 text-[11px] font-semibold"
      >
        Could not save
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="bg-destructive/10 text-destructive rounded-full border border-destructive/40 px-2.5 py-1 text-[11px] font-semibold"
      >
        Try again
      </button>
    </span>
  );
}
