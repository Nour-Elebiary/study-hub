"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { PdfPreview } from "@/app/(leader)/courses/[courseId]/nodes/[nodeId]/assets/pdf-preview";
import { NoteEditor } from "@/app/(leader)/courses/[courseId]/nodes/[nodeId]/edit/note-editor";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { FileTarget } from "./payload";

/**
 * One open card in the side pane (spec 6.6). `body: null` with a non-null
 * `error` means the note could not be loaded (gone, or no longer in the
 * course); `loading` shows while the server action runs.
 */
export type PaneEntry =
  | {
      type: "note";
      cardId: string;
      title: string;
      loading: boolean;
      /** Null while loading or on error — see `error`. */
      body: string | null;
      error: string | null;
      nodeId: string;
      canWrite: boolean;
      canBreakLock: boolean;
    }
  | {
      type: "file";
      cardId: string;
      title: string;
      loading: boolean;
      file: FileTarget;
    };

const MIN_W = 320;
const MAX_W = 720;

/**
 * Signs a private asset path with a 10-minute link in the leader's browser
 * (same pattern as the file card thumbnails, spec 10 rule 3). Returns null
 * while loading or when signing failed.
 */
function useSignedUrl(
  pathOrUrl: string,
  mode: "view" | "download",
  fileName: string,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    const supabase = createBrowserSupabase();
    void supabase.storage
      .from("assets")
      .createSignedUrl(
        pathOrUrl,
        600,
        mode === "download" ? { download: fileName || true } : undefined,
      )
      .then(({ data }) => {
        if (!dead) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      dead = true;
    };
  }, [pathOrUrl, mode, fileName]);
  return url;
}

/** Image → thumbnail, PDF → pdf.js viewer, audio/video → HTML5 players. */
function FilePaneBody({ file }: { file: FileTarget }) {
  const viewUrl = useSignedUrl(file.pathOrUrl, "view", file.name);
  const downloadUrl = useSignedUrl(file.pathOrUrl, "download", file.name);
  if (file.kind === "image" && viewUrl) {
    return (
      // Signed storage URL, not a public host — next/image cannot sign in.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={viewUrl}
        alt={file.name}
        className="max-h-full max-w-full rounded border"
      />
    );
  }
  if (file.kind === "pdf" && viewUrl) {
    return <PdfPreview signedUrl={viewUrl} title={file.name} />;
  }
  if (file.kind === "audio" && viewUrl) {
    return <audio controls src={viewUrl} className="w-full" />;
  }
  if (file.kind === "video" && viewUrl) {
    return (
      <video
        controls
        src={viewUrl}
        className="max-h-full w-full rounded"
        preload="metadata"
      />
    );
  }
  // Everything else (and any kind whose signed link failed): download card.
  return (
    <div className="grid gap-2">
      <p aria-hidden="true" className="text-4xl">
        📎
      </p>
      <p className="text-sm font-semibold" dir="auto">
        {file.name}
      </p>
      {downloadUrl ? (
        <a
          href={downloadUrl}
          className="text-sm underline underline-offset-4"
          download
        >
          Download
        </a>
      ) : (
        <p className="text-muted-foreground text-sm">
          This file cannot be opened here.
        </p>
      )}
    </div>
  );
}

/**
 * The side pane (spec 6.6): the clicked card opens on the right. ≥1280 px
 * docked and resizable with the drag handle, 768–1279 px an overlay drawer,
 * <768 px a full-screen sheet. The note editor is only mounted for the
 * active tab, so a note is never edited in two places at once (its lock is
 * released when the tab is switched away, see the editor's cleanup).
 */
export function SidePane({
  entries,
  activeId,
  courseId,
  userId,
  onClose,
  onActivate,
}: {
  entries: readonly PaneEntry[];
  activeId: string | null;
  courseId: string;
  userId: string;
  onClose: () => void;
  onActivate: (cardId: string) => void;
}) {
  const active = entries.find((entry) => entry.cardId === activeId) ?? null;
  const [width, setWidth] = useState(420);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startWidth: width };
  };
  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setWidth(
      Math.min(
        MAX_W,
        Math.max(MIN_W, drag.startWidth + (drag.startX - event.clientX)),
      ),
    );
  };
  const endResize = () => {
    dragRef.current = null;
  };

  /** Arrow keys resize too, for people who do not drag. */
  const resizeKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.key === "ArrowLeft" ? 24 : -24;
    setWidth((current) => Math.min(MAX_W, Math.max(MIN_W, current + step)));
  };

  return (
    <aside
      role="complementary"
      aria-label="Card viewer"
      style={{ width: `${width}px` }}
      className="border-l-border bg-background z-10 flex flex-col overflow-hidden border-l max-xl:fixed max-xl:top-0 max-xl:bottom-0 max-xl:w-[26rem]! max-xl:shadow-2xl max-md:inset-0 max-md:h-dvh max-md:w-full!"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        tabIndex={0}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onKeyDown={resizeKeys}
        className="border-border hover:bg-ring focus-visible:bg-ring w-1 cursor-col-resize border-l max-xl:hidden"
      />
      <div
        role="tablist"
        aria-label="Open cards"
        className="flex items-center gap-1 overflow-x-auto border-b p-1"
      >
        {entries.map((entry) => (
          <button
            key={entry.cardId}
            type="button"
            role="tab"
            aria-selected={entry.cardId === activeId}
            onClick={() => onActivate(entry.cardId)}
            className={[
              "max-w-44 shrink-0 truncate rounded border px-2 py-1 text-xs font-semibold",
              entry.cardId === activeId
                ? "border-ring bg-ring/10"
                : "border-border bg-background",
            ].join(" ")}
            dir="auto"
          >
            <span aria-hidden="true" className="ml-1">
              {entry.type === "note" ? "📝" : "📎"}
            </span>
            {entry.title || "Card"}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close viewer"
          title="Close"
          className="bg-background ml-auto shrink-0 rounded border px-2 py-1 text-xs font-semibold"
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {active === null ? null : active.type === "file" ? (
          <FilePaneBody file={active.file} />
        ) : active.loading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : active.error !== null ? (
          <p className="text-sm">{active.error}</p>
        ) : (
          active.body !== null && (
            <>
              <a
                href={`/courses/${courseId}/nodes/${active.nodeId}`}
                className="text-muted-foreground mb-2 inline-block text-sm underline underline-offset-4"
              >
                Open full page
              </a>
              <NoteEditor
                key={active.cardId}
                nodeId={active.nodeId}
                courseId={courseId}
                initialBody={active.body}
                canWrite={active.canWrite}
                canBreakLock={active.canBreakLock}
                currentUserId={userId}
              />
            </>
          )
        )}
      </div>
    </aside>
  );
}
