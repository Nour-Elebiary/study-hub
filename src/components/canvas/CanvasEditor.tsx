"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
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
  type OnNodeDrag,
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
import {
  emptyHistory,
  popRedo,
  popUndo,
  pushRedo,
  pushUndo,
  record as recordHistory,
  type HistoryState,
} from "@/lib/canvas/history";
import { SaveQueue, type SaveStatus } from "@/lib/canvas/save-queue";
import {
  cardsInsideGroup,
  nearestSide,
  snap,
  unionRect,
} from "@/lib/canvas/geometry";
import {
  CARD_KINDS,
  SIDES,
  type CanvasOp,
  type Side,
} from "@/lib/canvas/schemas";
import { GRID_SIZE, ZOOM_RANGE } from "@/lib/canvas/defaults";
import type { CanvasCard, CanvasEdge, CanvasState } from "@/lib/canvas/types";
import type { CanvasPayload, PickerFile, PickerNote } from "./payload";
import { SidePane, type PaneEntry } from "./SidePane";
import { getNoteBodyAction } from "@/app/(leader)/courses/[courseId]/canvas/actions";
import { randomStoragePath, validateUpload } from "@/lib/file-allowlist";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { registerUploadAction } from "@/app/(leader)/courses/[courseId]/nodes/[nodeId]/assets/actions";
import {
  applyCanvasOpsAction,
  getCanvasRevAction,
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

/**
 * Spec 6.3: shortcuts MUST NOT fire while a text field, the TipTap editor
 * or a palette input has focus.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Ctrl/Cmd+C keeps an in-page snapshot of the selected cards plus the edges
 * between them (spec 6.2 paste: "Study Hub cards → copies with the same
 * references"). The plain text twin goes on the system clipboard; when a
 * later paste hands back exactly that text, the snapshot duplicates as
 * cards. Any other text pastes as a text / link card instead.
 */
type CopySnapshot = {
  cards: CanvasCard[];
  edges: CanvasEdge[];
  text: string;
};

/** One plain text line per card: label, else body, else the URL. */
const cardText = (card: CanvasCard): string =>
  (card.label ?? card.body ?? card.url ?? "").replace(/\r?\n/g, " ");

const snapshotText = (cards: readonly CanvasCard[]): string =>
  cards.map(cardText).join("\n");

/** Arrow key → one grid step in that direction (spec 6.3 nudge). */
const ARROW_NUDGE = {
  arrowleft: [-GRID_SIZE, 0],
  arrowright: [GRID_SIZE, 0],
  arrowup: [0, -GRID_SIZE],
  arrowdown: [0, GRID_SIZE],
} as const;

/**
 * One per-file progress chip for the drag-drop upload (spec 6.5 test d):
 * every dropped file reports Checking / Uploading… / done in plain
 * language; a failure never creates a card.
 */
type UploadChip = {
  key: string;
  name: string;
  state: "working" | "done" | "error";
  message: string;
};

/** Up to 5 open tabs (spec 6.6); a sixth silently replaces the oldest. */
function capPane(current: readonly PaneEntry[], entry: PaneEntry): PaneEntry[] {
  const next = [...current.filter((e) => e.cardId !== entry.cardId), entry];
  return next.length > 5 ? next.slice(next.length - 5) : next;
}

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
  const [legendOpen, setLegendOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [published, setPublished] = useState(payload.published);
  const [savingPublish, setSavingPublish] = useState(false);
  const [picker, setPicker] = useState<"note" | "file" | null>(null);
  const [pickerNotes, setPickerNotes] = useState<PickerNote[] | null>(null);
  const [pickerFiles, setPickerFiles] = useState<PickerFile[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const flowRef = useRef<ReactFlowInstance<RfNode, RfEdge> | null>(null);
  // Undo/redo history (spec 6.4): every user action is one entry.
  const historyRef = useRef<HistoryState>(emptyHistory());
  // The ids of the most recent undo batch, so the send adapter can tell
  // "another leader removed a card this undo touches" apart (spec 6.4).
  const undoTagsRef = useRef<Set<string> | null>(null);
  // Ctrl/Cmd+C snapshot (spec 6.2): cards + edges between them + their plain
  // text twin, and the group-drag snapshot of cards inside at drag start.
  const copyRef = useRef<CopySnapshot | null>(null);
  const groupDragRef = useRef<{
    groupId: string;
    origin: { x: number; y: number };
    followers: Array<{ id: string; x: number; y: number }>;
  } | null>(null);
  // Drag-drop upload (spec 6.5): per-file chips, drag highlight, and the
  // hidden picker input behind the toolbar "Add file from computer".
  const [uploads, setUploads] = useState<UploadChip[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  // Side pane (spec 6.6): open card tabs + the active one. Note bodies are
  // cached per note id, so switching tabs does not refetch.
  const [paneEntries, setPaneEntries] = useState<PaneEntry[]>([]);
  const [paneActive, setPaneActive] = useState<string | null>(null);
  const noteBodyRef = useRef(
    new Map<
      string,
      { body: string; canWrite: boolean; canBreakLock: boolean; title: string }
    >(),
  );
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
  // Save queue (spec 6.4): the pure SaveQueue class owns the quiet flush,
  // coalescing, back-off retries, the offline pause and the chip states. The
  // editor owns the browser glue around it (events, beforeunload, focus).
  // --------------------------------------------------------------------------
  const sendOps = useCallback(
    async (batch: CanvasOp[]) => {
      const result = await applyCanvasOpsAction(payload.id, batch);
      if ("rev" in result) {
        // The server skipped op targets (usually: another leader removed a
        // card an undo touches, spec 6.4) — say so in plain language.
        if (
          result.skipped > 0 &&
          undoTagsRef.current !== null &&
          batch.some((op) => undoTagsRef.current!.has(op.id))
        ) {
          setToast(
            "Some changes could not be undone because someone else changed this map.",
          );
        }
        undoTagsRef.current = null;
        return { ok: true, rev: result.rev } as const;
      }
      console.error("canvas save failed:", result.error);
      // The server already mapped this to plain language (errors.ts): "This
      // map is full…", "That content belongs to another course…", etc.
      setSaveNotice(result.error);
      return {
        ok: false,
        error: result.error,
        refetch: result.refetch,
      } as const;
    },
    [payload.id],
  );

  // The server's accepted revision (spec 6.4); applied outside render.
  const applyServerRev = useCallback((rev: number) => {
    stateRef.current = { ...stateRef.current, rev };
    setSaveNotice(null);
  }, []);

  // The queue lives in a ref and is created on first use (a hook initializer
  // or a sync mount-effect setState cannot reach refs under the React
  // compiler rules). Every caller is event- or effect-driven — exactly where
  // refs and side effects are allowed.
  const queueRef = useRef<SaveQueue | null>(null);
  const getQueue = useCallback(() => {
    if (queueRef.current === null) {
      queueRef.current = new SaveQueue({
        send: sendOps,
        onRev: applyServerRev,
        schedule: (fn, ms) => window.setTimeout(fn, ms),
        cancel: (handle) => window.clearTimeout(handle as number),
        now: () => Date.now(),
      });
    }
    return queueRef.current;
  }, [sendOps, applyServerRev]);

  // Chip states come from the queue (Saved / Saving… / Offline / error).
  useEffect(() => {
    const queue = getQueue();
    return queue.subscribe((status) => setSaveStatus(status));
  }, [getQueue]);

  const queueOps = useCallback(
    (ops: readonly CanvasOp[]) => {
      if (ops.length === 0) return;
      stateRef.current = applyOps(stateRef.current, ops);
      getQueue().queue(ops);
    },
    [getQueue],
  );

  // --------------------------------------------------------------------------
  // Undo/redo history (spec 6.4)
  // --------------------------------------------------------------------------
  const syncHistoryFlags = useCallback(() => {
    setCanUndo(historyRef.current.undo.length > 0);
    setCanRedo(historyRef.current.redo.length > 0);
  }, []);

  /**
   * One user action: pushed onto the undo stack as a single entry (drag,
   * group move, recolour, delete…), then applied + queued like any other
   * change. Own actions only (spec: red stack clears on a new action).
   */
  const commit = useCallback(
    (ops: readonly CanvasOp[]) => {
      if (ops.length === 0) return;
      const inverse = invertOps(stateRef.current, ops);
      historyRef.current = recordHistory(
        historyRef.current,
        ops,
        inverse,
        Date.now(),
      );
      syncHistoryFlags();
      queueOps(ops);
      syncOps(ops);
    },
    [queueOps, syncOps, syncHistoryFlags],
  );

  const undo = useCallback(() => {
    const popped = popUndo(historyRef.current);
    if (!popped) return;
    historyRef.current = pushRedo(popped.after, popped.entry);
    undoTagsRef.current = new Set(popped.entry.inverse.map((op) => op.id));
    syncHistoryFlags();
    queueOps(popped.entry.inverse);
    syncOps(popped.entry.inverse);
  }, [queueOps, syncOps, syncHistoryFlags]);

  const redo = useCallback(() => {
    const popped = popRedo(historyRef.current);
    if (!popped) return;
    historyRef.current = pushUndo(popped.after, popped.entry);
    syncHistoryFlags();
    queueOps(popped.entry.forward);
    syncOps(popped.entry.forward);
  }, [queueOps, syncOps, syncHistoryFlags]);

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
      // One history entry for the whole move/resize; syncOps Snapped the
      // visual position to match (React Flow kept the unsnapped one).
      commit([change]);
    },
    [commit],
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
  // Selection helpers (spec 6.2: Shift-drag, Ctrl+click handled by React
  // Flow props; Ctrl+A, Esc and Tab move selection from here).
  // --------------------------------------------------------------------------
  const setOneSelected = useCallback(
    (nodeId: string) => {
      setNodes((current) =>
        current.map((node) => ({ ...node, selected: node.id === nodeId })),
      );
    },
    [setNodes],
  );

  const setAllSelected = useCallback(() => {
    setNodes((current) => current.map((node) => ({ ...node, selected: true })));
  }, [setNodes]);

  const clearSelection = useCallback(() => {
    setNodes((current) =>
      current.map((node) =>
        node.selected ? { ...node, selected: false } : node,
      ),
    );
  }, [setNodes]);

  /** Brings a card into view after keyboard selection moves (spec 6.3). */
  const centerOn = useCallback((card: CanvasCard) => {
    flowRef.current?.setCenter(
      card.x + card.width / 2,
      card.y + card.height / 2,
      { duration: 200 },
    );
  }, []);

  // --------------------------------------------------------------------------
  // Remove from map + Undo toast (history-driven, spec 6.4)
  // --------------------------------------------------------------------------
  const removeCards = useCallback(
    (cardIds: readonly string[]) => {
      const ids = [...new Set(cardIds)].filter(
        (id) => id in stateRef.current.cards,
      );
      if (ids.length === 0) return;
      commit(ids.map((id): CanvasOp => ({ op: "node.delete", id })));
      const one = ids.length === 1;
      const text = one ? "Removed from map" : `${ids.length} cards removed`;
      setToast(text);
      window.setTimeout(
        () => setToast((current) => (current === text ? null : current)),
        6000,
      );
    },
    [commit],
  );

  const removeCard = useCallback(
    (cardId: string) => removeCards([cardId]),
    [removeCards],
  );

  const recolourSelected = useCallback(
    (color: string | null) => {
      if (selectedCardIds.length === 0) return;
      // The whole recolour is ONE user action (one history entry).
      const ops: CanvasOp[] = selectedCardIds.map((id): CanvasOp => ({
        op: "node.update",
        id,
        color: (color as CanvasCard["color"]) ?? null,
      }));
      commit(ops);
    },
    [commit, selectedCardIds],
  );

  // --------------------------------------------------------------------------
  // Adding cards
  // --------------------------------------------------------------------------
  const addCard = useCallback(
    (
      kind: CanvasCard["kind"],
      seed: Partial<Extract<CanvasOp, { op: "node.add" }>> = {},
      // Double-click drops the card at the mouse position (spec 6.2);
      // without `at` the card lands where the view currently looks.
      at?: { x: number; y: number },
    ) => {
      const flow = flowRef.current;
      const centre =
        at ??
        (flow
          ? flow.screenToFlowPosition({
              x: window.innerWidth / 2,
              y: window.innerHeight / 2,
            })
          : { x: 40, y: 40 });
      const size = defaultSizeOf(kind);
      const jitter = at ? 0 : (nodes.length % 5) * 24;
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
      commit([op]);
      // The new card becomes the selection, so the chrome (remove, eye,
      // recolour) is immediately reachable — plain language, no hunting.
      setOneSelected(op.id);
      return op.id;
    },
    [commit, nodes.length, setOneSelected],
  );

  // --------------------------------------------------------------------------
  // Interactions (spec 6.2 keyboard/clipboard/layers/groups)
  // --------------------------------------------------------------------------
  const toggleStudentVisible = useCallback(
    (cardId: string, visible: boolean) => {
      commit([{ op: "node.update", id: cardId, student_visible: visible }]);
    },
    [commit],
  );

  /** Nudge every selected card by one 20 px grid step (one undo entry). */
  const nudgeSelected = useCallback(
    (dx: number, dy: number) => {
      if (selectedCardIds.length === 0) return;
      const ops: CanvasOp[] = [];
      for (const id of selectedCardIds) {
        const card = stateRef.current.cards[id];
        if (!card) continue;
        const x = snap(card.x + dx, GRID_SIZE);
        const y = snap(card.y + dy, GRID_SIZE);
        if (x === card.x && y === card.y) continue;
        ops.push({ op: "node.update", id, x, y });
      }
      commit(ops);
    },
    [commit, selectedCardIds],
  );

  /** Copies of the cards (+ edges between them) shifted one grid step. */
  const buildDuplicateOps = useCallback(
    (cards: readonly CanvasCard[], edges: readonly CanvasEdge[]) => {
      const idMap = new Map<string, string>();
      for (const card of cards) idMap.set(card.id, crypto.randomUUID());
      const ops: CanvasOp[] = cards.map((card) => ({
        op: "node.add",
        id: idMap.get(card.id) as string,
        kind: card.kind,
        x: card.x + GRID_SIZE,
        y: card.y + GRID_SIZE,
        width: card.width,
        height: card.height,
        z: card.z,
        color: card.color,
        body: card.body ?? undefined,
        label: card.label ?? undefined,
        url: card.url ?? undefined,
        node_id: card.nodeId ?? undefined,
        asset_id: card.assetId ?? undefined,
        student_visible: card.studentVisible,
      })) as CanvasOp[];
      for (const edge of edges) {
        const from = idMap.get(edge.from);
        const to = idMap.get(edge.to);
        if (!from || !to) continue;
        ops.push({
          op: "edge.add",
          id: crypto.randomUUID(),
          from_node: from,
          to_node: to,
          from_side: edge.fromSide,
          to_side: edge.toSide,
          from_end: edge.fromEnd,
          to_end: edge.toEnd,
          label: edge.label ?? undefined,
          color: edge.color,
        } as CanvasOp);
      }
      return ops;
    },
    [],
  );

  /** Ctrl/Cmd+D duplicates the selection with the same references. */
  const duplicateSelected = useCallback(() => {
    const batch = new Set(selectedCardIds);
    if (batch.size === 0) return;
    const cards = selectedCardIds
      .map((id) => stateRef.current.cards[id])
      .filter((card): card is CanvasCard => card !== undefined);
    const between = Object.values(stateRef.current.edges).filter(
      (edge) => batch.has(edge.from) && batch.has(edge.to),
    );
    commit(buildDuplicateOps(cards, between));
  }, [commit, selectedCardIds, buildDuplicateOps]);

  /** Ctrl/Cmd+C keeps the snapshot for paste-as-cards, plus clipboard text. */
  const copySelected = useCallback(() => {
    const batch = new Set(selectedCardIds);
    if (batch.size === 0) return;
    const cards = selectedCardIds
      .map((id) => stateRef.current.cards[id])
      .filter((card): card is CanvasCard => card !== undefined);
    const between = Object.values(stateRef.current.edges).filter(
      (edge) => batch.has(edge.from) && batch.has(edge.to),
    );
    const text = snapshotText(cards);
    copyRef.current = { cards, edges: between, text };
    // Best effort only: pasting never depends on the system clipboard.
    void navigator.clipboard.writeText(text).catch(() => {});
  }, [selectedCardIds]);

  /** Ctrl/Cmd+V pastes: cards snapshot, or plain text / a URL as a new card. */
  const pasteFromClipboard = useCallback(
    (text: string) => {
      const snapshot = copyRef.current;
      if (snapshot && snapshot.text !== "" && snapshot.text === text) {
        commit(buildDuplicateOps(snapshot.cards, snapshot.edges));
        return;
      }
      const trimmed = text.trim();
      if (!trimmed) return;
      if (/^https?:\/\//i.test(trimmed)) {
        addCard("link", { url: trimmed, label: trimmed.slice(0, 200) });
      } else {
        addCard("text", { body: trimmed.slice(0, 20000) });
      }
    },
    [commit, buildDuplicateOps, addCard],
  );

  /** `G`: a group frame (padding 40) that wraps the selection. */
  const groupSelected = useCallback(() => {
    if (selectedCardIds.length === 0) return;
    const cards = selectedCardIds
      .map((id) => stateRef.current.cards[id])
      .filter((card): card is CanvasCard => card !== undefined);
    const rect = unionRect(cards);
    if (!rect) return;
    const op: CanvasOp = {
      op: "node.add",
      id: crypto.randomUUID(),
      kind: "group",
      label: "New group",
      x: snap(rect.x - 40, GRID_SIZE),
      y: snap(rect.y - 40, GRID_SIZE),
      width: rect.width + 80,
      height: rect.height + 80,
    } as CanvasOp;
    commit([op]);
    setOneSelected(op.id);
  }, [commit, selectedCardIds, setOneSelected]);

  /**
   * `]` / `[`: bring to front / send to back. Plain cards live in 0…1000,
   * groups stay in −1000…−1 (spec 6.2), so the two never collide.
   */
  const layerSelected = useCallback(
    (toFront: boolean) => {
      if (selectedCardIds.length === 0) return;
      const batch = new Set(selectedCardIds);
      const others = Object.values(stateRef.current.cards).filter(
        (card) => !batch.has(card.id),
      );
      const plain = others
        .filter((card) => card.kind !== "group")
        .map((card) => card.z);
      const grouped = others
        .filter((card) => card.kind === "group")
        .map((card) => card.z);
      const nextZ = (kind: CanvasCard["kind"]): number => {
        if (kind === "group") {
          const max = grouped.length > 0 ? Math.max(...grouped) : -1;
          const min = grouped.length > 0 ? Math.min(...grouped) : -1;
          return toFront
            ? Math.max(-1000, Math.min(-1, max + 1))
            : Math.max(-1000, min - 1);
        }
        const max = plain.length > 0 ? Math.max(...plain) : 0;
        const min = plain.length > 0 ? Math.min(...plain) : 0;
        return toFront ? Math.min(1000, max + 1) : Math.max(-1000, min - 1);
      };
      const ops: CanvasOp[] = [];
      for (const id of selectedCardIds) {
        const card = stateRef.current.cards[id];
        if (!card) continue;
        const z = nextZ(card.kind);
        if (z === card.z) continue;
        ops.push({ op: "node.update", id, z });
      }
      commit(ops);
    },
    [commit, selectedCardIds],
  );

  /** Tab / Shift+Tab walk the cards in reading order (top rows first). */
  const tabTo = useCallback(
    (step: 1 | -1) => {
      const cards = Object.values(stateRef.current.cards);
      if (cards.length === 0) return;
      const rowBand = GRID_SIZE * 5;
      const order = [...cards].sort(
        (a, b) =>
          Math.round(a.y / rowBand) - Math.round(b.y / rowBand) ||
          a.x - b.x ||
          a.id.localeCompare(b.id),
      );
      const current = selectedCardIds[selectedCardIds.length - 1];
      const index = order.findIndex((card) => card.id === current);
      const next =
        order[(index + step + order.length) % order.length] ?? order[0]!;
      setOneSelected(next.id);
      centerOn(next);
    },
    [centerOn, selectedCardIds, setOneSelected],
  );

  /** Alt+Arrow: nearest connected card in that direction (follows edges). */
  const focusConnected = useCallback(
    (dx: number, dy: number) => {
      const anchorId = selectedCardIds[selectedCardIds.length - 1];
      const anchor = anchorId ? stateRef.current.cards[anchorId] : null;
      if (!anchorId || !anchor) return;
      let best: { id: string; score: number } | null = null;
      for (const edge of Object.values(stateRef.current.edges)) {
        const otherId =
          edge.from === anchorId
            ? edge.to
            : edge.to === anchorId
              ? edge.from
              : null;
        if (!otherId) continue;
        const other = stateRef.current.cards[otherId];
        if (!other) continue;
        const ddx = other.x - anchor.x;
        const ddy = other.y - anchor.y;
        const length = Math.hypot(ddx, ddy);
        const along = ddx * dx + ddy * dy;
        if (length === 0 || along <= 0) continue;
        const score = along / length;
        if (!best || score > best.score) best = { id: otherId, score };
      }
      if (!best) return;
      setOneSelected(best.id);
      const target = stateRef.current.cards[best.id];
      if (target) centerOn(target);
    },
    [centerOn, selectedCardIds, setOneSelected],
  );

  // --------------------------------------------------------------------------
  // Group-follow drag (spec 6.2): moving a group moves the cards whose
  // centres were inside it at drag start, as ONE batched action.
  // --------------------------------------------------------------------------
  const onNodeDragStart: OnNodeDrag<RfNode> = useCallback((_event, node) => {
    if (node.data.card.kind !== "group") {
      groupDragRef.current = null;
      return;
    }
    const card = stateRef.current.cards[node.id];
    if (!card) {
      groupDragRef.current = null;
      return;
    }
    groupDragRef.current = {
      groupId: node.id,
      origin: { x: card.x, y: card.y },
      followers: cardsInsideGroup(
        card,
        Object.values(stateRef.current.cards),
      ).map((member) => ({ id: member.id, x: member.x, y: member.y })),
    };
  }, []);

  const onNodeDragStop: OnNodeDrag<RfNode> = useCallback(
    (_event, _node, nodes) => {
      const snapshot = groupDragRef.current;
      groupDragRef.current = null;
      const ops: CanvasOp[] = [];
      const touched = new Set<string>();
      for (const dragged of nodes) {
        const card = stateRef.current.cards[dragged.id];
        if (!card) continue;
        const x = snap(dragged.position.x, GRID_SIZE);
        const y = snap(dragged.position.y, GRID_SIZE);
        if (x === card.x && y === card.y) continue;
        ops.push({ op: "node.update", id: dragged.id, x, y });
        touched.add(dragged.id);
      }
      if (snapshot && touched.has(snapshot.groupId)) {
        const groupOp = ops.find(
          (op): op is Extract<CanvasOp, { op: "node.update" }> =>
            op.op === "node.update" && op.id === snapshot.groupId,
        );
        const dx = groupOp?.x !== undefined ? groupOp.x - snapshot.origin.x : 0;
        const dy = groupOp?.y !== undefined ? groupOp.y - snapshot.origin.y : 0;
        for (const follower of snapshot.followers) {
          if (touched.has(follower.id)) continue;
          const x = snap(follower.x + dx, GRID_SIZE);
          const y = snap(follower.y + dy, GRID_SIZE);
          if (x === follower.x && y === follower.y) continue;
          ops.push({ op: "node.update", id: follower.id, x, y });
        }
      }
      if (ops.length > 0) commit(ops);
    },
    [commit],
  );

  // --------------------------------------------------------------------------
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
      commit([op]);
    },
    [commit],
  );

  // --------------------------------------------------------------------------
  // Side pane (spec 6.6): clicking a note or file card (or pressing Enter on
  // a focused one) opens it on the right. Note bodies load through the
  // server action once and are cached per note id.
  // --------------------------------------------------------------------------
  const activatePane = useCallback((cardId: string) => {
    setPaneActive(cardId);
  }, []);

  const loadNoteBody = useCallback(
    async (cardId: string, nodeId: string) => {
      const result = await getNoteBodyAction(payload.id, nodeId);
      if ("error" in result) {
        setPaneEntries((current) =>
          current.map((entry) =>
            entry.cardId === cardId && entry.type === "note"
              ? { ...entry, loading: false, error: result.error }
              : entry,
          ),
        );
        return;
      }
      noteBodyRef.current.set(nodeId, {
        body: result.body,
        canWrite: result.canWrite,
        canBreakLock: result.canBreakLock,
        title: result.title,
      });
      setPaneEntries((current) =>
        current.map((entry) =>
          entry.cardId === cardId && entry.type === "note"
            ? {
                ...entry,
                loading: false,
                title: result.title,
                body: result.body,
                error: null,
                canWrite: result.canWrite,
                canBreakLock: result.canBreakLock,
              }
            : entry,
        ),
      );
    },
    [payload.id],
  );

  const openPaneFor = useCallback(
    (cardId: string) => {
      const card = stateRef.current.cards[cardId];
      if (!card || !payload.currentUserId) return;
      setPaneActive(cardId);
      if (paneEntries.some((entry) => entry.cardId === cardId)) return;
      if (card.kind === "file" && card.assetId) {
        const assetId = card.assetId;
        const file = filesRef.current[assetId];
        if (!file) return;
        setPaneEntries((current) =>
          capPane(current, {
            type: "file",
            cardId,
            title: file.name,
            loading: false,
            file,
          }),
        );
        return;
      }
      if (card.kind === "note" && card.nodeId) {
        const nodeId = card.nodeId;
        const cached = noteBodyRef.current.get(nodeId);
        if (cached) {
          setPaneEntries((current) =>
            capPane(current, {
              type: "note",
              cardId,
              title: cached.title,
              loading: false,
              body: cached.body,
              error: null,
              nodeId,
              canWrite: cached.canWrite,
              canBreakLock: cached.canBreakLock,
            }),
          );
          return;
        }
        setPaneEntries((current) =>
          capPane(current, {
            type: "note",
            cardId,
            title: notesRef.current[nodeId]?.title ?? "Note",
            loading: true,
            body: null,
            error: null,
            nodeId,
            canWrite: false,
            canBreakLock: false,
          }),
        );
        void loadNoteBody(cardId, nodeId);
      }
    },
    [loadNoteBody, paneEntries, payload.currentUserId],
  );

  /** Closing returns focus to the card (spec 6.6, plain tab order). */
  const closePane = useCallback(
    (cardId: string | null) => {
      const focusId = cardId ?? paneActive;
      if (cardId === null) {
        setPaneEntries([]);
      } else {
        const remaining = paneEntries.filter(
          (entry) => entry.cardId !== cardId,
        );
        setPaneEntries(remaining);
        if (paneActive === cardId) {
          setPaneActive(remaining[remaining.length - 1]?.cardId ?? null);
        }
      }
      // React Flow node wrappers carry data-id; focus back to the card.
      const el =
        focusId !== null
          ? document.querySelector(`[data-id="${focusId}"]`)
          : null;
      if (el instanceof HTMLElement) el.focus();
    },
    [paneActive, paneEntries],
  );

  /** Clicking a note or file card opens it in the pane (spec 6.6). */
  const onNodeClick = useCallback(
    (_event: ReactMouseEvent, node: RfNode) => {
      const card = node.data.card;
      if (card.kind === "note" || card.kind === "file") openPaneFor(card.id);
    },
    [openPaneFor],
  );

  // --------------------------------------------------------------------------
  // Browser glue for the save queue and the shortcuts (spec 6.3 + 6.4)
  // --------------------------------------------------------------------------
  useEffect(() => {
    const queue = getQueue();
    queue.setOnline(navigator.onLine);
    const online = () => queue.setOnline(true);
    const offline = () => queue.setOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [getQueue]);

  // Flush immediately on blur / when the tab goes away; warn before an
  // unload only while the queue still holds unsaved changes (spec 6.4).
  useEffect(() => {
    const queue = getQueue();
    const flushOnBlur = () => queue.flushNow();
    const flushOnHidden = () => {
      if (!document.hidden) return;
      queue.flushNow();
    };
    const warnUnload = (event: BeforeUnloadEvent) => {
      if (queue.hasPending()) event.preventDefault();
    };
    window.addEventListener("blur", flushOnBlur);
    document.addEventListener("visibilitychange", flushOnHidden);
    window.addEventListener("beforeunload", warnUnload);
    return () => {
      window.removeEventListener("blur", flushOnBlur);
      document.removeEventListener("visibilitychange", flushOnHidden);
      window.removeEventListener("beforeunload", warnUnload);
    };
  }, [getQueue]);

  // Another leader edited the map while we were away (spec 6.4): only when
  // our own queue is empty, compare the cheap server rev; if it moved,
  // refetch. M13 replaces this with live updates.
  useEffect(() => {
    const queue = getQueue();
    const checkRev = () => {
      if (document.hidden || queue.hasPending()) return;
      void getCanvasRevAction(payload.id).then((serverRev) => {
        if (
          serverRev !== null &&
          serverRev !== stateRef.current.rev &&
          !queue.hasPending()
        ) {
          router.refresh();
        }
      });
    };
    window.addEventListener("focus", checkRev);
    document.addEventListener("visibilitychange", checkRev);
    return () => {
      window.removeEventListener("focus", checkRev);
      document.removeEventListener("visibilitychange", checkRev);
    };
  }, [getQueue, payload.id, router]);

  // The full §6.3 table that works without extra UI (the palette, the
  // side pane and the `?` sheet attach to their own slices). Shortcuts
  // never fire while a text field, contenteditable or a palette input has
  // focus (spec 6.3).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && !event.shiftKey && key === "z") {
        event.preventDefault();
        undo();
        return;
      }
      if (
        (mod && event.shiftKey && key === "z") ||
        (mod && !event.shiftKey && key === "y")
      ) {
        event.preventDefault();
        redo();
        return;
      }
      if (mod && key === "s") {
        // Ctrl+S saves a named version (spec 6.3); flush the queue first so
        // the version contains the unsaved changes.
        event.preventDefault();
        getQueue().flushNow();
        setVersionsOpen(true);
        return;
      }
      if (mod && key === "a") {
        event.preventDefault();
        setAllSelected();
        return;
      }
      if (mod && !event.shiftKey && key === "c") {
        event.preventDefault();
        copySelected();
        return;
      }
      if (mod && !event.shiftKey && key === "d") {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      const arrow = ARROW_NUDGE[key as keyof typeof ARROW_NUDGE];
      if (arrow) {
        event.preventDefault();
        if (event.altKey) {
          focusConnected(arrow[0], arrow[1]);
        } else {
          nudgeSelected(arrow[0], arrow[1]);
        }
        return;
      }
      if (key === "delete" || key === "backspace") {
        if (selectedCardIds.length > 0) {
          event.preventDefault();
          removeCards(selectedCardIds);
        }
        return;
      }
      if (key === "tab") {
        event.preventDefault();
        tabTo(event.shiftKey ? -1 : 1);
        return;
      }
      if (
        key === "enter" &&
        selectedCardIds.length > 0 &&
        payload.currentUserId !== null
      ) {
        // Enter on a focused card opens the side pane (spec 6.6) — unless
        // the focus sits on a button or link, which keeps its own meaning.
        const skipped =
          event.target instanceof HTMLElement &&
          event.target.closest("button, a, [role='button']") !== null;
        if (!skipped) {
          event.preventDefault();
          openPaneFor(selectedCardIds[selectedCardIds.length - 1]!);
        }
        return;
      }
      if (key === "escape") {
        // Close pane, menu, sheet, selection (spec 6.3 / 6.6).
        if (paneActive !== null) {
          closePane(null);
        } else if (picker !== null) {
          closePicker();
        } else if (legendOpen) {
          setLegendOpen(false);
        } else if (versionsOpen) {
          setVersionsOpen(false);
        } else {
          clearSelection();
        }
        return;
      }
      if (mod || event.altKey) return;
      if (key === "n") {
        event.preventDefault();
        addCard("text", { body: "Write here…" });
        return;
      }
      if (key === "g") {
        event.preventDefault();
        groupSelected();
        return;
      }
      if (key === "]") {
        event.preventDefault();
        layerSelected(true);
        return;
      }
      if (key === "[") {
        event.preventDefault();
        layerSelected(false);
        return;
      }
      if (key === "+" || key === "=") {
        event.preventDefault();
        flowRef.current?.zoomIn();
        return;
      }
      if (key === "-" || key === "_") {
        event.preventDefault();
        flowRef.current?.zoomOut();
        return;
      }
      if (key === "0") {
        event.preventDefault();
        flowRef.current?.fitView();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    addCard,
    closePicker,
    copySelected,
    duplicateSelected,
    clearSelection,
    closePane,
    focusConnected,
    getQueue,
    groupSelected,
    layerSelected,
    legendOpen,
    picker,
    nudgeSelected,
    openPaneFor,
    paneActive,
    payload.currentUserId,
    redo,
    removeCards,
    selectedCardIds,
    setAllSelected,
    tabTo,
    undo,
    versionsOpen,
  ]);

  /** Double-click on empty space adds a text card there (spec 6.2). */
  const onCanvasDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        !target.classList.contains("react-flow__pane")
      ) {
        return;
      }
      const flow = flowRef.current;
      if (!flow) return;
      const at = flow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      addCard("text", { body: "Write here…" }, at);
    },
    [addCard],
  );

  // --------------------------------------------------------------------------
  // Drag-drop and paste upload (spec 6.5): the M6 upload pipeline is reused
  // end to end — validateUpload, Storage under "{course_id}/…", then the
  // existing registerUploadAction. One file card per upload, each further
  // file offset by 24 px; per-file progress chips; a failure adds no card.
  // --------------------------------------------------------------------------
  const updateChip = useCallback((key: string, patch: Partial<UploadChip>) => {
    setUploads((current) =>
      current.map((chip) => (chip.key === key ? { ...chip, ...patch } : chip)),
    );
  }, []);

  /** Chips leave quietly once their message has been seen. */
  const dropChipLater = useCallback((key: string, delay: number) => {
    window.setTimeout(() => {
      setUploads((current) => current.filter((chip) => chip.key !== key));
    }, delay);
  }, []);

  const uploadFiles = useCallback(
    async (fileList: readonly File[], at?: { x: number; y: number }) => {
      const flow = flowRef.current;
      const origin =
        at ??
        (flow
          ? flow.screenToFlowPosition({
              x: window.innerWidth / 2,
              y: window.innerHeight / 2,
            })
          : { x: 40, y: 40 });
      const files = Array.from(fileList).slice(0, 10);
      const maxBytes = payload.maxFileMb * 1024 * 1024;
      for (const [index, file] of files.entries()) {
        const key = `${Date.now()}-${index}`;
        const cardAt =
          index === 0
            ? { x: origin.x, y: origin.y }
            : { x: origin.x + index * 24, y: origin.y + index * 24 };
        const fail = (message: string) => {
          updateChip(key, { state: "error", message });
          dropChipLater(key, 10000);
        };
        setUploads((current) => [
          ...current,
          { key, name: file.name, state: "working", message: "Checking…" },
        ]);
        if (file.size > maxBytes) {
          fail(
            `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB — over the ${payload.maxFileMb} MB limit.`,
          );
          continue;
        }
        const check = validateUpload(
          file.name,
          new Uint8Array(await file.arrayBuffer()),
        );
        if (!check.ok) {
          fail(check.reason);
          continue;
        }
        updateChip(key, { message: "Uploading…" });
        const path = randomStoragePath(payload.courseId, file.name);
        const supabase = createBrowserSupabase();
        const { error: uploadError } = await supabase.storage
          .from("assets")
          .upload(path, file, { contentType: check.mime });
        if (uploadError) {
          fail("The upload failed. Check your connection and try again.");
          continue;
        }
        updateChip(key, { message: "Saving…" });
        const formData = new FormData();
        formData.set("course_id", payload.courseId);
        // Canvas file cards attach to the course, not to one note.
        formData.set("node_id", "");
        formData.set("kind", check.kind);
        formData.set("path_or_url", path);
        formData.set("title", file.name.slice(0, 200));
        formData.set("mime", check.mime);
        formData.set("size_bytes", String(file.size));
        const result = await registerUploadAction(null, formData);
        if (result && "error" in result && result.error) {
          fail(result.error);
          continue;
        }
        const assetId = result && "ok" in result ? result.assetId : null;
        if (!assetId) {
          fail("The upload was not allowed. Refresh and try again.");
          continue;
        }
        // Same optimistic hand-off the picker uses: the card resolves the
        // server truth (visibility, download flag) on the next page load.
        filesRef.current = {
          ...filesRef.current,
          [assetId]: {
            id: assetId,
            name: file.name,
            kind: check.kind,
            mime: check.mime,
            bytes: file.size,
            visible: true,
            downloadable: false,
            pathOrUrl: path,
          },
        };
        addCard(
          "file",
          { asset_id: assetId, label: file.name.slice(0, 200) },
          cardAt,
        );
        updateChip(key, { state: "done", message: "Added to the map" });
        dropChipLater(key, 4000);
      }
    },
    [addCard, dropChipLater, payload.courseId, payload.maxFileMb, updateChip],
  );

  /** Only real files light up the drop highlight and accept a drop. */
  const hasDragFiles = (event: {
    dataTransfer: { types: readonly string[] };
  }): boolean => event.dataTransfer.types.includes("Files");

  const onCanvasDragEnter = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!hasDragFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragOver(true);
    },
    [],
  );

  const onCanvasDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!hasDragFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [],
  );

  const onCanvasDragLeave = useCallback(() => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  }, []);

  const onCanvasDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!hasDragFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setDragOver(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) return;
      const flow = flowRef.current;
      const at = flow
        ? flow.screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          })
        : undefined;
      void uploadFiles(files, at);
    },
    [uploadFiles],
  );

  // Ctrl/Cmd+V surfaces as a paste event, which can read the payload; the
  // internal card snapshot wins when the text matches, plain text / a URL
  // becomes a card, and an image goes through the upload pipeline (spec 6.2).
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const images = event.clipboardData
        ? Array.from(event.clipboardData.files).filter((file) =>
            file.type.startsWith("image/"),
          )
        : [];
      if (images.length > 0) {
        event.preventDefault();
        void uploadFiles(images);
        return;
      }
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;
      event.preventDefault();
      pasteFromClipboard(text);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [pasteFromClipboard, uploadFiles]);

  const contextValue = useMemo<CanvasContextValue>(
    () => ({
      queueOps,
      removeCard,
      recolourCard: recolourSelected,
      toggleStudentVisible,
    }),
    [queueOps, removeCard, recolourSelected, toggleStudentVisible],
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
        onRetrySave={() => getQueue().retry()}
        onAddText={() => addCard("text", { body: "Write here…" })}
        onAddNote={() => openPicker("note")}
        onAddFile={() => openPicker("file")}
        onAddUpload={() => uploadInputRef.current?.click()}
        onAddGroup={() => addCard("group", { label: "New group" })}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        selectedCardIds={selectedCardIds}
        onRecolour={recolourSelected}
        onRemoveSelected={() => removeCards(selectedCardIds)}
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

      {saveStatus === "offline" ? (
        <p
          role="status"
          aria-live="polite"
          className="mx-2 rounded border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-1.5 text-xs font-semibold"
        >
          You are offline. Your changes are kept on this page until you are
          back.
        </p>
      ) : null}

      {uploads.length > 0 ? (
        // Drag-drop upload progress (spec 6.5: a chip per file, plain
        // language on failure).
        <ul aria-live="polite" className="mx-2 grid gap-1">
          {uploads.map((chip) => (
            <li
              key={chip.key}
              className={[
                "flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs font-semibold",
                chip.state === "error"
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-border bg-background",
              ].join(" ")}
            >
              <span aria-hidden="true">
                {chip.state === "done"
                  ? "✓"
                  : chip.state === "error"
                    ? "⚠"
                    : "⏳"}
              </span>
              <span className="max-w-60 truncate" dir="auto">
                {chip.name}
              </span>
              <span
                className={
                  chip.state === "error" ? "" : "text-muted-foreground"
                }
              >
                {chip.message}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex h-[calc(100dvh-9rem)] w-full">
        <div
          className={`min-w-0 flex-1 rounded-lg ${
            dragOver ? "ring-ring ring-2 ring-offset-2" : ""
          }`}
          onDoubleClick={onCanvasDoubleClick}
          onDragEnter={onCanvasDragEnter}
          onDragOver={onCanvasDragOver}
          onDragLeave={onCanvasDragLeave}
          onDrop={onCanvasDrop}
        >
          <ReactFlow
            onInit={(flow) => {
              flowRef.current = flow;
            }}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChangeAll}
            onEdgesChange={onEdgesChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onConnect={onConnect}
            nodeTypes={canvasNodeTypes}
            edgeTypes={canvasEdgeTypes}
            connectionMode={ConnectionMode.Loose}
            onlyRenderVisibleElements
            // Spec 6.2 "Select many": Shift + drag a box, Ctrl + click adds.
            selectionKeyCode="Shift"
            multiSelectionKeyCode="Control"
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

        {paneActive !== null &&
        paneEntries.length > 0 &&
        payload.currentUserId !== null ? (
          <SidePane
            entries={paneEntries}
            activeId={paneActive}
            courseId={payload.courseId}
            userId={payload.currentUserId}
            onClose={() => closePane(null)}
            onActivate={activatePane}
          />
        ) : null}
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
              onClick={undo}
              className="text-destructive underline underline-offset-2"
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}

      <input
        ref={uploadInputRef}
        type="file"
        multiple
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const files = event.target.files;
          if (files && files.length > 0) {
            void uploadFiles(Array.from(files));
          }
          event.target.value = "";
        }}
      />
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
