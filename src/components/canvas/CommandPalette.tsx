"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  listCanvasesAction,
  listPickerNotesAction,
} from "@/app/(leader)/courses/[courseId]/canvas/actions";
import type { PickerNote } from "./payload";

/** A card currently on the map (palette group "Cards on this map"). */
export type PaletteCard = { id: string; title: string; kind: string };

/**
 * The command palette (spec 6.7), built on cmdk (MIT). Ctrl/Cmd+K or the
 * toolbar search button opens it. Groups: cards on this map, course notes
 * that are not on the map yet, actions, the course's other maps. Matching
 * lowercases text through cmdk's own scorer; the Arabic normaliser joins
 * with M12. Fully keyboard operable (arrows + Enter) with a visible empty
 * state.
 */
export function CommandPalette({
  open,
  onOpenChange,
  courseId,
  canvasId,
  cardsOnMap,
  mappedNoteIds,
  onPickCard,
  onAddNote,
  onNewTextCard,
  onNewGroup,
  onTidy,
  onFit,
  onSaveVersion,
  snap,
  onToggleSnap,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  canvasId: string;
  cardsOnMap: PaletteCard[];
  /** Note ids already on the map — they are hidden from "Add to map". */
  mappedNoteIds: readonly string[];
  onPickCard: (cardId: string) => void;
  onAddNote: (note: PickerNote) => void;
  onNewTextCard: () => void;
  onNewGroup: () => void;
  onTidy: () => void;
  onFit: () => void;
  onSaveVersion: () => void;
  snap: boolean;
  onToggleSnap: () => void;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState<PickerNote[] | null>(null);
  const [canvases, setCanvases] = useState<
    { id: string; title: string; isDefault: boolean }[] | null
  >(null);

  // Loads run on open, outside the synchronous effect body (React compiler
  // rule). A failed load stays empty — the palette still lists cards and
  // actions.
  useEffect(() => {
    if (!open) return;
    let dead = false;
    if (notes === null) {
      void listPickerNotesAction(courseId).then((result) => {
        if (dead) return;
        setNotes(result && "ok" in result ? result.notes : []);
      });
    }
    if (canvases === null) {
      void listCanvasesAction(courseId).then((result) => {
        if (dead) return;
        setCanvases(result && "ok" in result ? result.canvases : []);
      });
    }
    return () => {
      dead = true;
    };
  }, [open, notes, canvases, courseId]);

  const close = () => onOpenChange(false);
  const run = (action: () => void) => {
    close();
    action();
  };

  const unmappedNotes = (notes ?? []).filter(
    (note) => !mappedNoteIds.includes(note.id),
  );

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      loop
      overlayClassName="fixed inset-0 z-50 bg-black/40"
      contentClassName="bg-background fixed top-[15%] left-1/2 z-50 w-[min(34rem,92vw)] -translate-x-1/2 overflow-hidden rounded-lg border shadow-xl"
    >
      <Command.Input
        placeholder="Search the map…"
        className="w-full border-b px-3 py-3 text-sm outline-none"
        aria-label="Search the map"
      />
      <Command.List className="max-h-[28rem] overflow-y-auto p-1.5">
        <Command.Empty className="text-muted-foreground px-3 py-6 text-center text-sm">
          No matches.
        </Command.Empty>

        {cardsOnMap.length > 0 ? (
          <Command.Group
            heading="Cards on this map"
            className="px-2 py-1 text-xs font-semibold tracking-wide [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1"
          >
            {cardsOnMap.map((card) => (
              <Command.Item
                key={card.id}
                value={`${card.title} ${card.kind}`}
                onSelect={() => run(() => onPickCard(card.id))}
                className="text-foreground data-[selected=true]:bg-accent flex items-center gap-2 rounded px-2 py-2 text-sm"
              >
                <span aria-hidden="true">
                  {card.kind === "note"
                    ? "📝"
                    : card.kind === "file"
                      ? "📎"
                      : card.kind === "link"
                        ? "🔗"
                        : card.kind === "group"
                          ? "🗂️"
                          : "💬"}
                </span>
                <span className="truncate" dir="auto">
                  {card.title || "Untitled card"}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}

        {unmappedNotes.length > 0 ? (
          <Command.Group
            heading="Notes in this course (not on the map)"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold"
          >
            {unmappedNotes.slice(0, 40).map((note) => (
              <Command.Item
                key={note.id}
                value={`note ${note.title} ${note.area}`}
                onSelect={() => run(() => onAddNote(note))}
                className="data-[selected=true]:bg-accent flex items-center gap-2 rounded px-2 py-2 text-sm"
              >
                <span aria-hidden="true">➕</span>
                <span className="truncate" dir="auto">
                  Add to map: {note.title || "Untitled note"}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}

        <Command.Group
          heading="Actions"
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold"
        >
          <Command.Item
            value="new text card"
            onSelect={() => run(onNewTextCard)}
            className="data-[selected=true]:bg-accent flex items-center gap-2 rounded px-2 py-2 text-sm"
          >
            <span aria-hidden="true">💬</span> New text card
          </Command.Item>
          <Command.Item
            value="new group"
            onSelect={() => run(onNewGroup)}
            className="data-[selected=true]:bg-accent flex items-center gap-2 rounded px-2 py-2 text-sm"
          >
            <span aria-hidden="true">🗂️</span> New group
          </Command.Item>
          <Command.Item
            value="tidy up"
            onSelect={() => run(onTidy)}
            className="data-[selected=true]:bg-accent flex items-center gap-2 rounded px-2 py-2 text-sm"
          >
            <span aria-hidden="true">🧹</span> Tidy up the map
          </Command.Item>
          <Command.Item
            value="fit view"
            onSelect={() => run(onFit)}
            className="data-[selected=true]:bg-accent flex items-center gap-2 rounded px-2 py-2 text-sm"
          >
            <span aria-hidden="true">🔍</span> Fit everything on screen
          </Command.Item>
          <Command.Item
            value="save version"
            onSelect={() => run(onSaveVersion)}
            className="data-[selected=true]:bg-accent flex items-center gap-2 rounded px-2 py-2 text-sm"
          >
            <span aria-hidden="true">💾</span> Save a named version
          </Command.Item>
          <Command.Item
            value="toggle snap"
            onSelect={() => onToggleSnap()}
            className="data-[selected=true]:bg-accent flex items-center gap-2 rounded px-2 py-2 text-sm"
          >
            <span aria-hidden="true">🧲</span> Snap cards to the grid:{" "}
            {snap ? "On" : "Off"}
          </Command.Item>
          <Command.Item
            value="outline"
            onSelect={() =>
              run(() => router.push(`/courses/${courseId}/canvas`))
            }
            className="data-[selected=true]:bg-accent flex items-center gap-2 rounded px-2 py-2 text-sm"
          >
            <span aria-hidden="true">🪧</span> Switch between map and outline
          </Command.Item>
        </Command.Group>

        {canvases !== null ? (
          <Command.Group
            heading="Maps"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold"
          >
            {canvases.map((canvas) => (
              <Command.Item
                key={canvas.id}
                value={`map ${canvas.title}`}
                onSelect={() =>
                  canvas.id === canvasId
                    ? close()
                    : run(() =>
                        router.push(`/courses/${courseId}/canvas/${canvas.id}`),
                      )
                }
                className="data-[selected=true]:bg-accent flex items-center gap-2 rounded px-2 py-2 text-sm"
              >
                <span aria-hidden="true">🗺️</span>
                <span className="truncate" dir="auto">
                  {canvas.title}
                  {canvas.id === canvasId ? " (this map)" : ""}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}
      </Command.List>
    </Command.Dialog>
  );
}
