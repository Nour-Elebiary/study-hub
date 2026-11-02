"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listVersionsAction,
  restoreVersionAction,
  saveVersionAction,
} from "@/app/(leader)/courses/[courseId]/canvas/actions";

type VersionRow = {
  id: string;
  versionNo: number;
  label: string | null;
  auto: boolean;
  createdAt: string;
};

const format = (iso: string): string => {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
};

/**
 * The versions sheet (spec 5.5, M9 editor scope): save a named backup,
 * restore one. Automatic backups (taken after 30 idle minutes) are marked;
 * restoring puts a "Before restore" backup back automatically (RPC).
 */
export default function VersionsSheet({
  canvasId,
  open,
  onClose,
}: {
  canvasId: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setVersions(null);
      setError(null);
      void listVersionsAction(canvasId).then((result) => {
        if ("versions" in result) setVersions(result.versions);
        else setError(result.error);
      });
    }
    if (!open && dialog.open) dialog.close();
  }, [open, canvasId]);

  if (!open) return null;

  const refresh = () => {
    router.refresh();
    void listVersionsAction(canvasId).then((result) => {
      if ("versions" in result) setVersions(result.versions);
    });
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      className="rounded-xl p-4 backdrop:bg-black/40"
    >
      <h2 className="text-sm font-bold">Backups of this map</h2>
      <p className="text-muted-foreground mt-1 mb-3 text-xs">
        The app saves a backup automatically at most every 30 minutes of
        editing. Name one yourself before a big change — named backups are
        never deleted.
      </p>

      <form
        action={async (formData: FormData) => {
          if (!formData.get("label")) {
            setError("Give the backup a name first, for example \"Before exam week\".");
            return;
          }
          setBusy(true);
          setError(null);
          const result = await saveVersionAction(null, formData);
          setBusy(false);
          if (result && "error" in result && result.error) {
            setError(result.error);
            return;
          }
          refresh();
        }}
        className="flex gap-2"
      >
        <input type="hidden" name="canvas_id" value={canvasId} />
        <label className="grow">
          <span className="sr-only">Backup name</span>
          <input
            name="label"
            maxLength={120}
            placeholder="Backup name, e.g. Before exam week"
            className="w-full rounded border px-2 py-1.5 text-xs"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="bg-foreground text-background rounded px-3 py-1.5 text-xs font-semibold"
        >
          Save backup
        </button>
      </form>

      {error ? (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {error}
        </p>
      ) : null}

      <ul className="mt-3 grid max-h-64 gap-1.5 overflow-y-auto">
        {(versions ?? []).map((version) => (
          <li
            key={version.id}
            className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs"
          >
            <span className="min-w-0">
              <span className="block truncate">
                {version.label
                  ? version.label
                  : version.auto
                    ? "Automatic backup"
                    : `Backup #${version.versionNo}`}
              </span>
              <span className="text-muted-foreground text-[10px]">
                {format(version.createdAt)}
                {version.auto ? " · automatic" : ""}
              </span>
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const formData = new FormData();
                formData.set("canvas_id", canvasId);
                formData.set("version_id", version.id);
                const result = await restoreVersionAction(null, formData);
                setBusy(false);
                if (result && "error" in result && result.error) {
                  setError(result.error);
                  return;
                }
                refresh();
              }}
              className="shrink-0 rounded border px-2.5 py-1.5 text-[11px] font-semibold"
            >
              Restore
            </button>
          </li>
        ))}
        {versions && versions.length === 0 ? (
          <li className="text-muted-foreground text-xs">
            No backups yet — they appear as you edit.
          </li>
        ) : null}
        {versions === null && !error ? (
          <li className="text-muted-foreground text-xs">Loading…</li>
        ) : null}
      </ul>

      <div className="mt-3 flex justify-end">
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
