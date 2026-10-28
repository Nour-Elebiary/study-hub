import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentTree } from "@/app/(leader)/courses/[courseId]/content-tree";
import { VisitMarker } from "@/app/(leader)/changed-since-visit";
import {
  SuggestionList,
  type SuggestionItem,
} from "@/app/(leader)/courses/[courseId]/suggestions/suggestion-list";
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

  // Open suggestions ("open questions", spec section 10 rule 4). The read
  // goes through the leader's own client, so RLS already limits it to notes
  // they can see; note titles come from the rows fetched above.
  const noteIds = nodes.map((n) => n.id);
  const { data: suggestionRows } = noteIds.length
    ? await supabase
        .from("suggestions")
        .select("id, note_id, text, created_at")
        .eq("resolved", false)
        .in("note_id", noteIds)
        .order("created_at")
    : { data: [] };
  const titles = new Map(nodes.map((n) => [n.id, n.title]));
  const suggestions: SuggestionItem[] = (suggestionRows ?? []).map((s) => ({
    id: s.id,
    noteId: s.note_id,
    noteTitle: titles.get(s.note_id) ?? "A note in this course",
    text: s.text,
    createdAt: s.created_at,
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
        <Link
          href={`/courses/${courseId}/access`}
          className="mt-2 inline-flex text-sm font-medium underline underline-offset-4"
        >
          Student access (join codes) →
        </Link>
      </div>

      <ContentTree
        courseId={courseId}
        nodes={nodes}
        myRole={membership?.role ?? null}
        myAreas={membership?.areas ?? []}
        isAdmin={session.profile.global_role === "admin"}
      />

      <SuggestionList suggestions={suggestions} />

      <p className="text-sm">
        <Link
          href={`/courses/${courseId}/map`}
          className="underline underline-offset-4"
        >
          View the course map 🗺️
        </Link>
        <span className="text-muted-foreground">
          {" "}
          — the content tree drawn as a mind-map.
        </span>
      </p>
    </div>
  );
}
