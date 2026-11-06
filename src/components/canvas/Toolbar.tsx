"use client";

import SaveStatusChip from "./SaveStatus";
import type { SaveStatus } from "@/lib/canvas/save-queue";
import { CANVAS_COLORS } from "@/lib/canvas/schemas";

/**
 * The editor toolbar (spec 5.6, M9 basic scope). Plain-language buttons,
 * colour row with the written legend slot names, publish switch, saving
 * chip. Mobile-first: the row wraps naturally at 360 px, every button has
 * at least a 40 px tall target.
 */
export type ToolbarProps = {
  canEdit: boolean;
  saveStatus: SaveStatus;
  onRetrySave: () => void;
  onAddText: () => void;
  onAddNote: () => void;
  onAddFile: () => void;
  /** "Add file from computer" — the drag-drop pipeline with a picker. */
  onAddUpload: () => void;
  onAddGroup: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  selectedCardIds: string[];
  onRecolour: (color: string | null) => void;
  onRemoveSelected: () => void;
  legend: Record<string, string>;
  onOpenLegend: () => void;
  onOpenVersions: () => void;
  published: boolean;
  onTogglePublished: (published: boolean) => void;
  savingPublish: boolean;
};

export default function Toolbar(props: ToolbarProps) {
  const oneCard =
    props.selectedCardIds.length === 1 ? props.selectedCardIds[0]! : null;

  return (
    <div className="bg-background flex flex-wrap items-center gap-2 border-b p-2">
      {props.canEdit ? (
        <>
          <AddButton label="Add text card" onClick={props.onAddText} />
          <AddButton label="Add note" onClick={props.onAddNote} />
          <AddButton label="Add file" onClick={props.onAddFile} />
          <AddButton
            label="Add file from computer"
            onClick={props.onAddUpload}
          />
          <AddButton label="Add group" onClick={props.onAddGroup} />
        </>
      ) : null}

      {props.canEdit && props.canUndo ? (
        <button
          type="button"
          onClick={props.onUndo}
          className="rounded border px-2.5 py-1.5 text-xs font-semibold"
        >
          Undo
        </button>
      ) : null}

      {props.canEdit && props.canRedo ? (
        <button
          type="button"
          onClick={props.onRedo}
          className="rounded border px-2.5 py-1.5 text-xs font-semibold"
        >
          Redo
        </button>
      ) : null}

      {props.canEdit && oneCard ? (
        <div className="flex items-center gap-1 rounded border p-1">
          {CANVAS_COLORS.map((slot) => (
            <button
              key={slot}
              type="button"
              aria-label={`Colour ${slot}${props.legend[slot] ? `: ${props.legend[slot]}` : ""}`}
              title={props.legend[slot] ?? `Colour ${slot}`}
              onClick={() => props.onRecolour(slot)}
              className="border-border h-7 w-7 rounded border"
            >
              <span
                className="block h-full w-full rounded"
                style={{ background: `var(--canvas-${slot})` }}
              />
            </button>
          ))}
          <button
            type="button"
            aria-label="No colour"
            title="No colour"
            onClick={() => props.onRecolour(null)}
            className="bg-background border-border h-7 w-7 rounded border text-[10px] leading-none"
          >
            ✕
          </button>
          <button
            type="button"
            onClick={() => props.onRemoveSelected()}
            className="text-destructive ml-1 px-1 text-xs font-semibold"
          >
            Remove from map
          </button>
        </div>
      ) : null}

      {props.canEdit && props.selectedCardIds.length > 1 ? (
        <button
          type="button"
          onClick={props.onRemoveSelected}
          className="text-destructive rounded border px-2.5 py-1.5 text-xs font-semibold"
        >
          Remove {props.selectedCardIds.length} cards from map
        </button>
      ) : null}

      <SaveStatusChip status={props.saveStatus} onRetry={props.onRetrySave} />

      {props.canEdit ? (
        <>
          <button
            type="button"
            onClick={props.onOpenLegend}
            className="rounded border px-2.5 py-1.5 text-[11px] font-semibold"
          >
            Legend
          </button>
          <button
            type="button"
            onClick={props.onOpenVersions}
            className="rounded border px-2.5 py-1.5 text-[11px] font-semibold"
          >
            Backups
          </button>
        </>
      ) : null}

      {props.canEdit ? (
        <label className="flex items-center gap-1.5 rounded border px-2 py-1.5 text-[11px] font-semibold">
          <input
            type="checkbox"
            checked={props.published}
            disabled={props.savingPublish}
            onChange={(event) => props.onTogglePublished(event.target.checked)}
            className="accent-foreground h-4 w-4"
          />
          {props.published ? "Students can see" : "Hidden from students"}
        </label>
      ) : null}
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border px-2.5 py-1.5 text-xs font-semibold"
    >
      {label}
    </button>
  );
}
