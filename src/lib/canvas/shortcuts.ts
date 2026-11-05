/**
 * Keyboard shortcut table (CANVAS-SPEC section 6.3). PURE DATA — the `?`
 * sheet, the editor's key matching and the leader guide are generated from
 * this one list, so a change here updates all three.
 *
 * `keys` holds every key variant of the binding ("Ctrl/Cmd+X" is the
 * cross-platform shorthand). The unit test guarantees no two rows map a
 * key to two different labels and no variant appears twice.
 */
export type CanvasShortcutAction =
  | "command-palette"
  | "undo"
  | "redo"
  | "copy"
  | "paste"
  | "duplicate"
  | "save-version"
  | "new-text-card"
  | "group"
  | "tidy-up"
  | "remove-selected"
  | "nudge"
  | "focus-connected"
  | "tab-next"
  | "tab-previous"
  | "open-side-pane"
  | "escape"
  | "show-shortcuts";

export type CanvasShortcut = {
  /** Key variants, canonical form: modifiers upper-case, letters upper-case. */
  keys: readonly string[];
  action: CanvasShortcutAction;
  /** Plain-language label for the `?` sheet (leader rule: no jargon). */
  label: string;
};

export const CANVAS_SHORTCUTS: readonly CanvasShortcut[] = [
  { keys: ["Ctrl/Cmd+K"], action: "command-palette", label: "Command palette" },
  { keys: ["Ctrl/Cmd+Z"], action: "undo", label: "Undo" },
  {
    keys: ["Ctrl/Cmd+Shift+Z", "Ctrl+Y"],
    action: "redo",
    label: "Redo",
  },
  { keys: ["Ctrl/Cmd+C"], action: "copy", label: "Copy the selected cards" },
  { keys: ["Ctrl/Cmd+V"], action: "paste", label: "Paste" },
  {
    keys: ["Ctrl/Cmd+D"],
    action: "duplicate",
    label: "Duplicate the selected cards",
  },
  {
    keys: ["Ctrl/Cmd+S"],
    action: "save-version",
    label: "Save a named version",
  },
  {
    keys: ["N"],
    action: "new-text-card",
    label: "New text card at the view centre",
  },
  { keys: ["G"], action: "group", label: "Group the selection" },
  { keys: ["Ctrl/Cmd+Shift+L"], action: "tidy-up", label: "Tidy up" },
  {
    keys: ["Delete", "Backspace"],
    action: "remove-selected",
    label: "Remove selected from the map",
  },
  {
    keys: ["Arrows"],
    action: "nudge",
    label: "Nudge the selected cards by 20 px",
  },
  {
    keys: ["Alt+Arrows"],
    action: "focus-connected",
    label: "Move focus to the nearest connected card in that direction",
  },
  { keys: ["Tab"], action: "tab-next", label: "Next card in reading order" },
  {
    keys: ["Shift+Tab"],
    action: "tab-previous",
    label: "Previous card in reading order",
  },
  {
    keys: ["Enter"],
    action: "open-side-pane",
    label: "Open the focused card in the side pane",
  },
  {
    keys: ["Esc"],
    action: "escape",
    label: "Close menu, pane or selection (in that order)",
  },
  { keys: ["?"], action: "show-shortcuts", label: "Show this list" },
];

/** Every distinct key variant, for tests and for the `?` sheet columns. */
export const shortcutKeys = (shortcuts = CANVAS_SHORTCUTS): string[] =>
  shortcuts.flatMap((row) => [...row.keys]);
