import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  MindMap,
  type MapNodeData,
} from "@/app/(leader)/courses/[courseId]/map/mind-map";
import { getMembership } from "@/lib/course-access";
import { requireSession } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Course map" };

/**
 * The auto mind-map (spec section 6): built from the nodes tree with React
 * Flow, tag highlighting, collapse/expand, PNG/SVG export. On phones the
 * same data shows as an outline.
 */
export default async function MapPage({
  params,
}: PageProps<"/courses/[courseId]/map">) {
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

  const { data: rows } = await supabase
    .from("nodes")
    .select("id, parent_id, title, kind, area, status, node_tags(tags(name))")
    .eq("course_id", courseId)
    .is("deleted_at", null)
    .order("sort_order");

  const nodes: MapNodeData[] = (rows ?? []).map((row) => ({
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    kind: row.kind,
    area: row.area,
    status: row.status,
    tags: (row.node_tags ?? [])
      .map(
        (link) => (link as unknown as { tags?: { name?: string } }).tags?.name,
      )
      .filter((name): name is string => Boolean(name)),
  }));

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
          Course map — {course.title}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          This map is built from your content tree automatically. Click a node
          to open it, pick a tag to highlight matching notes, or export the map
          as a picture.
        </p>
      </div>

      <MindMap courseId={courseId} nodes={nodes} />
    </div>
  );
}
