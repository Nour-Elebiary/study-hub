/**
 * Pure client-side mirror of the `canvas_apply_ops` RPC (CANVAS-SPEC
 * section 5.4). The editor applies ops optimistically with these functions
 * and the server remains the source of truth; on a server failure the whole
 * state is refetched. Every rule here mirrors migration 00019 exactly:
 *
 *   * ops apply in order, later ops win (last-write-wins, D6);
 *   * ids that do not exist are skipped, never thrown (the DB would count
 *     them as skipped rows; the client just ignores them);
 *   * `node.update` keys: an explicit `null` SETS the column (clears it), an
 *     absent key keeps the old value — same "key presence" logic as the RPC.
 *
 * `invertOps` builds the undo list for a batch. Rules per spec: node.add ↔
 * node.delete; node.update ↔ node.update with the previous values (null
 * colours included); node.delete inverts to a node.add plus one edge.add per
 * edge its removal cascaded; edge.delete inverts to an edge.add. The inverse
 * list applies FORWARD in the order returned, and that order is the reverse
 * of the forward batch so multi-step selections undo cleanly.
 *
 * One documented asymmetry (same one the wire schema has): a card's body
 * cannot be re-cleared to null over ops (`canvas_nodes_ref_by_kind` forbids
 * empty text bodies), so an inverse can only restore a previous body when it
 * was a string. Undo of "cleared then re-typed" still round-trips through
 * node.delete/node.add pairs; `invertOps` simply omits a null-body restore.
 */
import type { CanvasOp } from "./schemas";
import type {
  EdgeAddOp,
  EdgeUpdateOp,
  NodeAddOp,
  NodeUpdateOp,
} from "./schemas";
import { CARD_DEFAULT_SIZE } from "./defaults";
import type { CanvasCard, CanvasEdge, CanvasState } from "./types";

const cardFromOp = (op: NodeAddOp): CanvasCard => ({
  id: op.id,
  kind: op.kind,
  nodeId: op.node_id ?? null,
  assetId: op.asset_id ?? null,
  url: op.url ?? null,
  x: op.x,
  y: op.y,
  width: op.width,
  height: op.height,
  z: op.z ?? 0,
  color: op.color ?? null,
  body: op.body ?? null,
  label: op.label ?? null,
  studentVisible: op.student_visible ?? true,
});

const edgeFromOp = (op: EdgeAddOp, id: string): CanvasEdge => ({
  id,
  from: op.from_node,
  to: op.to_node,
  fromSide: op.from_side ?? "right",
  toSide: op.to_side ?? "left",
  fromEnd: op.from_end ?? "none",
  toEnd: op.to_end ?? "arrow",
  label: op.label ?? null,
  color: op.color ?? null,
});

function applyOne(
  cards: Record<string, CanvasCard>,
  edges: Record<string, CanvasEdge>,
  op: CanvasOp,
): boolean {
  switch (op.op) {
    case "node.add": {
      // A duplicate id would refuse the whole database batch; here it is
      // simply skipped so the local mirror never throws.
      if (cards[op.id]) return false;
      cards[op.id] = cardFromOp(op);
      return true;
    }
    case "node.update": {
      const card = cards[op.id];
      if (!card) return false;
      if (op.x !== undefined) card.x = op.x;
      if (op.y !== undefined) card.y = op.y;
      if (op.width !== undefined) card.width = op.width;
      if (op.height !== undefined) card.height = op.height;
      if (op.z !== undefined) card.z = op.z;
      if (op.color !== undefined) card.color = op.color; // null clears
      if (op.body !== undefined) card.body = op.body;
      if (op.label !== undefined) card.label = op.label; // null clears
      if (op.url !== undefined) card.url = op.url; // null clears
      if (op.student_visible !== undefined)
        card.studentVisible = op.student_visible;
      return true;
    }
    case "node.delete": {
      if (!cards[op.id]) return false;
      delete cards[op.id];
      for (const edgeId of Object.keys(edges)) {
        const edge = edges[edgeId]!;
        if (edge.from === op.id || edge.to === op.id) delete edges[edgeId];
      }
      return true;
    }
    case "edge.add": {
      // Endpoints must exist locally (the database enforces this with a
      // foreign key and would fail the whole batch; the mirror forgives).
      if (edges[op.id] || !cards[op.from_node] || !cards[op.to_node])
        return false;
      edges[op.id] = edgeFromOp(op, op.id);
      return true;
    }
    case "edge.update": {
      const edge = edges[op.id];
      if (!edge) return false;
      if (op.from_side !== undefined) edge.fromSide = op.from_side;
      if (op.to_side !== undefined) edge.toSide = op.to_side;
      if (op.from_end !== undefined) edge.fromEnd = op.from_end;
      if (op.to_end !== undefined) edge.toEnd = op.to_end;
      if (op.label !== undefined) edge.label = op.label;
      if (op.color !== undefined) edge.color = op.color;
      return true;
    }
    case "edge.delete": {
      if (!edges[op.id]) return false;
      delete edges[op.id];
      return true;
    }
  }
}

/** Applies a whole batch and bumps `rev` by one, like the RPC. */
export function applyOps(
  state: CanvasState,
  ops: readonly CanvasOp[],
): CanvasState {
  // Shallow copies; update/delete callbacks mutate the copies in place.
  const cards: Record<string, CanvasCard> = {};
  for (const [id, card] of Object.entries(state.cards)) cards[id] = { ...card };
  const edges: Record<string, CanvasEdge> = {};
  for (const [id, edge] of Object.entries(state.edges)) edges[id] = { ...edge };

  for (const op of ops) applyOne(cards, edges, op);

  return { cards, edges, rev: state.rev + 1 };
}

const nodeAddFromCard = (card: CanvasCard): NodeAddOp => ({
  op: "node.add",
  id: card.id,
  kind: card.kind,
  node_id: card.nodeId ?? undefined,
  asset_id: card.assetId ?? undefined,
  url: card.url ?? undefined,
  x: card.x,
  y: card.y,
  width: card.width,
  height: card.height,
  z: card.z !== 0 ? card.z : undefined,
  color: card.color,
  body: card.body ?? undefined,
  label: card.label ?? undefined,
  student_visible: !card.studentVisible ? false : undefined,
});

const edgeAddFromEdge = (edge: CanvasEdge): EdgeAddOp => ({
  op: "edge.add",
  id: edge.id,
  from_node: edge.from,
  to_node: edge.to,
  from_side: edge.fromSide !== "right" ? edge.fromSide : undefined,
  to_side: edge.toSide !== "left" ? edge.toSide : undefined,
  from_end: edge.fromEnd !== "none" ? edge.fromEnd : undefined,
  to_end: edge.toEnd !== "arrow" ? edge.toEnd : undefined,
  label: edge.label ?? undefined,
  color: edge.color,
});

/**
 * Builds the undo list for a batch run against `before`. Ops that were
 * skipped locally (unknown ids, duplicate adds) contribute nothing, so the
 * property "apply → invert → apply equals before" always holds for locally
 * plausible batches.
 */
export function invertOps(
  before: CanvasState,
  ops: readonly CanvasOp[],
): CanvasOp[] {
  const cards: Record<string, CanvasCard> = {};
  for (const [id, card] of Object.entries(before.cards))
    cards[id] = { ...card };
  const edges: Record<string, CanvasEdge> = {};
  for (const [id, edge] of Object.entries(before.edges))
    edges[id] = { ...edge };

  // One undo group per applied op, in forward order; the returned list is
  // the concatenation of the groups in reverse (spec: reverse order).
  const groups: CanvasOp[][] = [];

  const removeCardAndCascade = (id: string) => {
    delete cards[id];
    for (const edgeId of Object.keys(edges)) {
      const edge = edges[edgeId]!;
      if (edge.from === id || edge.to === id) delete edges[edgeId];
    }
  };

  for (const op of ops) {
    const undo: CanvasOp[] = [];
    switch (op.op) {
      // Inverse against the state BEFORE this op (inputs below). Copy the
      // needed "before" values first — the forward application runs right
      // after the undo list for this op is built.
      case "node.add":
        if (!cards[op.id]) {
          undo.push({ op: "node.delete", id: op.id });
          cards[op.id] = cardFromOp(op);
        }
        break;
      case "node.update": {
        const card = cards[op.id];
        if (card) {
          const back: NodeUpdateOp = { op: "node.update", id: op.id };
          if (op.x !== undefined) back.x = card.x;
          if (op.y !== undefined) back.y = card.y;
          if (op.width !== undefined) back.width = card.width;
          if (op.height !== undefined) back.height = card.height;
          if (op.z !== undefined) back.z = card.z;
          if (op.color !== undefined) back.color = card.color; // null restores null
          if (op.label !== undefined) back.label = card.label; // null restores null
          if (op.url !== undefined) back.url = card.url; // null restores null
          if (op.student_visible !== undefined)
            back.student_visible = card.studentVisible;
          // body: only restorable when the previous body was a string (see
          // module comment about the body-clearing asymmetry).
          if (
            op.body !== undefined &&
            card.body !== null &&
            card.body !== undefined
          ) {
            back.body = card.body;
          }
          if (Object.keys(back).length > 2) undo.push(back);
          applyOne(cards, edges, op);
        }
        break;
      }
      case "node.delete": {
        const card = cards[op.id];
        if (card) {
          // Restore order matters for foreign keys: the card first, then the
          // edges that the delete cascaded (in stored edge order).
          const cascaded = Object.values(edges).filter(
            (edge) => edge.from === op.id || edge.to === op.id,
          );
          undo.push(nodeAddFromCard(card));
          for (const edge of cascaded) undo.push(edgeAddFromEdge(edge));
          removeCardAndCascade(op.id);
        }
        break;
      }
      case "edge.add":
        if (!edges[op.id] && cards[op.from_node] && cards[op.to_node]) {
          undo.push({ op: "edge.delete", id: op.id });
          edges[op.id] = edgeFromOp(op, op.id);
        }
        break;
      case "edge.update": {
        const edge = edges[op.id];
        if (edge) {
          const back: EdgeUpdateOp = { op: "edge.update", id: op.id };
          if (op.from_side !== undefined) back.from_side = edge.fromSide;
          if (op.to_side !== undefined) back.to_side = edge.toSide;
          if (op.from_end !== undefined) back.from_end = edge.fromEnd;
          if (op.to_end !== undefined) back.to_end = edge.toEnd;
          if (op.label !== undefined) back.label = edge.label; // null restores null
          if (op.color !== undefined) back.color = edge.color;
          if (Object.keys(back).length > 2) undo.push(back);
          applyOne(cards, edges, op);
        }
        break;
      }
      case "edge.delete": {
        const edge = edges[op.id];
        if (edge) {
          undo.push(edgeAddFromEdge(edge));
          delete edges[op.id];
        }
        break;
      }
    }
    if (undo.length > 0) groups.push(undo);
  }

  return groups.reverse().flat();
}

/** Default size for a card kind — used by add flows, not by the op schema. */
export const defaultSizeOf = (
  kind: keyof typeof CARD_DEFAULT_SIZE,
): { width: number; height: number } => CARD_DEFAULT_SIZE[kind];
