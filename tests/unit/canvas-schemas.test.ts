import { describe, expect, it } from "vitest";
import {
  canvasOp,
  canvasOps,
} from "@/lib/canvas/schemas";

const SITE_ID = "cccccccc-0000-cccc-0000-000000000001"; // seed id, not RFC UUID (#19)

const baseAdd = {
  op: "node.add",
  id: "11111111-2222-3333-4444-555555555551",
  kind: "text",
  body: "hello",
  x: 0,
  y: 0,
  width: 260,
  height: 140,
} as const;

describe("uuidLike / card ids", () => {
  it("accepts readable seed ids that are not RFC UUIDs", () => {
    const op = {
      op: "node.update",
      id: SITE_ID,
      x: 10,
    };
    expect(() => canvasOps.parse([op])).not.toThrow();
  });

  it("rejects ids that are not 8-4-4-4-12 hex", () => {
    expect(
      canvasOp.safeParse({ op: "node.delete", id: "not-a-uuid" }).success,
    ).toBe(false);
    expect(canvasOp.safeParse({ op: "node.delete", id: "" }).success).toBe(false);
  });
});

describe("httpUrl", () => {
  it("accepts a plain https address", () => {
    const op = {
      op: "node.add",
      id: "11111111-2222-3333-4444-555555555552",
      kind: "link",
      url: "https://example.com/page?x=1",
      x: 0,
      y: 0,
      width: 260,
      height: 90,
    };
    expect(canvasOp.safeParse(op).success).toBe(true);
  });

  it("rejects a javascript: URL before it reaches the database", () => {
    const op = {
      op: "node.add",
      id: "11111111-2222-3333-4444-555555555552",
      kind: "link",
      url: "javascript:alert(1)",
      x: 0,
      y: 0,
      width: 260,
      height: 90,
    };
    expect(canvasOp.safeParse(op).success).toBe(false);
  });

  it("rejects data: and bare protocol-only strings (real URL parse)", () => {
    for (const url of ["data:text/html,<b>x</b>", "https://", "not a url", "https://"]) {
      const op = { op: "node.add", id: "11111111-2222-3333-4444-555555555552", kind: "link", url, x: 0, y: 0, width: 260, height: 90 };
      expect(canvasOp.safeParse(op).success, url).toBe(false);
    }
  });
});

describe("node.add kind-reference rule", () => {
  it("accepts note / file / text / link / group shapes that match their kind", () => {
    expect(
      canvasOp.safeParse({ ...baseAdd, id: "11111111-2222-3333-4444-555555555553" }).success,
    ).toBe(true);
    expect(
      canvasOp.safeParse({
        ...baseAdd,
        id: "11111111-2222-3333-4444-555555555554",
        kind: "note",
        node_id: SITE_ID,
        body: undefined,
      } as unknown).success,
    ).toBe(true);
    expect(
      canvasOp.safeParse({
        ...baseAdd,
        id: "11111111-2222-3333-4444-555555555555",
        kind: "file",
        asset_id: SITE_ID,
        body: undefined,
      } as unknown).success,
    ).toBe(true);
    expect(
      canvasOp.safeParse({
        ...baseAdd,
        id: "11111111-2222-3333-4444-555555555556",
        kind: "group",
        body: undefined,
        width: 600,
        height: 400,
      }).success,
    ).toBe(true);
  });

  it("rejects a card whose reference does not match its kind", () => {
    // text without body
    expect(canvasOp.safeParse({ ...baseAdd, body: undefined }).success).toBe(false);
    // note with an asset instead of a node
    expect(
      canvasOp.safeParse({
        ...baseAdd,
        kind: "note",
        node_id: SITE_ID,
        asset_id: SITE_ID,
      }).success,
    ).toBe(false);
    // group with a url
    expect(
      canvasOp.safeParse({
        ...baseAdd,
        kind: "group",
        body: undefined,
        url: "https://example.com",
        width: 600,
        height: 400,
      }).success,
    ).toBe(false);
  });
});

describe("node.update", () => {
  it("accepts an explicit null colour or label (they clear the column)", () => {
    expect(
      canvasOp.safeParse({ op: "node.update", id: SITE_ID, color: null, label: null }).success,
    ).toBe(true);
  });

  it("rejects an explicit null body (it would break canvas_nodes_ref_by_kind)", () => {
    expect(canvasOp.safeParse({ op: "node.update", id: SITE_ID, body: null }).success).toBe(false);
  });

  it("rejects an update that changes nothing", () => {
    expect(canvasOp.safeParse({ op: "node.update", id: SITE_ID }).success).toBe(false);
  });

  it("rejects coordinates and sizes outside the allowed ranges", () => {
    expect(canvasOp.safeParse({ op: "node.update", id: SITE_ID, x: 200000 }).success).toBe(false);
    expect(canvasOp.safeParse({ op: "node.update", id: SITE_ID, x: 1e400 }).success).toBe(false);
    expect(canvasOp.safeParse({ op: "node.update", id: SITE_ID, width: 10 }).success).toBe(false);
  });
});

describe("edges", () => {
  it("rejects a self-loop edge", () => {
    expect(
      canvasOp.safeParse({
        op: "edge.add",
        id: "11111111-2222-3333-4444-55555555555a",
        from_node: SITE_ID,
        to_node: SITE_ID,
      }).success,
    ).toBe(false);
  });

  it("rejects an edge.update that changes nothing, accepts a null label", () => {
    expect(canvasOp.safeParse({ op: "edge.update", id: SITE_ID }).success).toBe(false);
    expect(canvasOp.safeParse({ op: "edge.update", id: SITE_ID, label: null }).success).toBe(true);
  });
});

describe("canvasOps batch", () => {
  it("accepts a mixed batch of the six op shapes", () => {
    const batch = [
      baseAdd,
      { op: "node.update", id: SITE_ID, x: 5, color: "4" },
      { op: "node.delete", id: SITE_ID },
      {
        op: "edge.add",
        id: "11111111-2222-3333-4444-55555555555b",
        from_node: baseAdd.id,
        to_node: SITE_ID,
      },
      { op: "edge.update", id: SITE_ID, label: "leads to" },
      { op: "edge.delete", id: SITE_ID },
    ];
    expect(canvasOps.parse(batch)).toHaveLength(6);
  });

  it("rejects an unknown op name and an empty batch", () => {
    expect(canvasOps.safeParse([{ op: "canvas.nuke" }]).success).toBe(false);
    expect(canvasOps.safeParse([]).success).toBe(false);
  });

  it("rejects a batch of more than 200 ops", () => {
    const big: unknown[] = [];
    for (let i = 0; i < 201; i++) {
      big.push({ op: "node.update", id: SITE_ID, x: i });
    }
    expect(canvasOps.safeParse(big).success).toBe(false);
    expect(canvasOps.safeParse(big.slice(0, 200)).success).toBe(true);
  });
});
