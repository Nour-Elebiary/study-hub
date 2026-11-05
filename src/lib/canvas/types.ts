/**
 * Shared canvas state shapes (CANVAS-SPEC section 5.4). Pure types only —
 * no React, no Supabase, no server-only — so the editor, the student viewer
 * and the server converters all agree on one data shape.
 */
import type { CanvasColor, CardKind, EdgeEnd, Side } from "./schemas";

export type CanvasCard = {
  id: string;
  kind: CardKind;
  /** `note` cards only: the content note this card shows. */
  nodeId: string | null;
  /** `file` cards only: the asset this card shows. */
  assetId: string | null;
  /** `link` cards only: the web address (http(s) only). */
  url: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  /** Colour palette slot ("1"–"6") mapped to a CSS variable by the renderer. */
  color: CanvasColor | null;
  /** `text` and `group` cards: free text (group uses the label too). */
  body: string | null;
  /** A short caption any card can carry. */
  label: string | null;
  /** False: this card is hidden from the student viewer entirely. */
  studentVisible: boolean;
};

export type CanvasEdge = {
  id: string;
  from: string;
  to: string;
  fromSide: Side;
  toSide: Side;
  fromEnd: EdgeEnd;
  toEnd: EdgeEnd;
  label: string | null;
  color: CanvasColor | null;
};

export type CanvasState = {
  cards: Record<string, CanvasCard>;
  edges: Record<string, CanvasEdge>;
  /** Monotonic sync counter; every applied batch bumps it by one (D6). */
  rev: number;
};

export type Point = { x: number; y: number };
