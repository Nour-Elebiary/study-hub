"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Background,
  Controls,
  ReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import {
  MAP_NODE_SIZE,
  buildEdges,
  buildLayout,
  layoutToSvg,
  type MapNode,
} from "@/lib/mind-map";

export type MapNodeData = MapNode;

type FlowData = {
  node: MapNode;
  highlighted: boolean;
  hasChildren: boolean;
  isCollapsed: boolean;
  onToggle: (id: string) => void;
};

type FlowNode = Node<FlowData, "map">;

/** One card in the map. Sections get a collapse/expand toggle. */
function MapCard({ data }: NodeProps<FlowNode>) {
  const { node, highlighted, hasChildren, isCollapsed, onToggle } = data;
  return (
    <div
      className={`rounded-lg border-2 px-2 py-1.5 text-xs leading-tight shadow-sm ${
        highlighted
          ? "border-amber-600 bg-amber-200"
          : "border-slate-400 bg-white"
      }`}
      style={{ width: MAP_NODE_SIZE.width, minHeight: MAP_NODE_SIZE.height }}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="min-w-0 flex-1" dir="auto">
          <span aria-hidden>{node.kind === "section" ? "📁" : "📝"} </span>
          {node.title || "Untitled"}
        </span>
        {hasChildren && (
          <button
            type="button"
            aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${node.title || "this branch"}`}
            className="shrink-0 rounded border border-slate-300 bg-slate-100 px-1.5 text-[10px] font-bold hover:bg-slate-200"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(node.id);
            }}
          >
            {isCollapsed ? "+" : "−"}
          </button>
        )}
      </div>
      {node.tags.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-slate-500">
          {node.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}

const nodeTypes = { map: MapCard };

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * The interactive map (desktop) or outline (phones), both built from the
 * same tree data — the phone never gets a different picture of the content.
 */
export function MindMap({
  courseId,
  nodes,
}: {
  courseId: string;
  nodes: MapNodeData[];
}) {
  const router = useRouter();
  const [isPhone, setIsPhone] = useState<boolean | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Detect the phone layout after mount, outside the synchronous effect body
  // (React compiler rule: no setState directly in an effect).
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      setIsPhone(window.matchMedia("(max-width: 639px)").matches),
    );
    return () => cancelAnimationFrame(id);
  }, []);

  const onToggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const highlightedIds = useMemo(() => {
    if (!selectedTag) return new Set<string>();
    return new Set(
      nodes.filter((n) => n.tags.includes(selectedTag)).map((n) => n.id),
    );
  }, [nodes, selectedTag]);

  const positioned = useMemo(
    () => buildLayout(nodes, collapsed),
    [nodes, collapsed],
  );
  const edges = useMemo(() => buildEdges(nodes, collapsed), [nodes, collapsed]);

  const flowNodes: FlowNode[] = useMemo(
    () =>
      positioned.map((p) => ({
        id: p.id,
        type: "map" as const,
        position: { x: p.x, y: p.y },
        data: {
          node: p,
          highlighted: highlightedIds.has(p.id),
          hasChildren: p.hasChildren,
          isCollapsed: collapsed.has(p.id),
          onToggle,
        },
      })),
    [positioned, highlightedIds, collapsed, onToggle],
  );

  const flowEdges = useMemo(
    () =>
      edges.map((edge) => ({
        id: `${edge.from}->${edge.to}`,
        source: edge.from,
        target: edge.to,
      })),
    [edges],
  );

  const allTags = useMemo(
    () => [...new Set(nodes.flatMap((n) => n.tags))].sort(),
    [nodes],
  );

  const exportSvg = useCallback(() => {
    const svg = layoutToSvg(positioned, edges, highlightedIds);
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "course-map.svg");
  }, [positioned, edges, highlightedIds]);

  const exportPng = useCallback(() => {
    const svg = layoutToSvg(positioned, edges, highlightedIds);
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width * 2;
      canvas.height = image.height * 2;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(2, 2);
      context.drawImage(image, 0, 0);
      canvas.toBlob((png) => {
        if (png) downloadBlob(png, "course-map.png");
      }, "image/png");
      URL.revokeObjectURL(url);
    };
    image.src = url;
  }, [positioned, edges, highlightedIds]);

  // The phone outline: the same tree in the same order, flattened.
  const outline = useMemo(() => {
    const childrenOf = new Map<string, MapNodeData[]>();
    for (const node of nodes) {
      const key = node.parentId ?? "";
      const list = childrenOf.get(key) ?? [];
      list.push(node);
      childrenOf.set(key, list);
    }
    const flat: { node: MapNodeData; depth: number }[] = [];
    const walk = (list: MapNodeData[], depth: number) => {
      for (const node of list) {
        flat.push({ node, depth });
        walk(childrenOf.get(node.id) ?? [], depth + 1);
      }
    };
    walk(childrenOf.get("") ?? [], 0);
    return flat;
  }, [nodes]);

  if (isPhone === null) return null;

  return (
    <div className="grid gap-3">
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">
            Highlight a tag:
          </span>
          {allTags.map((tag) => (
            <Button
              key={tag}
              type="button"
              size="sm"
              variant={selectedTag === tag ? "default" : "outline"}
              onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
            >
              #{tag}
            </Button>
          ))}
          {selectedTag && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setSelectedTag(null)}
            >
              Clear
            </Button>
          )}
        </div>
      )}

      {!isPhone ? (
        <>
          <div className="h-[70vh] overflow-hidden rounded-md border bg-white">
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.2}
              nodesConnectable={false}
              elementsSelectable={false}
              onNodeClick={(_, node) =>
                router.push(`/courses/${courseId}/nodes/${node.id}`)
              }
            >
              <Background gap={16} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={exportPng}
            >
              Export PNG
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={exportSvg}
            >
              Export SVG
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            On a phone the map shows as an outline with the same content.
          </p>
          <ul className="grid gap-1 text-sm">
            {outline.map(({ node, depth }) => (
              <li
                key={node.id}
                style={{ paddingInlineStart: `${depth * 16}px` }}
              >
                <button
                  type="button"
                  className={`text-start underline underline-offset-4 ${
                    highlightedIds.has(node.id)
                      ? "bg-amber-200 font-semibold"
                      : ""
                  }`}
                  onClick={() =>
                    router.push(`/courses/${courseId}/nodes/${node.id}`)
                  }
                >
                  <span aria-hidden>
                    {node.kind === "section" ? "📁" : "📝"}{" "}
                  </span>
                  <span dir="auto">{node.title || "Untitled"}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
