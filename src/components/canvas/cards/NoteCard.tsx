"use client";

import Markdown from "react-markdown";
import type { NoteTarget } from "../payload";

const AREA_LABELS: Record<string, string> = {
  official_materials: "Official materials",
  student_notes: "Student notes",
  quiz_exam_prep: "Quiz & exam prep",
  external_resources: "External resources",
  glossary: "Glossary",
  open_questions: "Open questions",
};

export type NoteCardData = {
  card: { label: string | null };
  note?: NoteTarget;
  /** Live mode: leaders see the Draft badge and ghost states. */
  leader: boolean;
};

/**
 * A note card (spec 5.6): title, area name, and the first ~300 characters of
 * the PUBLISHED body through react-markdown (raw HTML is never rendered).
 * Leaders additionally see the "Draft" badge and the soft-deleted ghost.
 * Colour is applied by the wrapping node via its CSS variable; the tap-to-
 * open link (student viewer) is added by the node wrapper.
 */
export default function NoteCard({ data }: { data: NoteCardData }) {
  const note = data.note;
  const title = data.card.label || note?.title || "Note";

  if (!note) {
    return <div className="p-3 text-sm">Missing note content.</div>;
  }

  if (note.deleted) {
    return (
      <div className="p-3 text-sm">
        <p className="font-semibold">Deleted note</p>
        <p className="text-muted-foreground mt-1">
          The note this card points at was moved to the bin.
        </p>
      </div>
    );
  }

  return (
    <div className="p-3">
      {data.leader && !note.published ? (
        <span className="bg-foreground text-background mb-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase">
          Draft
        </span>
      ) : null}
      <p className="text-sm leading-snug font-semibold" dir="auto">
        {title}
      </p>
      <p className="text-muted-foreground mt-0.5 text-[11px]">
        {AREA_LABELS[note.area] ?? note.area}
      </p>
      <div className="prose-xs mt-1 line-clamp-4 text-xs leading-snug break-words">
        {note.preview ? <Markdown>{note.preview}</Markdown> : null}
      </div>
    </div>
  );
}
