import type { ContentArea } from "@/lib/schemas";

/**
 * Note templates (spec section 6: "Lecture note, summary, quiz prep (with
 * question and answer blocks), glossary, open questions"). The front-matter
 * fields (course, area, tags, source file) are form fields in the UI, never
 * code inside the template body.
 */
export type NoteTemplate = {
  id: string;
  label: string;
  suggestedAreas: ContentArea[];
  bodyMd: string;
};

export const noteTemplates: NoteTemplate[] = [
  {
    id: "lecture_note",
    label: "Lecture note",
    suggestedAreas: ["official_materials", "student_notes"],
    bodyMd: [
      "# {title}",
      "",
      "## What we covered",
      "",
      "- ",
      "",
      "## Explanation",
      "",
      "",
      "",
      "## Examples",
      "",
      "",
      "",
      "## Things to remember",
      "",
      "- ",
    ].join("\n"),
  },
  {
    id: "summary",
    label: "Summary",
    suggestedAreas: ["official_materials", "student_notes"],
    bodyMd: [
      "# {title}",
      "",
      "## In one sentence",
      "",
      "",
      "",
      "## Key points",
      "",
      "1. ",
      "2. ",
      "3. ",
      "",
      "## Words to know",
      "",
      "| Word | Meaning |",
      "| ---- | ------- |",
      "|      |         |",
    ].join("\n"),
  },
  {
    id: "quiz_prep",
    label: "Quiz prep",
    suggestedAreas: ["quiz_exam_prep"],
    bodyMd: [
      "# {title}",
      "",
      "## Question 1",
      "",
      "**Question:** ",
      "",
      "**Answer:** ",
      "",
      "**Why:** ",
      "",
      "## Question 2",
      "",
      "**Question:** ",
      "",
      "**Answer:** ",
      "",
      "**Why:** ",
    ].join("\n"),
  },
  {
    id: "glossary",
    label: "Glossary entry",
    suggestedAreas: ["glossary"],
    bodyMd: [
      "# {title}",
      "",
      "**Meaning:** ",
      "",
      "**In plain words:** ",
      "",
      "**Example:** ",
      "",
      "**Related words:** ",
    ].join("\n"),
  },
  {
    id: "open_questions",
    label: "Open questions",
    suggestedAreas: ["open_questions"],
    bodyMd: [
      "# {title}",
      "",
      "## Questions we cannot answer yet",
      "",
      "1. ",
      "",
      "## What we tried",
      "",
      "- ",
      "",
      "## Who might know",
      "",
      "- ",
    ].join("\n"),
  },
];

export function getTemplate(id: string): NoteTemplate | undefined {
  return noteTemplates.find((t) => t.id === id);
}
