"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Background,
  ConnectionMode,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Node,
  type NodeChange,
  type NodeDimensionChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { canvasNodeTypes, type CanvasNodeData } from "./CanvasNode";
import {
  canvasEdgeTypes,
  edgeMarkers,
  type CanvasEdgeData,
  type CanvasFlowEdge,
} from "./CanvasEdge";
import Toolbar from "./Toolbar";
import LegendEditor from "./LegendEditor";
import VersionsSheet from "./VersionsSheet";
import { CanvasProvider, type CanvasContextValue } from "./editor-context";
import { applyOps, invertOps, defaultSizeOf } from "@/lib/canvas/ops";
import { nearestSide } from "@/lib/canvas/geometry";
import { snap } from "@/lib/canvas/geometry";
import {
  CARD_KINDS,
  SIDES,
  type CanvasOp,
  type Side,
} from "@/lib/canvas/schemas";
import { GRID_SIZE, ZOOM_RANGE } from "@/lib/canvas/defaults";
import type { CanvasCard, CanvasState } from "@/lib/canvas/types";
import type { CanvasPayload, PickerFile, PickerNote } from "./payload";
import {
  applyCanvasOpsAction,
  listPickerFilesAction,
  listPickerNotesAction,
  publishCanvasAction,
} from "@/app/(leader)/courses/[courseId]/canvas/actions";

/**
 * The canvas editor (CANVAS-SPEC section 5.6, M9 basic scope). Every
 * interaction becomes ops, applied optimistically with the pure `applyOps`
 * and flushed as one batch to `applyCanvasOpsAction` (the only database
 * writer, QUESTIONS #43). Loaded by the page's shell with next/dynamic
 * ssr:false so it never runs on the server.
 */

type SaveStatus = "saved" | "saving" | "error";

type RfNode = Node<CanvasNodeData>;
type RfEdge = CanvasFlowEdge;

const toRfNodes = (payload: CanvasPayload): RfNode[] =>
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
      leader: true,
    } satisfies CanvasNodeData,
  }));

const toRfEdges = (payload: CanvasPayload): RfEdge[] =>
  payload.edges.map((edge) => {
    const data: CanvasEdgeData = {
      label: edge.label,
      color: edge.color,
      fromEnd: edge.fromEnd,
      toEnd: edge.toEnd,
      leader: true,
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

function CanvasEditor({ payload }: { payload: CanvasPayload }) {
  const router = useRouter();

  const [nodes, setNodes, onNodesChange] = useNodesState<RfNode>(
    toRfNodes(payload),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<RfEdge>(
    toRfEdges(payload),
  );

  const stateRef = useRef<CanvasState>({
    cards: Object.fromEntries(payload.cards.map((c) => [c.id, c])),
    edges: Object.fromEntries(payload.edges.map((e) => [e.id, e])),
    rev: 0,
  });

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  // The last plain-language save problem ("This map is full…"), shown under
  // the toolbar until the next successful save (spec 5.9 test d).
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [published, setPublished] = useState(payload.published);
  const [savingPublish, setSavingPublish] = useState(false);
  const [picker, setPicker] = useState<"note" | "file" | null>(null);
  const [pickerNotes, setPickerNotes] = useState<PickerNote[] | null>(null);
  const [pickerFiles, setPickerFiles] = useState<PickerFile[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const lastDeleteRef = useRef<CanvasOp[] | null>(null);
  const flowRef = useRef<ReactFlowInstance<RfNode, RfEdge> | null>(null);
  // --------------------------------------------------------------------------
  // Visual sync: apply an op batch to the React Flow lists (adds, removals,
  // edits) so the optimistic state and the screen stay one thing.
  // --------------------------------------------------------------------------
  const notesRef = useRef(payload.notes);
  const filesRef = useRef(payload.files);

  const nodeFromCard = useCallback(
    (card: CanvasCard): RfNode => ({
      id: card.id,
      type: card.kind,
      position: { x: card.x, y: card.y },
      width: card.width,
      height: card.height,
      zIndex: card.kind === "group" ? (card.z || 0) - 10 : card.z || 0,
      data: {
        card: { ...card },
        note: notesRef.current[card.nodeId ?? ""],
        file: filesRef.current[card.assetId ?? ""],
        leader: true,
      } satisfies CanvasNodeData,
    }),
    [],
  );

  const syncOps = useCallback(
    (ops: readonly CanvasOp[]) => {
      for (const op of ops) {
        switch (op.op) {
          case "node.add": {
            const card = stateRef.current.cards[op.id];
            if (!card) break;
            const fresh = nodeFromCard(card);
            setNodes((current) =>
              current.some((node) => node.id === op.id)
                ? current
                : [...current, fresh],
            );
            break;
          }
          case "node.update":
            setNodes((current) =>
              current.map((node) => {
                if (node.id !== op.id) return node;
                const nextData: CanvasNodeData = {
                  ...node.data,
                  card: { ...node.data.card },
                };
                if ("color" in op) nextData.card.color = op.color ?? null;
                if ("label" in op) nextData.card.label = op.label ?? null;
                if ("body" in op) nextData.card.body = op.body ?? null;
                if ("student_visible" in op) {
                  nextData.card.studentVisible = op.student_visible ?? true;
                }
                return {
                  ...node,
                  position:
                    op.x !== undefined || op.y !== undefined
                      ? {
                          x: op.x ?? node.position.x,
                          y: op.y ?? node.position.y,
                        }
                      : node.position,
                  width: op.width ?? node.width,
                  height: op.height ?? node.height,
                  data: nextData,
                };
              }),
            );
            break;
          case "node.delete":
            setNodes((current) => current.filter((node) => node.id !== op.id));
            setEdges((current) =>
              current.filter(
                (edge) => edge.source !== op.id && edge.target !== op.id,
              ),
            );
            break;
          case "edge.add": {
            setEdges((current) => {
              if (current.some((edge) => edge.id === op.id)) return current;
              const data: CanvasEdgeData = {
                label: op.label ?? null,
                color: op.color ?? null,
                fromEnd: op.from_end ?? "none",
                toEnd: op.to_end ?? "arrow",
                leader: true,
              };
              const edge: RfEdge = {
                id: op.id,
                type: "canvas",
                source: op.from_node,
                target: op.to_node,
                sourceHandle: op.from_side ?? "right",
                targetHandle: op.to_side ?? "left",
                data,
                ...edgeMarkers(data),
              };
              return [...current, edge];
            });
            break;
          }
          case "edge.update":
            setEdges((current) =>
              current.map((edge) => {
                if (edge.id !== op.id || !edge.data) return edge;
                const data: CanvasEdgeData = { ...edge.data };
                if ("label" in op) data.label = op.label ?? null;
                if ("color" in op) data.color = op.color ?? null;
                if ("from_end" in op) data.fromEnd = op.from_end ?? "none";
                if ("to_end" in op) data.toEnd = op.to_end ?? "arrow";
                const next: RfEdge = {
                  ...edge,
                  data,
                  ...edgeMarkers(data),
                };
                if ("from_side" in op) next.sourceHandle = op.from_side ?? null;
                if ("to_side" in op) next.targetHandle = op.to_side ?? null;
                return next;
              }),
            );
            break;
          case "edge.delete":
            setEdges((current) => current.filter((edge) => edge.id !== op.id));
            break;
        }
      }
    },
    [setNodes, setEdges, nodeFromCard],
  );

  // --------------------------------------------------------------------------
  // Save queue
  // --------------------------------------------------------------------------
  const pendingRef = useRef<CanvasOp[]>([]);
  const timerRef = useRef<number | null>(null);
  const retriedRef = useRef(false);

  // The retry path re-schedules itself through the named function
  // expression inside useCallback, so the callback can always reference
  // itself.
  const flush = useCallback(
    async function flush() {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const batch = pendingRef.current;
      if (batch.length === 0) {
        setSaveStatus("saved");
        return;
      }
      pendingRef.current = [];
      setSaveStatus("saving");
      const result = await applyCanvasOpsAction(payload.id, batch);
      if ("rev" in result) {
        stateRef.current = { ...stateRef.current, rev: result.rev };
        retriedRef.current = false;
        setSaveStatus("saved");
        setSaveNotice(null);
        return;
      }
      console.error("canvas save failed:", result.error);
      // The server already mapped this to plain language (errors.ts): "This
      // map is full…", "That content belongs to another course…", etc.
      setSaveNotice(result.error);
      // Put the batch back and retry once quietly; a second failure shows the
      // retry chip (Could not save — Try again).
      pendingRef.current = [...batch, ...pendingRef.current];
      if (result.refetch || retriedRef.current) {
        retriedRef.current = true;
        setSaveStatus("error");
        return;
      }
      retriedRef.current = true;
      window.setTimeout(() => void flush(), 2500);
    },
    [payload.id],
  );

  const queueOps = useCallback(
    (ops: readonly CanvasOp[]) => {
      if (ops.length === 0) return;
      stateRef.current = applyOps(stateRef.current, ops);
      pendingRef.current.push(...ops);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void flush();
      }, 800);
    },
    [flush],
  );

  // --------------------------------------------------------------------------
  // Interaction handlers
  // --------------------------------------------------------------------------

  // End of drag or resize → position/size op (snapped to the 20 grid).
  const onNodeCommit = useCallback(
    (node: RfNode & Node<CanvasNodeData>) => {
      const card = stateRef.current.cards[node.id];
      if (!card) return;
      const change: CanvasOp = { op: "node.update", id: node.id };
      const x = snap(node.position.x, GRID_SIZE);
      const y = snap(node.position.y, GRID_SIZE);
      const width = Math.round(node.width ?? card.width);
      const height = Math.round(node.height ?? card.height);
      let changed = false;
      if (x !== card.x || y !== card.y) {
        change.x = x;
        change.y = y;
        changed = true;
      }
      if (width !== card.width || height !== card.height) {
        change.width = width;
        change.height = height;
        changed = true;
      }
      if (!changed) return;
      // Snap the visual position to match (React Flow kept the unsnapped one).
      if (change.x !== undefined || change.y !== undefined) {
        setNodes((current) =>
          current.map((existing) =>
            existing.id === node.id
              ? { ...existing, position: { x, y } }
              : existing,
          ),
        );
      }
      queueOps([change]);
    },
    [queueOps, setNodes],
  );

  const selectedCardIds = useMemo(
    () =>
      nodes
        .filter(
          (node) => node.selected && CARD_KINDS.includes(node.data.card.kind),
        )
        .map((node) => node.id),
    [nodes],
  );

  // --------------------------------------------------------------------------
  // Remove from map + Undo toast
  // --------------------------------------------------------------------------
  const removeCard = useCallback(
    (cardId: string) => {
      const before = stateRef.current;
      const ops: CanvasOp[] = [{ op: "node.delete", id: cardId }];
      lastDeleteRef.current = invertOps(before, ops);
      queueOps(ops);
      syncOps(ops);
      setCanUndo(true);
      setToast("Removed from map");
      window.setTimeout(
        () =>
          setToast((current) =>
            current === "Removed from map" ? null : current,
          ),
        6000,
      );
    },
    [queueOps, syncOps],
  );

  const undoLastDelete = useCallback(() => {
    const inverse = lastDeleteRef.current;
    if (!inverse) return;
    lastDeleteRef.current = null;
    setCanUndo(false);
    queueOps(inverse);
    syncOps(inverse);
  }, [queueOps, syncOps]);

  const recolourSelected = useCallback(
    (color: string | null) => {
      for (const id of selectedCardIds) {
        const op: CanvasOp = {
          op: "node.update",
          id,
          color: (color as CanvasCard["color"]) ?? null,
        };
        queueOps([op]);
        syncOps([op]);
      }
    },
    [queueOps, syncOps, selectedCardIds],
  );

  // --------------------------------------------------------------------------
  // Adding cards
  // --------------------------------------------------------------------------
  const addCard = useCallback(
    (
      kind: CanvasCard["kind"],
      seed: Partial<Extract<CanvasOp, { op: "node.add" }>> = {},
    ) => {
      const flow = flowRef.current;
      const centre = flow
        ? flow.screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          })
        : { x: 40, y: 40 };
      const size = defaultSizeOf(kind);
      const jitter = (nodes.length % 5) * 24;
      const op: CanvasOp = {
        op: "node.add",
        id: crypto.randomUUID(),
        kind,
        x: snap(centre.x - size.width / 2 + jitter, GRID_SIZE),
        y: snap(centre.y - size.height / 2 + jitter, GRID_SIZE),
        width: size.width,
        height: size.height,
        ...seed,
      } as CanvasOp;
      queueOps([op]);
      syncOps([op]);
    },
    [queueOps, syncOps, nodes.length],
  );

  // Pickers: notes/files of this course loaded through server actions when
  // the picker opens; cleared on close so they re-fetch next time.
  const openPicker = useCallback((kind: "note" | "file") => {
    setPicker(kind);
  }, []);

  const closePicker = useCallback(() => {
    setPicker(null);
    setPickerNotes(null);
    setPickerFiles(null);
  }, []);

  useEffect(() => {
    if (picker === "note" && pickerNotes === null) {
      void listPickerNotesAction(payload.courseId).then((result) => {
        setPickerNotes("notes" in result ? result.notes : []);
      });
    }
    if (picker === "file" && pickerFiles === null) {
      void listPickerFilesAction(payload.courseId).then((result) => {
        setPickerFiles("files" in result ? result.files : []);
      });
    }
  }, [picker, pickerNotes, pickerFiles, payload.courseId]);

  // --------------------------------------------------------------------------
  // Connections
  // --------------------------------------------------------------------------
  const onConnect = useCallback(
    (connection: Connection) => {
      const { source, target, sourceHandle, targetHandle } = connection;
      if (
        !source ||
        !target ||
        source === target ||
        !stateRef.current.cards[source] ||
        !stateRef.current.cards[target]
      ) {
        return;
      }
      const sourceCard = stateRef.current.cards[source]!;
      const targetCard = stateRef.current.cards[target]!;
      const fromCandidate = (sourceHandle ?? null) as Side | null;
      const toCandidate = (targetHandle ?? null) as Side | null;
      const fromSide =
        fromCandidate && SIDES.includes(fromCandidate)
          ? fromCandidate
          : nearestSide(sourceCard, { x: targetCard.x, y: targetCard.y });
      const toSide =
        toCandidate && SIDES.includes(toCandidate)
          ? toCandidate
          : nearestSide(targetCard, { x: sourceCard.x, y: sourceCard.y });
      const op: CanvasOp = {
        op: "edge.add",
        id: crypto.randomUUID(),
        from_node: source,
        to_node: target,
        from_side: fromSide,
        to_side: toSide,
      };
      queueOps([op]);
      syncOps([op]);
    },
    [queueOps, syncOps],
  );

  const contextValue = useMemo<CanvasContextValue>(
    () => ({ queueOps, removeCard, recolourCard: recolourSelected }),
    [queueOps, removeCard, recolourSelected],
  );

  // --------------------------------------------------------------------------
  // Publish switch
  // --------------------------------------------------------------------------
  const togglePublished = useCallback(
    async (next: boolean) => {
      setSavingPublish(true);
      const formData = new FormData();
      formData.set("canvas_id", payload.id);
      formData.set("published", String(next));
      try {
        const result = await publishCanvasAction(null, formData);
        if (result && "error" in result && result.error) {
          console.error("publish toggle failed:", result.error);
          return;
        }
        setPublished(next);
        router.refresh();
      } catch (error) {
        // A failed call used to leave the checkbox disabled forever; surface
        // the problem instead of swallowing the rejection.
        console.error("publish toggle threw:", error);
      } finally {
        setSavingPublish(false);
      }
    },
    [payload.id, router],
  );

  const onNodesChangeAll = useCallback(
    (changes: NodeChange<RfNode>[]) => {
      onNodesChange(changes);
      // Resize sessions end with a dimensions change carrying resizing=false;
      // mount-measuring events have resizing === undefined and are ignored.
      const ended: NodeDimensionChange[] = [];
      for (const change of changes) {
        if (
          change.type === "dimensions" &&
          change.resizing === false &&
          change.id in stateRef.current.cards
        ) {
          ended.push(change);
        }
      }
      if (ended.length === 0) return;
      for (const change of ended) {
        const node = nodes.find((existing) => existing.id === change.id);
        if (node) onNodeCommit(node);
      }
    },
    [onNodesChange, onNodeCommit, nodes],
  );

  return (
    <CanvasProvider value={contextValue}>
      <Toolbar
        canEdit
        saveStatus={saveStatus}
        onRetrySave={() => void flush()}
        onAddText={() => addCard("text", { body: "Write here…" })}
        onAddNote={() => openPicker("note")}
        onAddFile={() => openPicker("file")}
        onAddGroup={() => addCard("group", { label: "New group" })}
        onUndo={undoLastDelete}
        canUndo={canUndo}
        selectedCardIds={selectedCardIds}
        onRecolour={recolourSelected}
        onRemoveSelected={() => {
          for (const id of selectedCardIds) removeCard(id);
        }}
        legend={payload.legend}
        onOpenLegend={() => setLegendOpen(true)}
        onOpenVersions={() => setVersionsOpen(true)}
        published={published}
        onTogglePublished={(next) => void togglePublished(next)}
        savingPublish={savingPublish}
      />

      {saveNotice ? (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive border-destructive/40 mx-2 rounded border px-2.5 py-1.5 text-xs font-semibold"
        >
          {saveNotice}
        </p>
      ) : null}

      <div className="h-[calc(100dvh-9rem)] w-full">
        <ReactFlow
          onInit={(flow) => {
            flowRef.current = flow;
          }}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChangeAll}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={(_, node) => onNodeCommit(node)}
          onConnect={onConnect}
          nodeTypes={canvasNodeTypes}
          edgeTypes={canvasEdgeTypes}
          connectionMode={ConnectionMode.Loose}
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
          deleteKeyCode={null}
          selectNodesOnDrag={false}
          proOptions={{ hideAttribution: false }}
        >
          <Background gap={GRID_SIZE} />
        </ReactFlow>
      </div>

      <PickerDialog
        kind={picker}
        notes={pickerNotes}
        files={pickerFiles}
        onChoose={(kind, entry) => {
          if (kind === "note") {
            const note = entry as PickerNote;
            // The optimistic card resolves its target through notesRef,
            // which only knows the notes from the page's first load — the
            // picked note is not there yet. Hand the picker's own data to
            // the card now; the next full page load resolves the server
            // truth (preview body, deleted state) through resolveTargets.
            notesRef.current = {
              ...notesRef.current,
              [note.id]: {
                id: note.id,
                title: note.title,
                area: note.area,
                published: note.published,
                deleted: false,
                preview: null,
              },
            };
            addCard("note", { node_id: note.id, label: note.title });
          } else {
            const file = entry as PickerFile;
            // Same optimistic hand-off. The storage path and mime type
            // stay empty until the reload; without a mime the card keeps
            // its icon and the thumbnail lookup is never attempted.
            filesRef.current = {
              ...filesRef.current,
              [file.id]: {
                id: file.id,
                name: file.title,
                kind: file.kind,
                mime: "",
                bytes: file.bytes,
                visible: file.visible,
                downloadable: file.downloadable,
                pathOrUrl: "",
              },
            };
            addCard("file", { asset_id: file.id, label: file.title });
          }
          closePicker();
        }}
        onClose={() => closePicker()}
      />

      <LegendEditor
        canvasId={payload.id}
        legend={payload.legend}
        open={legendOpen}
        onClose={() => {
          setLegendOpen(false);
          router.refresh();
        }}
      />
      <VersionsSheet
        canvasId={payload.id}
        open={versionsOpen}
        onClose={() => {
          setVersionsOpen(false);
          router.refresh();
        }}
      />

      {toast ? (
        <div
          role="status"
          className="bg-background fixed bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold shadow-lg"
        >
          {toast}
          {canUndo ? (
            <button
              type="button"
              onClick={undoLastDelete}
              className="text-destructive underline underline-offset-2"
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </CanvasProvider>
  );
}

// --------------------------------------------------------------------------
// The note / file picker dialog (same-card look, list discipline)
// --------------------------------------------------------------------------
type PickerDialogProps = {
  kind: "note" | "file" | null;
  notes: PickerNote[] | null;
  files: PickerFile[] | null;
  onChoose: (kind: "note" | "file", entry: PickerNote | PickerFile) => void;
  onClose: () => void;
};

function PickerDialog(props: PickerDialogProps) {
  const [query, setQuery] = useState("");
  return (
    <dialog
      open={props.kind !== null}
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
      className="m-auto rounded-xl p-4 backdrop:bg-black/40"
    >
      <h2 className="text-sm font-bold">
        {props.kind === "note" ? "Choose a note" : "Choose a file"}
      </h2>
      <p className="text-muted-foreground mt-1 text-xs">
        Only notes and files from this course are listed.
      </p>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search…"
        className="mt-2 w-full rounded border px-2 py-1.5 text-xs"
        aria-label="Search the list"
      />
      <ul className="mt-2 grid max-h-72 w-64 gap-1 overflow-y-auto">
        {props.kind === "note"
          ? (props.notes ?? [])
              .filter((note) =>
                note.title.toLowerCase().includes(query.toLowerCase()),
              )
              .map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => props.onChoose("note", note)}
                    className="hover:bg-muted w-full rounded border px-2 py-1.5 text-left text-xs"
                  >
                    <span className="block truncate font-semibold" dir="auto">
                      {note.title}
                    </span>
                    <span className="text-muted-foreground text-[10px]">
                      {note.published ? "Published" : "Draft"}
                    </span>
                  </button>
                </li>
              ))
          : (props.files ?? [])
              .filter((file) =>
                file.title.toLowerCase().includes(query.toLowerCase()),
              )
              .map((file) => (
                <li key={file.id}>
                  <button
                    type="button"
                    onClick={() => props.onChoose("file", file)}
                    className="hover:bg-muted w-full rounded border px-2 py-1.5 text-left text-xs"
                  >
                    <span className="block truncate font-semibold" dir="auto">
                      {file.title}
                    </span>
                    <span className="text-muted-foreground text-[10px]">
                      {file.kind}
                      {!file.visible ? " · hidden from students" : ""}
                    </span>
                  </button>
                </li>
              ))}
      </ul>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={props.onClose}
          className="rounded border px-3 py-1.5 text-xs font-semibold"
        >
          Cancel
        </button>
      </div>
    </dialog>
  );
}

export default CanvasEditor;
