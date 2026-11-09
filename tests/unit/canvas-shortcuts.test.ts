import { describe, expect, it } from "vitest";
import {
  CANVAS_SHORTCUTS,
  shortcutKeys,
  type CanvasShortcut,
} from "@/lib/canvas/shortcuts";

/** The spec's 6.3 table, transcribed — the data must cover every row. */
const SPEC_ACTIONS = [
  "command-palette",
  "undo",
  "redo",
  "copy",
  "paste",
  "duplicate",
  "save-version",
  "new-text-card",
  "group",
  "tidy-up",
  "remove-selected",
  "nudge",
  "focus-connected",
  "tab-next",
  "tab-previous",
  "open-side-pane",
  "escape",
  "show-shortcuts",
  /** Ours, not the spec's — the keyboard connect (see QUESTIONS.md). */
  "start-link",
] as const;

describe("shortcut table (spec 6.11: no duplicate keys)", () => {
  it("no key variant is used by two different rows", () => {
    const seen = new Map<string, string>();
    for (const shortcut of CANVAS_SHORTCUTS) {
      for (const key of shortcut.keys) {
        expect(
          seen.has(key),
          `"${key}" is bound twice; the editor would only be able to honour one action`,
        ).toBe(false);
        seen.set(key, shortcut.action);
      }
    }
  });

  it("the duplicate detector really fires on a sabotaged table", () => {
    const sabotaged: CanvasShortcut[] = [
      ...CANVAS_SHORTCUTS,
      // The same key as the palette binding, but for a different action.
      { keys: ["Ctrl/Cmd+K"], action: "undo", label: "Undo" },
    ];
    const all = shortcutKeys(sabotaged);
    expect(new Set(all).size).toBeLessThan(all.length);
  });

  it("covers every action the spec lists", () => {
    const covered = CANVAS_SHORTCUTS.map((shortcut) => shortcut.action).sort();
    expect(covered).toEqual([...SPEC_ACTIONS].sort());
  });

  it("every row has a label and at least one key", () => {
    for (const shortcut of CANVAS_SHORTCUTS) {
      expect(shortcut.keys.length, shortcut.action).toBeGreaterThan(0);
      expect(shortcut.label.trim().length, shortcut.action).toBeGreaterThan(2);
    }
  });
});
