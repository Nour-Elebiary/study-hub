import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Markdown from "react-markdown";
import { NoteActions } from "@/app/(leader)/courses/[courseId]/nodes/[nodeId]/note-actions";
import { NoteComments } from "@/app/(leader)/courses/[courseId]/nodes/[nodeId]/note-comments";
import {
  NoteAssets,
  type AssetItem,
} from "@/app/(leader)/courses/[courseId]/nodes/[nodeId]/assets/note-assets";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getMembership } from "@/lib/course-access";
import { requireSession } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Note" };

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  published: "Published",
};

export default async function NotePage({
  params,
}: PageProps<"/courses/[courseId]/nodes/[nodeId]">) {
  const session = await requireSession();
  const { courseId, nodeId } = await params;
  const supabase = await createClient();

  const { data: node } = await supabase
    .from("nodes")
    .select(
      "id, course_id, area, kind, title, status, assigned_to, due_date, created_by, draft_body_md, draft_updated_at, published_version_id, updated_at",
    )
    .eq("id", nodeId)
    .eq("course_id", courseId)
    .single();
  if (!node) notFound();

  const membership = await getMembership(courseId, session.userId);
  const isAdmin = session.profile.global_role === "admin";
  if (!membership && !isAdmin) notFound();

  // What to show: the newest version; before the first save, the draft.
  const { data: versions } = await supabase
    .from("node_versions")
    .select("id, version_no, body_md, created_at")
    .eq("node_id", nodeId)
    .order("version_no", { ascending: false })
    .limit(1);
  const latestVersion = versions?.[0] ?? null;

  const { data: tags } = await supabase
    .from("node_tags")
    .select("tags(name)")
    .eq("node_id", nodeId);

  const { data: comments } = await supabase
    .from("comments")
    .select("id, parent_id, author_id, body, resolved, created_at")
    .eq("node_id", nodeId)
    .order("created_at");

  // Files attached to this note (M3). Everyone in the course sees them.
  const { data: assetRows } = await supabase
    .from("assets")
    .select(
      "id, title, kind, storage, path_or_url, mime, size_bytes, student_visible, student_downloadable, created_at",
    )
    .eq("node_id", nodeId)
    .order("created_at");

  // The upload size limit lives in settings (spec rule 8), not in code.
  const { data: limitRow } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "max_file_mb")
    .maybeSingle();
  const maxFileMb = typeof limitRow?.value === "number" ? limitRow.value : 10;

  // Names of everyone involved with this note (comment authors, the
  // assignee). RLS limits this to co-members and, for admins, everyone.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .is("deleted_at", null);
  const nameByUser = new Map(
    (profiles ?? []).map((p) => [p.id, p.display_name]),
  );

  // The assignment list: only an owner or admin assigns, and only they can
  // read the course's membership list.
  const canAssign = isAdmin || membership?.role === "owner";
  const members: { id: string; name: string }[] = [];
  if (canAssign) {
    const { data: memberRows } = await supabase
      .from("course_members")
      .select("user_id")
      .eq("course_id", courseId);
    const ids = (memberRows ?? []).map((m) => m.user_id);
    if (ids.length > 0) {
      const { data: memberProfiles } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", ids)
        .is("deleted_at", null);
      for (const p of memberProfiles ?? []) {
        members.push({ id: p.id, name: p.display_name || "A leader" });
      }
    }
  }

  const tagNameList = (tags ?? [])
    .map((t) => (t as unknown as { tags?: { name?: string } }).tags?.name)
    .filter((n): n is string => Boolean(n));

  const body = latestVersion?.body_md || node.draft_body_md || "";

  // Capability booleans, computed from the spec section 4 matrix. The server
  // actions re-check everything; RLS is the final gate.
  const role = membership?.role ?? null;
  const inArea =
    role === "editor" || role === "contributor"
      ? (membership?.areas ?? []).includes(node.area)
      : false;
  const isMine = node.created_by === session.userId;
  const canWrite =
    isAdmin ||
    role === "owner" ||
    (role === "editor" && inArea) ||
    (role === "contributor" && inArea && isMine);
  const canReview = isAdmin || role === "owner" || role === "reviewer";
  const canDelete =
    isAdmin ||
    role === "owner" ||
    (role === "editor" && (isMine || node.assigned_to === session.userId)) ||
    (role === "contributor" && isMine && node.status === "draft");
  // Files: admins, owners, editors and contributors manage them; reviewers
  // and other members only see and download (spec section 4).
  const canManageAssets =
    isAdmin || role === "owner" || role === "editor" || role === "contributor";

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
          {node.title || "Untitled note"}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <Badge>{STATUS_LABELS[node.status]}</Badge>
          <Badge variant="outline">{node.area.replaceAll("_", " ")}</Badge>
          {tagNameList.map((tag) => (
            <Badge key={tag} variant="secondary">
              #{tag}
            </Badge>
          ))}
        </div>
        {node.assigned_to && (
          <p className="text-muted-foreground mt-2 text-sm">
            Assigned to {nameByUser.get(node.assigned_to) ?? "a leader"}
            {node.due_date ? ` — due ${node.due_date}` : ""}
          </p>
        )}
      </div>

      <NoteActions
        nodeId={node.id}
        courseId={courseId}
        status={node.status}
        tags={tagNameList}
        canWrite={canWrite}
        canReview={canReview}
        canAssign={canAssign}
        canDelete={canDelete}
        members={members}
        assignedTo={node.assigned_to}
        dueDate={node.due_date}
        hasVersions={(latestVersion?.version_no ?? 0) > 0}
      />

      <Card>
        <CardContent className="pt-6">
          <div className="prose prose-sm sm:prose-base max-w-none" dir="auto">
            <Markdown>{body || "*Nothing written yet.*"}</Markdown>
          </div>
        </CardContent>
      </Card>

      <NoteAssets
        courseId={courseId}
        nodeId={node.id}
        canManage={canManageAssets}
        maxFileMb={maxFileMb}
        assets={
          (assetRows ?? []).map((a) => ({
            id: a.id,
            title: a.title,
            kind: a.kind,
            storage: a.storage,
            pathOrUrl: a.path_or_url,
            mime: a.mime,
            sizeBytes: a.size_bytes,
            studentVisible: a.student_visible,
            studentDownloadable: a.student_downloadable,
          })) satisfies AssetItem[]
        }
      />

      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          href={`/courses/${courseId}/nodes/${nodeId}/versions`}
          className="underline underline-offset-4"
        >
          Version history
          {latestVersion ? ` (${latestVersion.version_no})` : ""}
        </Link>
      </div>

      <NoteComments
        nodeId={node.id}
        comments={(comments ?? []).map((c) => ({
          id: c.id,
          parentId: c.parent_id,
          authorName: nameByUser.get(c.author_id) ?? "A leader",
          body: c.body,
          resolved: c.resolved,
          createdAt: c.created_at,
          authorId: c.author_id,
        }))}
        currentUserId={session.userId}
        canModerate={isAdmin || role === "owner"}
      />
    </div>
  );
}
