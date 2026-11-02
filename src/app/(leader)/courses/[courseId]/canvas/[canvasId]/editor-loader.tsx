"use client";

import dynamic from "next/dynamic";
import type { CanvasPayload } from "@/components/canvas/payload";

/**
 * Loads the canvas editor with next/dynamic ssr:false (CANVAS-SPEC section
 * 5.6): the React Flow bundle never runs on the server and never lands in
 * any other page's JavaScript.
 */
const CanvasEditor = dynamic<{
  payload: CanvasPayload;
}>(() => import("@/components/canvas/CanvasEditor"), { ssr: false });

export default function CanvasEditorLoader(props: { payload: CanvasPayload }) {
  return <CanvasEditor payload={props.payload} />;
}
