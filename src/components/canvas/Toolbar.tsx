"use client";

import SaveStatusChip from "./SaveStatus";
import type { SaveStatus } from "@/lib/canvas/save-queue";
import {
  ALIGN_MODES,
  type AlignMode,
  DISTRIBUTE_AXES,
} from "@/lib/canvas/geometry";
import { CANVAS_COLORS } from "@/lib/canvas/schemas";

/** Plain-language names for the align modes (leader rule: no jargon). */
const ALIGN_LABELS: Record<AlignMode, string> = {
  left: "Line up left edges",
  right: "Line up right edges",
  top: "Line up top edges",
  bottom: "Line up bottom edges",
  hcenter: "Line up middles",
  vcenter: "Line up in a column",
};

const DISTRIBUTE_LABELS: Record<"x" | "y", string> = {
  x: "Spread out across",
  y: "Spread out downwards",
};

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
  /** Align the selection to its shared bounding rectangle (spec 6.2). */
  onAlign: (mode: AlignMode) => void;
  /** Spread the selection evenly on one axis (needs 3+ cards). */
  onDistribute: (axis: "x" | "y") => void;
  /** Pack the selection into reading-order rows. */
  onTidySelection: () => void;
  legend: Record<string, string>;
  onOpenLegend: () => void;
  onOpenVersions: () => void;
  /** Visible search button (spec 6.7) — opens the command palette, also for touch. */
  onOpenPalette: () => void;
  published: boolean;
  onTogglePublished: (published: boolean) => void;
  savingPublish: boolean;
};

export default function Toolbar(props: ToolbarProps) {
  const oneCard =
    props.selectedCardIds.length === 1 ? props.selectedCardIds[0]! : null;

  return (
    <div className="bg-background flex flex-wrap items-center gap-2 border-b p-2 max-md:hidden">
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

      {props.canEdit && props.selectedCardIds.length > 1 ? (
        // Arrange menu (spec 6.2): align, spread and tidy the selection in
        // one place. A details element keeps it script- and focus-simple.
        <details className="relative">
          <summary
            className="cursor-pointer list-none rounded border px-2.5 py-1.5 text-xs font-semibold select-none"
            aria-haspopup="menu"
          >
            Arrange<span aria-hidden="true"> ▾</span>
          </summary>
          <div
            role="menu"
            className="bg-background absolute z-20 mt-1 w-56 rounded border p-1 shadow-md"
          >
            {([...ALIGN_MODES] as readonly AlignMode[]).map((mode) => (
              <MenuRow
                key={mode}
                label={ALIGN_LABELS[mode]}
                onClick={() => props.onAlign(mode)}
              />
            ))}
            {DISTRIBUTE_AXES.map((axis) => (
              <MenuRow
                key={axis}
                label={DISTRIBUTE_LABELS[axis]}
                onClick={() => props.onDistribute(axis)}
              />
            ))}
            <MenuRow
              label="Tidy up selection"
              onClick={props.onTidySelection}
            />
          </div>
        </details>
      ) : null}

      <SaveStatusChip status={props.saveStatus} onRetry={props.onRetrySave} />

      {props.canEdit ? (
        <>
          <button
            type="button"
            onClick={props.onOpenPalette}
            className="rounded border px-2.5 py-1.5 text-[11px] font-semibold"
          >
            Search<span aria-hidden="true"> ⌘</span>
          </button>
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

function MenuRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:bg-accent min-h-9 w-full rounded px-2 text-left text-xs font-semibold"
    >
      {label}
    </button>
  );
}
