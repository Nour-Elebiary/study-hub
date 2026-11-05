"use client";

import dynamic from "next/dynamic";
import type { CanvasPayload, OutlineItem } from "@/components/canvas/payload";
import type { ViewerLabels } from "@/components/canvas/CanvasViewer";

/**
 * Loads the student canvas viewer with next/dynamic ssr:false (CANVAS-SPEC
 * section 5.7) so no other student page grows by a single byte of canvas
 * JavaScript.
 */
const CanvasViewer = dynamic<{
  payload: CanvasPayload;
  outline: OutlineItem[];
  labels: ViewerLabels;
}>(() => import("@/components/canvas/CanvasViewer"), { ssr: false });

export default function CanvasViewerLoader(props: {
  payload: CanvasPayload;
  outline: OutlineItem[];
  labels: ViewerLabels;
}) {
  return <CanvasViewer {...props} />;
}
