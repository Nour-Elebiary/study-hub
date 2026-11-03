"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateLegendAction } from "@/app/(leader)/courses/[courseId]/canvas/actions";

/**
 * The legend editor (spec 5.6): every colour slot gets a plain-language name
 * the leader writes ("red = important for the exam"). Saved together, never
 * colour alone (constitution rule 6, accessibility).
 */
export default function LegendEditor({
  canvasId,
  legend,
  open,
  onClose,
}: {
  canvasId: string;
  legend: Record<string, string>;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open) return null;

  return (
    // Native <dialog>: focus trap + Esc handled by the browser.
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      className="rounded-xl p-4 backdrop:bg-black/40"
    >
      <form
        action={async (formData: FormData) => {
          setSaving(true);
          setError(null);
          const names: Record<string, string> = {};
          for (const slot of ["1", "2", "3", "4", "5", "6"]) {
            const value = String(formData.get(`colour-${slot}`) ?? "").trim();
            if (value) names[slot] = value;
          }
          const result = await updateLegendAction(canvasId, names);
          setSaving(false);
          if (result.error) {
            setError(result.error);
            return;
          }
          router.refresh();
          onClose();
        }}
      >
        <h2 className="text-sm font-bold">Name each colour</h2>
        <p className="text-muted-foreground mt-1 mb-3 text-xs">
          Colour alone is never the only signal — give every colour you use a
          plain name.
        </p>
        <div className="grid gap-2">
          {(["1", "2", "3", "4", "5", "6"] as const).map((slot) => (
            <label key={slot} className="flex items-center gap-2 text-xs">
              <span
                aria-hidden="true"
                className="border-border inline-block h-6 w-6 rounded border"
                style={{ background: `var(--canvas-${slot})` }}
              />
              <span className="sr-only">Colour {slot}</span>
              <input
                name={`colour-${slot}`}
                defaultValue={legend[slot] ?? ""}
                maxLength={80}
                placeholder={`What colour ${slot} means`}
                className="w-full rounded border px-2 py-1.5"
              />
            </label>
          ))}
        </div>
        {error ? (
          <p role="alert" className="text-destructive mt-2 text-xs">
            {error}
          </p>
        ) : null}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border px-3 py-1.5 text-xs font-semibold"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="bg-foreground text-background rounded px-3 py-1.5 text-xs font-semibold"
          >
            {saving ? "Saving…" : "Save legend"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
