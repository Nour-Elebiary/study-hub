import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CanvasEditorLoader from "@/app/(leader)/courses/[courseId]/canvas/[canvasId]/editor-loader";
import type { CanvasPayload } from "@/components/canvas/payload";
import { getCanvas } from "@/lib/dal-canvas";
import { requireSession } from "@/lib/dal";
import { getMembership } from "@/lib/course-access";

export const metadata: Metadata = { title: "Canvas map" };

/**
 * One map's editor (CANVAS-SPEC section 5.6): the server loads the map with
 * resolved note/file targets, then hands a plain payload to the
 * client-only editor.
 */
export default async function CanvasEditorPage({
  params,
}: PageProps<"/courses/[courseId]/canvas/[canvasId]">) {
  const session = await requireSession();
  const { canvasId } = await params;

  const detail = await getCanvas(canvasId);
  if (!detail) notFound();

  const membership = await getMembership(
    detail.canvas.courseId,
    session.userId,
  );
  const isAdmin = session.profile.global_role === "admin";
  if (!membership && !isAdmin) notFound();

  const payload: CanvasPayload = {
    id: detail.canvas.id,
    courseId: detail.canvas.courseId,
    title: detail.canvas.title,
    kind: detail.canvas.kind,
    isDefault: detail.canvas.isDefault,
    published: detail.canvas.published,
    legend: detail.canvas.legend,
    viewport: detail.canvas.viewport,
    cards: detail.cards,
    edges: detail.edges,
    notes: detail.notes,
    files: detail.files,
  };

  return (
    <div className="grid gap-2">
      <div>
        <Link
          href={`/courses/${detail.canvas.courseId}/canvas`}
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          ← All maps
        </Link>
        <h1 className="mt-1 truncate text-xl font-bold" dir="auto">
          {detail.canvas.title}
        </h1>
      </div>
      <CanvasEditorLoader payload={payload} />
    </div>
  );
}
