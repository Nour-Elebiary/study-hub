"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * PDF preview with pdf.js (spec section 6: "Preview PDFs"). The bytes are
 * fetched from a short-lived signed URL and rendered on a canvas — the file
 * never leaves the leader's browser unencrypted.
 */
export function PdfPreview({
  signedUrl,
  title,
}: {
  signedUrl: string;
  title: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const taskRef = useRef<Awaited<ReturnType<typeof loadPdfTask>> | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  /** getDocument returns a loading task; destroy() lives on the task in v6. */
  async function loadPdfTask(url: string) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const response = await fetch(url);
    if (!response.ok) throw new Error("download-failed");
    const data = await response.arrayBuffer();
    return pdfjs.getDocument({ data });
  }

  // Load the document once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const task = await loadPdfTask(signedUrl);
        const doc = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        taskRef.current = task;
        setPageCount(doc.numPages);
        setPage(1);
      } catch {
        if (!cancelled) setError("The PDF could not be opened.");
      }
    })();
    return () => {
      cancelled = true;
      void taskRef.current?.destroy();
      taskRef.current = null;
    };
  }, [signedUrl]);

  // Render the current page whenever it changes.
  useEffect(() => {
    const task = taskRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!task || !canvas || !container) return;
    let cancelled = false;
    void (async () => {
      try {
        const doc = await task.promise;
        if (cancelled) return;
        const pdfPage = await doc.getPage(page);
        if (cancelled) return;
        const available = container.clientWidth || 320;
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = Math.max(available / base.width, 0.5);
        const viewport = pdfPage.getViewport({ scale });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await pdfPage.render({ canvas, viewport }).promise;
      } catch {
        if (!cancelled) setError("This page could not be shown.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, pageCount]);

  if (error) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {error}
      </p>
    );
  }

  return (
    <div className="grid gap-2" ref={containerRef}>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          ← Previous page
        </Button>
        <span className="text-muted-foreground text-sm">
          {pageCount > 0 ? `Page ${page} of ${pageCount}` : "Loading…"}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pageCount === 0 || page >= pageCount}
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
        >
          Next page →
        </Button>
      </div>
      <canvas
        ref={canvasRef}
        aria-label={`Preview of ${title}`}
        className="max-w-full rounded-md border bg-white"
      />
    </div>
  );
}
