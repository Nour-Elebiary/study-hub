import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NoteEditor } from "@/app/(leader)/courses/[courseId]/nodes/[nodeId]/edit/note-editor";
import { Badge } from "@/components/ui/badge";
import { getMembership } from "@/lib/course-access";
import { requireSession } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Edit note" };

/**
 * The editor screen. Locks and autosave live in the client component; this
 * page only checks permission and hands over the current draft.
 */
export default async function EditNotePage({
  params,
}: PageProps<"/courses/[courseId]/nodes/[nodeId]/edit">) {
  const session = await requireSession();
  const { courseId, nodeId } = await params;
  const supabase = await createClient();

  const { data: node } = await supabase
    .from("nodes")
    .select(
      "id, course_id, area, kind, title, status, draft_body_md, created_by",
    )
    .eq("id", nodeId)
    .eq("course_id", courseId)
    .single();
  if (!node) notFound();

  const membership = await getMembership(courseId, session.userId);
  const isAdmin = session.profile.global_role === "admin";
  if (!membership && !isAdmin) notFound();

  const canWrite =
    isAdmin ||
    membership?.role === "owner" ||
    ((membership?.role === "editor" || membership?.role === "contributor") &&
      membership.areas.includes(node.area)) ||
    (membership?.role === "contributor" && node.created_by === session.userId);

  const canBreakLock = isAdmin || membership?.role === "owner";

  return (
    <div className="grid gap-4">
      <div>
        <Link
          href={`/courses/${courseId}/nodes/${nodeId}`}
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          ← Back to the note
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 text-2xl font-bold">
          <span dir="auto">{node.title || "Untitled note"}</span>
          <Badge variant="outline">{node.status.replaceAll("_", " ")}</Badge>
        </h1>
      </div>

      <NoteEditor
        nodeId={node.id}
        courseId={courseId}
        initialBody={node.draft_body_md ?? ""}
        canWrite={canWrite}
        canBreakLock={canBreakLock}
        currentUserId={session.userId}
      />
    </div>
  );
}
