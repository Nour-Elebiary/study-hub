"use client";

import { useActionState } from "react";
import {
  resolveSuggestionAction,
  type ResolveSuggestionActionState,
} from "@/app/(leader)/courses/[courseId]/suggestions/actions";
import { Button } from "@/components/ui/button";

export type SuggestionItem = {
  id: string;
  noteId: string;
  noteTitle: string;
  text: string;
  createdAt: string;
};

/**
 * "Open questions" (spec section 10 rule 4): the corrections students
 * suggested on this course's notes, with a one-click "mark as handled".
 * Suggestions are anonymous — there is no name to show, by design.
 */
export function SuggestionList({
  suggestions,
}: {
  suggestions: SuggestionItem[];
}) {
  const [state, formAction] = useActionState<
    ResolveSuggestionActionState,
    FormData
  >(resolveSuggestionAction, null);

  if (suggestions.length === 0) return null;

  return (
    <section className="rounded-lg border" aria-label="Open questions">
      <div className="px-3 py-2">
        <h2 className="text-sm font-semibold">
          Open questions
          <span className="text-muted-foreground font-normal">
            {" "}
            ({suggestions.length})
          </span>
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Corrections students suggested on this course&apos;s notes. They are
          anonymous.
        </p>
      </div>
      {state && "error" in state && (
        <p role="alert" className="text-destructive px-3 pb-2 text-sm">
          {state.error}
        </p>
      )}
      <ul className="grid gap-2 px-3 pb-3">
        {suggestions.map((s) => (
          <li key={s.id} className="rounded-md border p-3 text-sm">
            <p className="font-medium">{s.noteTitle}</p>
            <p className="mt-1">{s.text}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {new Date(s.createdAt).toLocaleDateString()}
            </p>
            <form action={formAction} className="mt-2">
              <input type="hidden" name="suggestion_id" value={s.id} />
              <input type="hidden" name="resolved" value="true" />
              <Button type="submit" variant="outline" size="sm">
                Mark as handled
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
