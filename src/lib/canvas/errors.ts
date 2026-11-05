/**
 * Plain-language mapping for canvas database errors (CANVAS-SPEC section
 * 5.5, applyCanvasOps row): a raw constraint message must never reach the
 * leader (constitution rule 6, plain labels). Pure and unit-testable; the
 * limits from `settings` are passed in by the caller so this module never
 * touches the database.
 */

export type CanvasErrorLimits = {
  /** settings.max_canvas_cards (for the "map is full" message). */
  cardLimit: number;
};

export type CanvasErrorMessage = { user: string };

const DEFAULT_MESSAGE =
  "Something went wrong while saving this map. Try again or reload the page.";

/** Maps one database error message to a line a leader understands. */
export function mapDbError(
  message: string,
  limits: CanvasErrorLimits,
): CanvasErrorMessage {
  const m = message.toLowerCase();

  if (m.includes("canvas card limit reached")) {
    return {
      user: `This map is full (limit ${limits.cardLimit} cards). Remove cards or start a second map.`,
    };
  }
  if (m.includes("canvas not found")) {
    return { user: "This map no longer exists (maybe it was just deleted)." };
  }
  if (
    m.includes("note belongs to another course") ||
    m.includes("file belongs to another course")
  ) {
    return {
      user: "That content belongs to another course. Use the picker list for this course.",
    };
  }
  if (m.includes("cards of the same canvas")) {
    return {
      user: "You can only connect two cards on the same map.",
    };
  }
  if (m.includes("canvas_edges_unique")) {
    return {
      user: "There is already an arrow like that between these two cards.",
    };
  }
  if (m.includes("version not found") || m.includes("snapshot not found")) {
    return { user: "That backup no longer exists." };
  }
  return { user: DEFAULT_MESSAGE };
}
