"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  createCanvasAction,
  deleteCanvasAction,
  generateCanvasAction,
  restoreCanvasAction,
  setDefaultCanvasAction,
  type CanvasActionState,
} from "./actions";

/**
 * New map / Generate from course / per-map actions for the canvas list
 * (CANVAS-SPEC section 5.6). Plain-language labels and messages only.
 */

type CanvasRow = {
  id: string;
  title: string;
  kind: string;
  isDefault: boolean;
  published: boolean;
};

export default function CanvasListTools(props: {
  courseId: string;
  canvases: CanvasRow[];
  deleted: { id: string; title: string }[];
}) {
  const router = useRouter();

  // A successful "New map" jumps straight into the editor.
  const [newState, newAction, newPending] = useActionState(
    createCanvasAction,
    null as CanvasActionState,
  );
  useEffect(() => {
    if (newState && "ok" in newState && newState.canvasId) {
      router.push(`/courses/${props.courseId}/canvas/${newState.canvasId}`);
    }
  }, [newState, router, props.courseId]);
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteCanvasAction,
    null as CanvasActionState,
  );
  const [restate, reAction, rePending] = useActionState(
    restoreCanvasAction,
    null as CanvasActionState,
  );
  const [defaultState, defaultAction, defaultPending] = useActionState(
    setDefaultCanvasAction,
    null as CanvasActionState,
  );

  const [generateNote, setGenerateNote] = useState<string | null>(null);
  const [generating, startGenerating] = useTransition();

  const generate = () => {
    setGenerateNote(null);
    startGenerating(async () => {
      const result = await generateCanvasAction(props.courseId);
      setGenerateNote("ok" in result ? result.message : result.error);
      router.refresh();
    });
  };

  const busy = newPending || deletePending || rePending || defaultPending;
  const errorMessage = (state: CanvasActionState): string | null =>
    state && "error" in state ? state.error : null;
  const error =
    errorMessage(newState) ??
    errorMessage(deleteState) ??
    errorMessage(restate) ??
    errorMessage(defaultState);

  return (
    <div className="grid gap-4">
      {error ? (
        <p role="alert" className="text-destructive text-sm font-semibold">
          {error}
        </p>
      ) : null}

      <form action={newAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="course_id" value={props.courseId} />
        <label htmlFor="new-canvas-title" className="text-sm font-semibold">
          New map
        </label>
        <input
          id="new-canvas-title"
          name="title"
          defaultValue=""
          placeholder="e.g. Revision week overview"
          required
          maxLength={120}
          className="w-64 flex-1 rounded border px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60"
        >
          {newPending ? "Creating…" : "New map"}
        </button>
        <button
          type="button"
          onClick={generate}
          disabled={busy || generating}
          className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-60"
        >
          {generating ? "Building…" : "Generate from course"}
        </button>
      </form>

      {generateNote ? (
        <p role="status" className="text-muted-foreground text-xs">
          {generateNote}
        </p>
      ) : null}

      {props.canvases.length === 0 && props.deleted.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No maps yet. Use the buttons above to make one.
        </p>
      ) : null}

      <ul className="grid gap-2">
        {props.canvases.map((canvas) => (
          <li
            key={canvas.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
          >
            <Link
              href={`/courses/${props.courseId}/canvas/${canvas.id}`}
              className="font-semibold underline underline-offset-4"
              dir="auto"
            >
              {canvas.title}
            </Link>
            <span className="text-muted-foreground text-xs">{canvas.kind}</span>
            {canvas.isDefault ? (
              <span className="rounded-full border px-2 py-0.5 text-[11px] font-semibold">
                Default for students
              </span>
            ) : null}
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                canvas.published ? "" : "text-muted-foreground"
              }`}
            >
              {canvas.published ? "Students can see" : "Hidden from students"}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              {!canvas.isDefault ? (
                <form action={defaultAction}>
                  <input type="hidden" name="course_id" value={props.courseId} />
                  <input type="hidden" name="canvas_id" value={canvas.id} />
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded border px-2 py-1 text-xs font-semibold disabled:opacity-60"
                  >
                    Make default
                  </button>
                </form>
              ) : null}
              <form action={deleteAction}>
                <input type="hidden" name="canvas_id" value={canvas.id} />
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded border px-2 py-1 text-xs font-semibold disabled:opacity-60"
                >
                  {deletePending ? "Deleting…" : "Delete"}
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>

      {props.deleted.length > 0 ? (
        <div className="rounded-lg border p-3">
          <h2 className="text-sm font-bold">Recently deleted maps</h2>
          <ul className="mt-2 grid gap-1">
            {props.deleted.map((canvas) => (
              <li key={canvas.id} className="flex items-center gap-2 text-sm">
                <span className="truncate" dir="auto">
                  {canvas.title}
                </span>
                <form action={reAction} className="ml-auto">
                  <input type="hidden" name="canvas_id" value={canvas.id} />
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded border px-2 py-1 text-xs font-semibold disabled:opacity-60"
                  >
                    {rePending ? "Restoring…" : "Restore"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
