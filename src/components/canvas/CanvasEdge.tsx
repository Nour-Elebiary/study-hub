"use client";

import { useId } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  MarkerType,
  type Edge,
  type EdgeMarker,
  type EdgeProps,
  type EdgeTypes,
} from "@xyflow/react";
import { useCanvasContext } from "./editor-context";
import { CANVAS_COLORS, type CanvasColor } from "@/lib/canvas/schemas";

/**
 * The custom canvas edge (spec 5.6 + M9 editor scope): label, colour slot and
 * arrow ends, edited inline when the edge is selected. Plain-language
 * buttons ("Remove arrow"), never jargon.
 */

export type CanvasEdgeData = {
  label: string | null;
  color: CanvasColor | null;
  fromEnd: "none" | "arrow";
  toEnd: "none" | "arrow";
  leader: boolean;
};

export type CanvasFlowEdge = Edge<CanvasEdgeData>;

// Arrow-end markers live on the edge object itself: React Flow resolves the
// object form into a URL string and hands it back to us through the edge
// component props. These hex values mirror the temporary --canvas-* tints in
// globals.css because SVG marker definitions cannot use CSS custom
// properties reliably; milestone 11 replaces both with the final tints.
const MARKER_HEX: Record<CanvasColor, string> = {
  "1": "#fee2e2",
  "2": "#fef3c7",
  "3": "#dcfce7",
  "4": "#cffafe",
  "5": "#ede9fe",
  "6": "#f1f5f9",
};

export function edgeMarkers(data: CanvasEdgeData): {
  markerStart?: EdgeMarker;
  markerEnd?: EdgeMarker;
} {
  const fill = data.color ? MARKER_HEX[data.color] : "#334155";
  return {
    markerStart:
      data.fromEnd === "arrow"
        ? { type: MarkerType.ArrowClosed, color: fill }
        : undefined,
    markerEnd:
      data.toEnd === "arrow"
        ? { type: MarkerType.ArrowClosed, color: fill }
        : undefined,
  };
}

function CanvasWire(props: EdgeProps<CanvasFlowEdge>) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    selected,
    markerStart,
    markerEnd,
  } = props;
  const { queueOps } = useCanvasContext();
  const reactFlow = useReactFlow();
  const inputId = useId();
  if (!data) return null;

  const colour = data.color;
  const strokeVar = colour ? `var(--canvas-${colour})` : "#334155";

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ strokeWidth: 2, stroke: strokeVar }}
        markerStart={markerStart}
        markerEnd={markerEnd}
      />
      {data.label || (selected && data.leader) ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
          >
            {data.label ? (
              <span
                className="bg-background inline-block max-w-40 rounded border px-1.5 py-0.5 text-[11px] font-medium break-words"
                dir="auto"
              >
                {data.label}
              </span>
            ) : null}
            {selected && data.leader ? (
              <div className="bg-background mt-1 w-44 rounded border p-1.5 shadow">
                <label htmlFor={inputId} className="sr-only">
                  Arrow text
                </label>
                <input
                  id={inputId}
                  defaultValue={data.label ?? ""}
                  placeholder="Text on the arrow"
                  maxLength={200}
                  className="w-full rounded border px-1.5 py-1 text-[11px]"
                  onChange={(event) => {
                    const value = event.target.value.trim();
                    queueOps([
                      { op: "edge.update", id, label: value || null },
                    ]);
                  }}
                />
                <div className="mt-1 flex items-center gap-1">
                  <span className="text-muted-foreground text-[10px]">Colour</span>
                  <select
                    aria-label="Arrow colour"
                    defaultValue={colour ?? ""}
                    className="min-w-0 flex-1 rounded border px-1 py-0.5 text-[11px]"
                    onChange={(event) => {
                      const value = event.target.value;
                      queueOps([
                        {
                          op: "edge.update",
                          id,
                          color: value
                            ? (value as CanvasColor)
                            : null,
                        },
                      ]);
                    }}
                  >
                    <option value="">None</option>
                    {CANVAS_COLORS.map((slot) => (
                      <option key={slot} value={slot}>
                        Colour {slot}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-1 flex gap-2">
                  <label className="text-[10px]">
                    <input
                      type="checkbox"
                      defaultChecked={data.fromEnd === "arrow"}
                      onChange={(event) =>
                        queueOps([
                          {
                            op: "edge.update",
                            id,
                            from_end: event.target.checked ? "arrow" : "none",
                          },
                        ])
                      }
                    />{" "}
                    Start arrow
                  </label>
                  <label className="text-[10px]">
                    <input
                      type="checkbox"
                      defaultChecked={data.toEnd === "arrow"}
                      onChange={(event) =>
                        queueOps([
                          {
                            op: "edge.update",
                            id,
                            to_end: event.target.checked ? "arrow" : "none",
                          },
                        ])
                      }
                    />{" "}
                    End arrow
                  </label>
                </div>
                <button
                  type="button"
                  className="text-destructive mt-1 text-[11px] font-semibold"
                  onClick={() => {
                    queueOps([{ op: "edge.delete", id }]);
                    reactFlow.deleteElements({ edges: [{ id }] });
                  }}
                >
                  Remove arrow
                </button>
              </div>
            ) : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const CanvasEdge = CanvasWire;

export const canvasEdgeTypes: EdgeTypes = {
  canvas: CanvasEdge,
};
