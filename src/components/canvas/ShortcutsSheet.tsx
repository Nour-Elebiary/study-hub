"use client";

import { useEffect, useRef } from "react";
import { CANVAS_SHORTCUTS } from "@/lib/canvas/shortcuts";

/**
 * The `?` shortcut sheet (CANVAS-SPEC section 6.3): the one plain-language
 * table the editor shows, generated from CANVAS_SHORTCUTS so it can never
 * drift from the real key handling. Same native-dialog pattern as the
 * versions sheet — Escape closes it, focus stays trapped by the browser.
 */
export default function ShortcutsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      className="max-w-[90dvw] rounded-lg border p-4 backdrop:bg-black/40"
      aria-label="Keyboard shortcuts"
    >
      <h2 className="text-base font-bold">Keyboard shortcuts</h2>
      <p className="text-muted-foreground mt-1 text-xs">
        Every shortcut on the map editor. Shortcuts are ignored while you are
        typing in a card.
      </p>
      <table className="mt-3 text-xs">
        <thead>
          <tr>
            <th scope="col" className="pr-4 pb-1 text-left">
              Keys
            </th>
            <th scope="col" className="pb-1 text-left">
              What it does
            </th>
          </tr>
        </thead>
        <tbody>
          {CANVAS_SHORTCUTS.map((shortcut) => (
            <tr key={shortcut.action}>
              <td className="py-0.5 pr-4 font-mono whitespace-nowrap">
                {shortcut.keys.join(" · ")}
              </td>
              <td className="py-0.5">{shortcut.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 text-right">
        <button
          type="button"
          onClick={onClose}
          className="rounded border px-3 py-1.5 text-xs font-semibold"
        >
          Close
        </button>
      </div>
    </dialog>
  );
}
