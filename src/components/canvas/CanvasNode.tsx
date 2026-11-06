"use client";

import Link from "next/link";
import {
  Handle,
  Position,
  NodeResizer,
  useStore,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import NoteCard from "./cards/NoteCard";
import FileCard from "./cards/FileCard";
import TextCard from "./cards/TextCard";
import LinkCard from "./cards/LinkCard";
import GroupCard from "./cards/GroupCard";
import type { NoteTarget, FileTarget } from "./payload";
import { useCanvasContext } from "./editor-context";
import { GRID_SIZE } from "@/lib/canvas/defaults";
import type { CanvasCard } from "@/lib/canvas/types";

/**
 * One CanvasCard rendered as one React Flow node (CANVAS-SPEC section 5.6).
 * Shared by the leader editor and the student viewer ("the same renderer");
 * the mode only changes interactivity. Exported nodeTypes are declared at
 * MODULE level, never inside a component.
 */

export type CanvasNodeData = {
  card: CanvasCard;
  note?: NoteTarget;
  file?: FileTarget;
  /** Leader sessions get chrome + thumbnails; students get the lean view. */
  leader: boolean;
};

export type CanvasFlowNode = Node<CanvasNodeData>;

const ICONS: Record<CanvasCard["kind"], string> = {
  note: "📝",
  file: "📎",
  text: "💬",
  link: "🔗",
  group: "🗂️",
};

/** Below this zoom cards degrade to icon + title (level of detail). */
const LOD_ZOOM = 0.4;

const styleFor = (card: CanvasCard): React.CSSProperties => {
  const style: React.CSSProperties = {
    width: "100%",
    height: "100%",
    borderRadius: 10,
    background: card.color ? `var(--canvas-${card.color})` : undefined,
    borderColor: card.color ? `var(--canvas-${card.color})` : undefined,
  };
  if (card.kind === "group") {
    style.boxShadow = "inset 0 0 0 2px rgba(0,0,0,0.12)";
  } else {
    style.boxShadow = "0 1px 3px rgba(0,0,0,0.18)";
  }
  return style;
};

function CanvasNodeInner(props: NodeProps<CanvasFlowNode>) {
  const { data, selected } = props;
  const card = data.card;
  const leader = data.leader;
  const { removeCard, toggleStudentVisible } = useCanvasContext();
  const zoom = useStore((store) => store.transform[2]);
  const detailed = zoom >= LOD_ZOOM;

  // The eye toggle lives on text, link and group cards only (spec 6.2);
  // note and file visibility is managed in their own menus.
  const hasEyeToggle =
    leader &&
    (card.kind === "text" || card.kind === "link" || card.kind === "group");

  const title = (function () {
    switch (card.kind) {
      case "note":
        return card.label || data.note?.title || "Note";
      case "file":
        return card.label || data.file?.name || "File";
      case "link":
        return card.label;
      case "group":
        return card.label || "Group";
      default:
        return null;
    }
  })();

  const detail = detailed ? (
    card.kind === "note" ? (
      <NoteCard data={{ card, note: data.note, leader }} />
    ) : card.kind === "file" ? (
      <FileCard data={{ card, file: data.file, leader }} />
    ) : card.kind === "text" ? (
      <TextCard data={{ card }} />
    ) : card.kind === "link" ? (
      <LinkCard data={{ card }} />
    ) : (
      <GroupCard data={{ card }} />
    )
  ) : (
    // Level of detail: icon + title only, no Markdown, no thumbnails.
    <div className="flex h-full items-center gap-1.5 px-2">
      <span aria-hidden="true">{ICONS[card.kind]}</span>
      <span className="truncate text-xs font-semibold" dir="auto">
        {title ?? ""}
      </span>
    </div>
  );

  // The link layer (spec 5.6/5.7) lives here in the wrapper, never inside
  // the pure cards: students tap a note card to open the note, a link card
  // always opens in a new tab, and a file card downloads when the file is
  // downloadable. Leaders keep the cards inert (editing chrome instead).
  const maybeLinked =
    !leader && detailed && card.kind === "note" && card.nodeId
      ? `/s/notes/${card.nodeId}`
      : card.kind === "link" && card.url
        ? card.url
        : !leader &&
            detailed &&
            card.kind === "file" &&
            card.assetId &&
            data.file?.downloadable
          ? `/s/download/${card.assetId}`
          : null;
  const linked = maybeLinked ? (
    // React Flow puts `pointer-events: none` inline on every node wrapper
    // that is not selectable, draggable or wired to click handlers — the
    // student viewer is exactly that, so these cards would never be
    // tappable (and the student could not open a note or download a file
    // from the map, spec 5.7). The link layer restores pointer events.
    <Link
      href={maybeLinked}
      target={card.kind === "link" ? "_blank" : undefined}
      rel={card.kind === "link" ? "noopener noreferrer" : undefined}
      className="pointer-events-auto block h-full w-full rounded-[10px]"
    >
      {detail}
    </Link>
  ) : (
    detail
  );

  return (
    <div
      className={[
        "relative h-full w-full border",
        selected ? "border-ring ring-ring/50 ring-2" : "border-border",
        card.kind === "group" ? "rounded-xl" : "rounded-[10px]",
      ].join(" ")}
      style={styleFor(card)}
    >
      {leader && selected ? (
        <NodeResizer minWidth={80} minHeight={40} isVisible />
      ) : null}

      {linked}

      {leader && selected && card.kind !== "group" ? (
        <button
          type="button"
          onClick={() => removeCard(card.id)}
          className="bg-background text-destructive absolute -top-2 -right-2 z-10 rounded-full border px-2 py-0.5 text-[11px] font-semibold shadow"
        >
          Remove from map
        </button>
      ) : null}

      {leader && selected && hasEyeToggle ? (
        <button
          type="button"
          onClick={() => toggleStudentVisible(card.id, !card.studentVisible)}
          aria-label={
            card.studentVisible ? "Hide from students" : "Show to students"
          }
          title={
            card.studentVisible ? "Hide from students" : "Show to students"
          }
          className="bg-background absolute -top-2 -left-2 z-10 rounded-full border px-2 py-0.5 text-[11px] shadow"
        >
          <span aria-hidden="true">{card.studentVisible ? "👁" : "🙈"}</span>
        </button>
      ) : null}

      {leader
        ? // Four connection handles per card (connection mode is loose, so
          // the same handle serves as source and target). Hidden in viewers.
          SIDES_A.map((side) => (
            <Handle
              key={side.position}
              type="source"
              id={side.position}
              position={side.position}
              isConnectable
            />
          ))
        : null}
    </div>
  );
}

const SIDES_A = [
  { position: Position.Top },
  { position: Position.Right },
  { position: Position.Bottom },
  { position: Position.Left },
] as const;

/** Snapping helper used by the editor when it emits position ops. */
export const snapToGrid = (value: number): number =>
  Math.round(value / GRID_SIZE) * GRID_SIZE;

// Prepared for multi registration: one component per kind. Since the inner
// component branches on the card kind itself, all five aliases share it.
const CanvasNode = CanvasNodeInner;

export const canvasNodeTypes: NodeTypes = {
  note: CanvasNode,
  file: CanvasNode,
  text: CanvasNode,
  link: CanvasNode,
  group: CanvasNode,
};
