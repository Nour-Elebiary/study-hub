import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentTree } from "@/app/(leader)/courses/[courseId]/content-tree";
import { VisitMarker } from "@/app/(leader)/changed-since-visit";
import { Badge } from "@/components/ui/badge";
import { getMembership } from "@/lib/course-access";
import { requireSession } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Course" };

export type TreeNode = {
  id: string;
  parentId: string | null;
  area: string;
  kind: "core" | "course_home" | "section" | "note";
  title: string;
  status: "draft" | "in_review" | "published";
  sortOrder: number;
  assignedTo: string | null;
  dueDate: string | null;
  updatedAt: string;
};

export default async function CoursePage({
  params,
}: PageProps<"/courses/[courseId]">) {
  const session = await requireSession();
  const { courseId } = await params;
  const supabase = await createClient();

  const { data: course } = await supabase
    .from("courses")
    .select("id, code, title, semester")
    .eq("id", courseId)
    .single();
  if (!course) notFound();

  const membership = await getMembership(courseId, session.userId);
  if (!membership && session.profile.global_role !== "admin") {
    notFound();
  }

  const { data: rows } = await supabase
    .from("nodes")
    .select(
      "id, parent_id, area, kind, title, status, sort_order, assigned_to, due_date, updated_at",
    )
    .eq("course_id", courseId)
    .is("deleted_at", null)
    .order("sort_order");

  const nodes: TreeNode[] = (rows ?? []).map((n) => ({
    id: n.id,
    parentId: n.parent_id,
    area: n.area,
    kind: n.kind,
    title: n.title,
    status: n.status,
    sortOrder: n.sort_order,
    assignedTo: n.assigned_to,
    dueDate: n.due_date,
    updatedAt: n.updated_at,
  }));

  return (
    <div className="grid gap-4">
      <VisitMarker courseId={courseId} />
      <div>
        <Link
          href="/courses"
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          ← All courses
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 text-2xl font-bold">
          {course.title}
          <Badge variant="secondary">{course.code}</Badge>
        </h1>
        {course.semester && (
          <p className="text-muted-foreground mt-1 text-sm">
            {course.semester}
          </p>
        )}
      </div>

      <ContentTree
        courseId={courseId}
        nodes={nodes}
        myRole={membership?.role ?? null}
        myAreas={membership?.areas ?? []}
        isAdmin={session.profile.global_role === "admin"}
      />
    </div>
  );
}
