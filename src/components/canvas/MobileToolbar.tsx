"use client";

import { useState } from "react";
import SaveStatusChip from "./SaveStatus";
import type { SaveStatus } from "@/lib/canvas/save-queue";
import { CANVAS_COLORS } from "@/lib/canvas/schemas";

/**
 * The phone toolbar (spec 6.8): one bottom row with 44 px targets — Add
 * (+), Connect, Undo, Redo, Fit, More. Add and More open bottom sheets,
 * so every action the desktop toolbar offers stays reachable at 360 px.
 * Hidden from the 768 px breakpoint up (the desktop toolbar takes over).
 */
export type MobileToolbarProps = {
  canEdit: boolean;
  saveStatus: SaveStatus;
  onRetrySave: () => void;
  connectMode: boolean;
  onToggleConnect: () => void;
  onAddText: () => void;
  onAddNote: () => void;
  onAddFile: () => void;
  onAddUpload: () => void;
  onAddLink: () => void;
  onAddGroup: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onFit: () => void;
  /** Pack every card into reading-order rows (spec 6.2 More → Tidy up). */
  onTidyAll: () => void;
  selectedCount: number;
  onRemoveSelected: () => void;
  legend: Record<string, string>;
  onRecolour: (color: string | null) => void;
  onOpenLegend: () => void;
  onOpenVersions: () => void;
  published: boolean;
  onTogglePublished: (published: boolean) => void;
  savingPublish: boolean;
};

export default function MobileToolbar(props: MobileToolbarProps) {
  const [sheet, setSheet] = useState<"add" | "more" | null>(null);
  const closeSheet = () => setSheet(null);

  const run = (action: () => void) => {
    closeSheet();
    action();
  };

  return (
    <>
      <div
        className="bg-background fixed inset-x-0 bottom-0 z-30 border-t"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center justify-center py-1">
          <SaveStatusChip
            status={props.saveStatus}
            onRetry={props.onRetrySave}
          />
        </div>
        <div className="flex items-stretch justify-around gap-1 px-1 pb-1">
          {props.canEdit ? (
            <BigButton label="Add" onClick={() => setSheet("add")} />
          ) : null}
          {props.canEdit ? (
            <BigButton
              label={props.connectMode ? "Stop linking" : "Connect"}
              onClick={props.onToggleConnect}
              pressed={props.connectMode}
            />
          ) : null}
          {props.canEdit && props.canUndo ? (
            <BigButton label="Undo" onClick={props.onUndo} />
          ) : null}
          {props.canEdit && props.canRedo ? (
            <BigButton label="Redo" onClick={props.onRedo} />
          ) : null}
          <BigButton label="Fit" onClick={props.onFit} />
          <BigButton
            label="More"
            onClick={() => setSheet("more")}
            aria-expanded={sheet === "more"}
          />
        </div>
      </div>

      {sheet === "add" ? (
        <Sheet label="Add to the map">
          <SheetButton label="Text" onClick={() => run(props.onAddText)} />
          <SheetButton label="Note" onClick={() => run(props.onAddNote)} />
          <SheetButton label="File" onClick={() => run(props.onAddFile)} />
          <SheetButton
            label="Upload from this device"
            onClick={() => run(props.onAddUpload)}
          />
          <SheetButton label="Link" onClick={() => run(props.onAddLink)} />
          <SheetButton label="Group" onClick={() => run(props.onAddGroup)} />
          <SheetButton label="Close" onClick={closeSheet} />
        </Sheet>
      ) : null}

      {sheet === "more" ? (
        <Sheet label="More actions">
          {props.canEdit ? (
            <>
              {props.selectedCount > 0 ? (
                <SheetButton
                  label={
                    props.selectedCount === 1
                      ? "Remove the selected card from the map"
                      : `Remove ${props.selectedCount} cards from the map`
                  }
                  onClick={() => run(props.onRemoveSelected)}
                />
              ) : null}
              <div className="px-3 py-2">
                <div className="text-muted-foreground mb-1 text-[11px] font-semibold">
                  Colour the selected cards
                </div>
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  {CANVAS_COLORS.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      aria-label={`Colour ${slot}${props.legend[slot] ? `: ${props.legend[slot]}` : ""}`}
                      onClick={() => run(() => props.onRecolour(slot))}
                      className="border-border h-11 w-11 rounded-md border"
                    >
                      <span
                        className="block h-full w-full rounded-[6px]"
                        style={{ background: `var(--canvas-${slot})` }}
                      />
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-label="No colour"
                    onClick={() => run(() => props.onRecolour(null))}
                    className="bg-background border-border h-11 w-11 rounded-md border text-xs font-semibold"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <SheetButton
                label="Legend"
                onClick={() => run(props.onOpenLegend)}
              />
              <SheetButton
                label="Tidy up"
                onClick={() => run(props.onTidyAll)}
              />
              <SheetButton
                label="Backups"
                onClick={() => run(props.onOpenVersions)}
              />
              <label className="flex min-h-11 items-center justify-between gap-2 rounded px-3 py-2 text-sm font-semibold">
                <span>
                  {props.published
                    ? "Students can see"
                    : "Hidden from students"}
                </span>
                <input
                  type="checkbox"
                  checked={props.published}
                  disabled={props.savingPublish}
                  onChange={(event) =>
                    props.onTogglePublished(event.target.checked)
                  }
                  className="accent-foreground h-4 w-4"
                />
              </label>
            </>
          ) : null}
          <SheetButton label="Close" onClick={closeSheet} />
        </Sheet>
      ) : null}
    </>
  );
}

function BigButton({
  label,
  onClick,
  pressed = false,
  ariaExpanded,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  ariaExpanded?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed || undefined}
      aria-expanded={ariaExpanded}
      className={[
        "min-h-11 min-w-11 flex-1 flex-col items-center justify-center rounded-lg text-[11px] font-semibold",
        pressed ? "bg-primary text-primary-foreground" : "",
        pressed ? "" : "hover:bg-accent",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function Sheet({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 bg-black/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="bg-background fixed inset-x-0 bottom-0 max-h-[70dvh] overflow-y-auto rounded-t-xl border-t p-2"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
      >
        <h2 className="text-sm font-bold">{label}</h2>
        {children}
      </div>
    </div>
  );
}

function SheetButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:bg-accent min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm font-semibold"
    >
      {label}
    </button>
  );
}
