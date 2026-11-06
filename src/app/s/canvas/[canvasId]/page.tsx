import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import CanvasViewerLoader from "@/app/s/canvas/[canvasId]/viewer-loader";
import type { OutlineItem } from "@/components/canvas/payload";
import { getStudentCanvas } from "@/lib/dal-canvas";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireStudentScope } from "@/lib/student-access";

export const metadata: Metadata = { title: "Course map — Study Hub" };

/**
 * The student canvas viewer (CANVAS-SPEC section 5.7). A missing,
 * unpublished or other-course map calls notFound() — the screen never
 * reveals whether a map id exists.
 */
export default async function StudentCanvasPage({
  params,
}: PageProps<"/s/canvas/[canvasId]">) {
  const scope = await requireStudentScope();
  const { canvasId } = await params;

  const detail = await getStudentCanvas(canvasId, scope);
  if (!detail) notFound();

  // The outline strip (mobile-first, D9): every published node of the
  // course, in stored order (same depth-first shape as /s/map), straight
  // from the same data that page uses.
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("nodes")
    .select("id, parent_id, title, kind, published_version_id")
    .eq("course_id", detail.canvas.courseId)
    .eq("status", "published")
    .is("deleted_at", null)
    .order("sort_order");

  type OutlineNode = {
    id: string;
    parent_id: string | null;
    title: string;
    kind: string;
    published_version_id: string | null;
  };
  const childrenOf = new Map<string | null, OutlineNode[]>();
  for (const row of (rows ?? []) as OutlineNode[]) {
    const list = childrenOf.get(row.parent_id) ?? [];
    list.push(row);
    childrenOf.set(row.parent_id, list);
  }
  const outline: OutlineItem[] = [];
  const walk = (parentId: string | null) => {
    for (const row of childrenOf.get(parentId) ?? []) {
      outline.push({
        id: row.id,
        title: row.title,
        openable: row.published_version_id !== null,
        heading: row.kind !== "note",
      });
      walk(row.id);
    }
  };
  walk(null);

  const t = await getTranslations("student.canvas");
  const labels = {
    title: t("title"),
    openMap: t("openMap"),
    listOfCards: t("listOfCards"),
    fit: t("fit"),
    zoomIn: t("zoomIn"),
    zoomOut: t("zoomOut"),
    empty: t("empty"),
    download: t("download"),
    openNote: t("openNote"),
  };

  return (
    <div className="grid gap-4">
      <Link
        href={`/s/courses/${detail.canvas.courseId}`}
        className="text-muted-foreground text-sm underline underline-offset-4"
      >
        ← Back to the course
      </Link>
      <CanvasViewerLoader
        payload={{
          id: detail.canvas.id,
          courseId: detail.canvas.courseId,
          title: detail.canvas.title,
          kind: detail.canvas.kind,
          isDefault: detail.canvas.isDefault,
          published: detail.canvas.published,
          legend: detail.canvas.legend,
          viewport: detail.canvas.viewport,
          // Students never upload from the map; the editor reads the same
          // field from settings.
          maxFileMb: 10,
          cards: detail.cards,
          edges: detail.edges,
          notes: detail.notes,
          files: detail.files,
        }}
        outline={outline}
        labels={labels}
      />
    </div>
  );
}
