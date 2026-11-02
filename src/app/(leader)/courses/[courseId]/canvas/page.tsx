import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CanvasListTools from "@/app/(leader)/courses/[courseId]/canvas/canvas-list";
import {
  listCanvases,
  listDeletedCanvases,
} from "@/lib/dal-canvas";
import { getMembership } from "@/lib/course-access";
import { requireSession } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Canvas maps" };

const KIND_LABEL: Record<string, string> = {
  course: "Course",
  subject: "Section",
  free: "Free",
};

/**
 * The designer's list of maps for one course (CANVAS-SPEC section 5.6):
 * every map with its state, a New map form, the "generate from course"
 * button, and the restore link for recently deleted maps.
 */
export default async function CanvasListPage({
  params,
}: PageProps<"/courses/[courseId]/canvas">) {
  const session = await requireSession();
  const { courseId } = await params;
  const supabase = await createClient();

  const { data: course } = await supabase
    .from("courses")
    .select("id, title")
    .eq("id", courseId)
    .single();
  if (!course) notFound();

  const membership = await getMembership(courseId, session.userId);
  const isAdmin = session.profile.global_role === "admin";
  if (!membership && !isAdmin) notFound();

  const [canvases, deleted] = await Promise.all([
    listCanvases(courseId),
    listDeletedCanvases(courseId),
  ]);

  return (
    <div className="grid gap-4">
      <div>
        <Link
          href={`/courses/${courseId}`}
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          ← Back to the course
        </Link>
        <h1 className="mt-2 text-2xl font-bold" dir="auto">
          Maps — {course.title}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Hand-drawn maps for this course. Students only see published maps.
        </p>
      </div>

      <CanvasListTools
        courseId={courseId}
        canvases={canvases.map((canvas) => ({
          id: canvas.id,
          title: canvas.title,
          kind: KIND_LABEL[canvas.kind] ?? canvas.kind,
          isDefault: canvas.isDefault,
          published: canvas.published,
        }))}
        deleted={deleted.map((canvas) => ({
          id: canvas.id,
          title: canvas.title,
        }))}
      />
    </div>
  );
}
