"use client";

import { createContext, useContext } from "react";
import type { CanvasOp } from "@/lib/canvas/schemas";

/**
 * Bridges the canvas toolbars to the React Flow node/edge renderers, which
 * render inside the <ReactFlow> subtree (so context flows into every card).
 * Server pages never use this; it exists for CanvasEditor and CanvasViewer.
 */
export type CanvasContextValue = {
  /**
   * Sends ops to the save queue (editor) or is a no-op for the read-only
   * viewer — the viewer simply supplies an empty implementation.
   */
  queueOps: (ops: CanvasOp[]) => void;
  /** "Remove from map" (plain-language delete, spec 5.6) with Undo. */
  removeCard: (cardId: string) => void;
  /** The selection colour chooses this id (null clears). */
  recolourCard: (cardId: string, color: string | null) => void;
  /**
   * The eye toggle on text, link and group cards (spec 6.2): one
   * `node.update` (student_visible) per press, undoable like any action.
   */
  toggleStudentVisible: (cardId: string, visible: boolean) => void;
};

const noop: CanvasContextValue = {
  queueOps: () => {},
  removeCard: () => {},
  recolourCard: () => {},
  toggleStudentVisible: () => {},
};

export const CanvasContext = createContext<CanvasContextValue>(noop);

export const CanvasProvider = CanvasContext.Provider;

export function useCanvasContext(): CanvasContextValue {
  const value = useContext(CanvasContext);
  if (!value) {
    // Providers always wrap the flow; this is a programming error guard.
    throw new Error("CanvasContext missing — wrap the flow in CanvasProvider.");
  }
  return value;
}
