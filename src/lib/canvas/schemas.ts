/**
 * Zod schemas for the canvas op batches (CANVAS-SPEC section 5.4). These run
 * at every boundary: server actions before the `canvas_apply_ops` RPC, and
 * (in M10) the browser's own optimistic queue. One special zod-4 note is
 * recorded in docs/QUESTIONS.md #44: the refiners use the non-deprecated
 * `.check((ctx) => ...)` pattern, which is fully compatible with
 * `z.discriminatedUnion` members in zod 4.6.7.
 */
import { z } from "zod";

export const CARD_KINDS = ["note", "file", "text", "link", "group"] as const;
export const SIDES = ["top", "right", "bottom", "left"] as const;
export const CANVAS_COLORS = ["1", "2", "3", "4", "5", "6"] as const;
export const EDGE_ENDS = ["none", "arrow"] as const;

export type CardKind = (typeof CARD_KINDS)[number];
export type Side = (typeof SIDES)[number];
export type CanvasColor = (typeof CANVAS_COLORS)[number];
export type EdgeEnd = (typeof EDGE_ENDS)[number];

// Relaxed on purpose: seed ids are not RFC UUIDs (QUESTIONS #19).
export const uuidLike = z
  .string()
  .min(1)
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: "not a valid id",
  });

export const cardKind = z.enum(CARD_KINDS);
export const side = z.enum(SIDES);
export const canvasColor = z.enum(CANVAS_COLORS);
export const edgeEnd = z.enum(EDGE_ENDS);

const coord = z.number().finite().min(-100000).max(100000);
const cardWidth = z.number().finite().min(40).max(4000);
const cardHeight = z.number().finite().min(30).max(4000);

// Two layers on purpose (spec section 5.4): a cheap regex first, then a
// real URL parse so `javascript:` and bare "https://" can never slip through.
const httpUrl = z
  .string()
  .max(2048)
  .check((ctx) => {
    const url = ctx.value;
    if (!/^https?:\/\//i.test(url)) {
      ctx.issues.push({
        code: "custom",
        input: url,
        message: "a link must start with http:// or https://",
      });
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      ctx.issues.push({
        code: "custom",
        input: url,
        message: "not a valid web address",
      });
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      ctx.issues.push({
        code: "custom",
        input: url,
        message: "links may only use http:// or https://",
      });
    }
  });

const nodeAdd = z
  .object({
    op: z.literal("node.add"),
    id: uuidLike,
    kind: cardKind,
    node_id: uuidLike.optional(),
    asset_id: uuidLike.optional(),
    url: httpUrl.optional(),
    x: coord,
    y: coord,
    width: cardWidth,
    height: cardHeight,
    z: z.number().int().min(-1000).max(1000).optional(),
    color: canvasColor.nullable().optional(),
    body: z.string().max(20000).optional(),
    label: z.string().max(200).optional(),
    student_visible: z.boolean().optional(),
  })
  .check((ctx) => {
    // Exactly the reference the kind needs — mirrors the SQL check constraint
    // `canvas_nodes_ref_by_kind` so wrong refs are refused before the RPC
    // (whose cast would raise a raw database error instead).
    const v = ctx.value;
    const ok =
      (v.kind === "note" &&
        typeof v.node_id === "string" &&
        !v.asset_id &&
        !v.url) ||
      (v.kind === "file" &&
        typeof v.asset_id === "string" &&
        !v.node_id &&
        !v.url) ||
      (v.kind === "link" &&
        typeof v.url === "string" &&
        !v.node_id &&
        !v.asset_id) ||
      (v.kind === "text" &&
        typeof v.body === "string" &&
        !v.node_id &&
        !v.asset_id &&
        !v.url) ||
      (v.kind === "group" && !v.node_id && !v.asset_id && !v.url);
    if (!ok) {
      ctx.issues.push({
        code: "custom",
        input: v,
        message: "card reference does not match its kind",
      });
    }
  });

const nodeUpdate = z
  .object({
    op: z.literal("node.update"),
    id: uuidLike,
    x: coord.optional(),
    y: coord.optional(),
    width: cardWidth.optional(),
    height: cardHeight.optional(),
    z: z.number().int().min(-1000).max(1000).optional(),
    color: canvasColor.nullable().optional(),
    // Deliberately NOT nullable (label/url/color are): an explicit null body
    // would break `canvas_nodes_ref_by_kind` for text cards. Text cards get
    // rewritten, never emptied to null.
    body: z.string().max(20000).optional(),
    label: z.string().max(200).nullable().optional(),
    url: httpUrl.nullable().optional(),
    student_visible: z.boolean().optional(),
  })
  .check((ctx) => {
    if (Object.keys(ctx.value).length <= 2) {
      ctx.issues.push({
        code: "custom",
        input: ctx.value,
        message: "node.update needs at least one field to change",
      });
    }
  });

const nodeDelete = z.object({
  op: z.literal("node.delete"),
  id: uuidLike,
});

const edgeAdd = z
  .object({
    op: z.literal("edge.add"),
    id: uuidLike,
    from_node: uuidLike,
    to_node: uuidLike,
    from_side: side.optional(),
    to_side: side.optional(),
    from_end: edgeEnd.optional(),
    to_end: edgeEnd.optional(),
    label: z.string().max(200).optional(),
    color: canvasColor.nullable().optional(),
  })
  .check((ctx) => {
    if (ctx.value.from_node === ctx.value.to_node) {
      ctx.issues.push({
        code: "custom",
        input: ctx.value,
        message: "an edge cannot connect a card to itself",
      });
    }
  });

const edgeUpdate = z
  .object({
    op: z.literal("edge.update"),
    id: uuidLike,
    from_side: side.optional(),
    to_side: side.optional(),
    from_end: edgeEnd.optional(),
    to_end: edgeEnd.optional(),
    label: z.string().max(200).nullable().optional(),
    color: canvasColor.nullable().optional(),
  })
  .check((ctx) => {
    if (Object.keys(ctx.value).length <= 2) {
      ctx.issues.push({
        code: "custom",
        input: ctx.value,
        message: "edge.update needs at least one field to change",
      });
    }
  });

const edgeDelete = z.object({
  op: z.literal("edge.delete"),
  id: uuidLike,
});

export const canvasOp = z.discriminatedUnion("op", [
  nodeAdd,
  nodeUpdate,
  nodeDelete,
  edgeAdd,
  edgeUpdate,
  edgeDelete,
]);

export const canvasOps = z.array(canvasOp).min(1).max(200);

export type CanvasOp = z.infer<typeof canvasOp>;
export type CanvasOpsBatch = z.infer<typeof canvasOps>;
export type NodeAddOp = Extract<CanvasOp, { op: "node.add" }>;
export type NodeUpdateOp = Extract<CanvasOp, { op: "node.update" }>;
export type EdgeAddOp = Extract<CanvasOp, { op: "edge.add" }>;
export type EdgeUpdateOp = Extract<CanvasOp, { op: "edge.update" }>;
