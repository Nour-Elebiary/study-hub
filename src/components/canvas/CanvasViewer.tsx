"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Background,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { canvasNodeTypes, type CanvasNodeData } from "./CanvasNode";
import {
  canvasEdgeTypes,
  edgeMarkers,
  type CanvasEdgeData,
} from "./CanvasEdge";
import type {
  CanvasPayload,
  FileTarget,
  NoteTarget,
  OutlineItem,
} from "./payload";
import { GRID_SIZE, ZOOM_RANGE } from "@/lib/canvas/defaults";
import type { CanvasCard } from "@/lib/canvas/types";

/**
 * The student canvas viewer (CANVAS-SPEC section 5.7). Same renderer as the
 * leader editor (CanvasNode / CanvasEdge) but nothing is draggable or
 * connectable: students pan, pinch-zoom, open notes and download files.
 * Mobile-first (D9): below the desktop breakpoint the course outline comes
 * first and the map opens behind an "Open map" button — a plain state flip,
 * no matchMedia, so the layout never flashes.
 */

export type ViewerLabels = {
  title: string;
  openMap: string;
  listOfCards: string;
  fit: string;
  zoomIn: string;
  zoomOut: string;
  empty: string;
  download: string;
  openNote: string;
};

type ViewerNode = Node<CanvasNodeData>;
type ViewerEdge = Edge<CanvasEdgeData>;

const toViewerNodes = (payload: CanvasPayload): ViewerNode[] =>
  payload.cards.map((card) => ({
    id: card.id,
    type: card.kind,
    position: { x: card.x, y: card.y },
    width: card.width,
    height: card.height,
    zIndex: card.kind === "group" ? (card.z || 0) - 10 : card.z || 0,
    data: {
      card,
      note: payload.notes[card.nodeId ?? ""],
      file: payload.files[card.assetId ?? ""],
      leader: false,
    } satisfies CanvasNodeData,
  }));

const toViewerEdges = (payload: CanvasPayload): ViewerEdge[] =>
  payload.edges.map((edge) => {
    const data: CanvasEdgeData = {
      label: edge.label,
      color: edge.color,
      fromEnd: edge.fromEnd,
      toEnd: edge.toEnd,
      leader: false,
    };
    return {
      id: edge.id,
      type: "canvas",
      source: edge.from,
      target: edge.to,
      sourceHandle: edge.fromSide,
      targetHandle: edge.toSide,
      data,
      ...edgeMarkers(data),
    };
  });

/** Fit / Zoom ± / List of cards, every touch target at 44 px (spec 5.7). */
function FlowBar(props: { labels: ViewerLabels; onOpenList: () => void }) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  return (
    <Panel position="top-right" className="m-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => void fitView({ padding: 0.2, duration: 200 })}
          className="bg-background text-foreground h-11 min-h-11 min-w-11 rounded border px-2 text-xs font-semibold shadow"
        >
          {props.labels.fit}
        </button>
        <button
          type="button"
          onClick={() => void zoomIn({ duration: 150 })}
          aria-label={props.labels.zoomIn}
          className="bg-background text-foreground h-11 w-11 rounded border text-lg font-bold shadow"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => void zoomOut({ duration: 150 })}
          aria-label={props.labels.zoomOut}
          className="bg-background text-foreground h-11 w-11 rounded border text-lg font-bold shadow"
        >
          −
        </button>
        <button
          type="button"
          onClick={props.onOpenList}
          className="bg-background text-foreground h-11 min-h-11 rounded border px-3 text-xs font-semibold shadow"
        >
          {props.labels.listOfCards}
        </button>
      </div>
    </Panel>
  );
}

export default function CanvasViewer(props: {
  payload: CanvasPayload;
  outline: OutlineItem[];
  labels: ViewerLabels;
}) {
  const { payload, outline, labels } = props;
  const [mapOpen, setMapOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  const [flowNodes, , onNodesChange] = useNodesState<ViewerNode>(
    toViewerNodes(payload),
  );
  const [flowEdges, , onEdgesChange] = useEdgesState<ViewerEdge>(
    toViewerEdges(payload),
  );

  // Every visible card except groups, in reading order (top to bottom),
  // with the resolved note/file targets the rows need to decide links.
  const listRows = useMemo(
    () =>
      flowNodes
        .filter((node) => node.data.card.kind !== "group")
        .sort(
          (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
        )
        .map((node) => ({
          card: node.data.card,
          note: node.data.note,
          file: node.data.file,
        })),
    [flowNodes],
  );

  return (
    <div className="grid gap-3">
      <div>
        <p className="text-muted-foreground text-xs font-semibold">
          {labels.title}
        </p>
        <h1 className="text-2xl font-bold" dir="auto">
          {payload.title}
        </h1>
      </div>

      {/* Mobile-first outline (D9): shown at 360 px so students can keep
          moving through the course without opening the map at all; hidden on
          desktop where the map itself is the view. */}
      <section aria-label="Course outline" className="md:hidden">
        <OutlineList items={outline} />
        <button
          type="button"
          onClick={() => setMapOpen(true)}
          className="bg-primary text-primary-foreground mt-3 h-11 w-full rounded-lg text-sm font-semibold"
        >
          {labels.openMap}
        </button>
      </section>

      {/* The map block: hidden behind the Open map button on phones, always
          visible on desktop (the md:block wins the CSS split). */}
      <div className={`${mapOpen ? "block" : "hidden"} md:block`}>
        {payload.cards.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">
            {labels.empty}
          </p>
        ) : (
          <div className="h-[calc(100dvh-10rem)] min-h-64 w-full">
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={canvasNodeTypes}
              edgeTypes={canvasEdgeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              onlyRenderVisibleElements
              minZoom={ZOOM_RANGE.min}
              maxZoom={ZOOM_RANGE.max}
              defaultViewport={{
                x: payload.viewport.x,
                y: payload.viewport.y,
                zoom: Math.min(
                  ZOOM_RANGE.max,
                  Math.max(ZOOM_RANGE.min, payload.viewport.zoom),
                ),
              }}
              proOptions={{ hideAttribution: false }}
            >
              <Background gap={GRID_SIZE} />
              <FlowBar labels={labels} onOpenList={() => setListOpen(true)} />
            </ReactFlow>
          </div>
        )}
      </div>

      {/* "List of cards" bottom sheet: every visible card in reading order,
          for keyboard and screen-reader users (spec 5.7). */}
      <dialog
        open={listOpen}
        onClick={(event) => {
          if (event.target === event.currentTarget) setListOpen(false);
        }}
        className="m-auto w-[min(24rem,calc(100vw-1rem))] rounded-xl p-4 backdrop:bg-black/40"
      >
        <h2 className="text-sm font-bold">{labels.listOfCards}</h2>
        {listRows.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-xs">{labels.empty}</p>
        ) : (
          <ul className="mt-2 grid max-h-[60vh] gap-1 overflow-y-auto">
            {listRows.map((row) => (
              <CardRow key={row.card.id} row={row} labels={labels} />
            ))}
          </ul>
        )}
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => setListOpen(false)}
            className="rounded border px-3 py-1.5 text-xs font-semibold"
          >
            Close
          </button>
        </div>
      </dialog>
    </div>
  );
}

/** One row of the List of cards sheet: note → Open note, file → Download
    (only when the file is downloadable), link → new tab, text → the text. */
function CardRow(props: {
  row: { card: CanvasCard; note?: NoteTarget; file?: FileTarget };
  labels: ViewerLabels;
}) {
  const { row, labels } = props;
  const { card, note, file } = row;
  const title = card.label || (card.kind === "file" ? file?.name : null) || "";
  if (card.kind === "note" && card.nodeId && note) {
    return (
      <li>
        <Link
          href={`/s/notes/${card.nodeId}`}
          className="hover:bg-muted block rounded border px-2 py-2 text-xs"
        >
          <span className="block truncate font-semibold" dir="auto">
            {title || note.title}
          </span>
          <span className="text-primary underline underline-offset-2">
            {labels.openNote}
          </span>
        </Link>
      </li>
    );
  }
  if (card.kind === "file" && card.assetId && file && file.downloadable) {
    return (
      <li>
        <Link
          href={`/s/download/${card.assetId}`}
          className="hover:bg-muted block rounded border px-2 py-2 text-xs"
        >
          <span className="block truncate font-semibold" dir="auto">
            {title || file.name}
          </span>
          <span className="text-primary underline underline-offset-2">
            {labels.download}
          </span>
        </Link>
      </li>
    );
  }
  if (card.kind === "link" && card.url) {
    return (
      <li>
        <a
          href={card.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:bg-muted block rounded border px-2 py-2 text-xs"
        >
          <span className="block truncate font-semibold" dir="auto">
            {title || card.url}
          </span>
          <span className="text-muted-foreground block truncate text-[10px]">
            {safeDomain(card.url)}
          </span>
        </a>
      </li>
    );
  }
  return (
    <li>
      <CardText text={title || card.body || ""} />
    </li>
  );
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function CardText(props: { text: string }) {
  return (
    <span className="block rounded border px-2 py-2 text-xs" dir="auto">
      {props.text}
    </span>
  );
}

function OutlineList(props: { items: OutlineItem[] }) {
  return (
    <ul className="grid gap-1">
      {props.items.map((item) => (
        <li key={item.id}>
          {item.openable ? (
            <Link
              href={`/s/notes/${item.id}`}
              className="hover:bg-muted block rounded px-2 py-1.5 text-sm"
              dir="auto"
            >
              {item.title}
            </Link>
          ) : (
            <span
              className={`${item.heading ? "text-foreground font-bold" : ""} block px-2 py-1.5 text-sm`}
              dir="auto"
            >
              {item.title}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
