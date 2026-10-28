"use client";

import { useActionState, useState } from "react";
import { suggestCorrectionAction } from "@/app/s/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * "Suggest a correction" (spec section 10 rule 4): anonymous, no account,
 * limited to 3 per hour per IP. The student writes what is wrong; leaders
 * read it in the course's open_questions area.
 */
export function SuggestForm({ nodeId }: { nodeId: string }) {
  const [state, formAction, pending] = useActionState(
    suggestCorrectionAction.bind(null, nodeId),
    null,
  );
  const [open, setOpen] = useState(false);

  if (state && "ok" in state) {
    return (
      <div className="grid gap-2">
        <p role="status" className="text-sm font-medium">
          Thank you! Your teacher will see your correction.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {!open ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
          className="w-fit"
        >
          Suggest a correction
        </Button>
      ) : (
        <form action={formAction} className="grid gap-2">
          <label htmlFor="suggestion-text" className="text-sm font-medium">
            What should be corrected?
          </label>
          <Textarea
            id="suggestion-text"
            name="text"
            required
            maxLength={2000}
            rows={4}
            placeholder="e.g. Page 3 says 2+2=5"
          />
          {state && "error" in state && (
            <p role="alert" className="text-destructive text-sm">
              {state.error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            No name or email is sent — suggestions are anonymous.
          </p>
        </form>
      )}
    </div>
  );
}
