/**
 * Default card sizes and view constants (CANVAS-SPEC section 5.4). Spec place,
 * not code-enforced limits: the card COUNT cap lives in `settings`
 * (`max_canvas_cards`, constitution rule 8).
 */
import type { CardKind } from "./schemas";

export type CardSize = { width: number; height: number };

export const CARD_DEFAULT_SIZE: Record<CardKind, CardSize> = {
  text: { width: 260, height: 140 },
  note: { width: 320, height: 200 },
  file: { width: 280, height: 200 },
  link: { width: 260, height: 90 },
  group: { width: 600, height: 400 },
};

/** Snap grid in map units — positions round to this when dropped. */
export const GRID_SIZE = 20;

export const ZOOM_RANGE = { min: 0.1, max: 2 } as const;
