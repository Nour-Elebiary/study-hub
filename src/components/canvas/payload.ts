/**
 * Shapes the server pages hand to the canvas client components (CANVAS-SPEC
 * section 5.6). Plain data only — no server imports — so one definition is
 * shared by the editor, the student viewer and the pages that load them.
 */
import type { CanvasCard, CanvasEdge } from "@/lib/canvas/types";

export type NoteTarget = {
  id: string;
  title: string;
  area: string;
  /** The note has a published version (the student badge is the inverse). */
  published: boolean;
  /** Soft-deleted note: leaders see the ghost card. */
  deleted: boolean;
  /** First ~300 characters of the published body, already truncated. */
  preview: string | null;
};

export type FileTarget = {
  id: string;
  name: string;
  kind: string;
  mime: string;
  bytes: number | null;
  visible: boolean;
  downloadable: boolean;
  /** Storage path (leaders sign image URLs in the browser for thumbnails). */
  pathOrUrl: string;
};

export type PickerNote = {
  id: string;
  title: string;
  area: string;
  published: boolean;
};

export type PickerFile = {
  id: string;
  title: string;
  kind: string;
  bytes: number | null;
  visible: boolean;
  downloadable: boolean;
};

export type CanvasPayload = {
  id: string;
  courseId: string;
  title: string;
  /** "course" | "subject" | "free" */
  kind: string;
  isDefault: boolean;
  published: boolean;
  legend: Record<string, string>;
  viewport: { x: number; y: number; zoom: number };
  /**
   * Biggest upload size in MB, from the `settings` table (constitution rule
   * 8) — the drag-drop upload gate (spec 6.5) needs it in the browser.
   */
  maxFileMb: number;
  cards: CanvasCard[];
  edges: CanvasEdge[];
  notes: Record<string, NoteTarget>;
  files: Record<string, FileTarget>;
};

/** One outline node for the mobile-first student view (spec 5.7, D9). */
export type OutlineItem = {
  id: string;
  title: string;
  /** A note the student can open (has a published version). */
  openable: boolean;
  /** True for headings (the course home / sections). */
  heading: boolean;
};
