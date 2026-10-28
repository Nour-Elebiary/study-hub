import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Markdown from "react-markdown";
import { SuggestForm } from "@/app/s/notes/[nodeId]/suggest-form";
import { requireStudentScope, getStudentCourseIds } from "@/lib/student-access";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Note — Study Hub" };

type AssetItem = {
  id: string;
  title: string;
  kind: string;
  storage: string;
  pathOrUrl: string;
  mime: string;
  sizeBytes: number | null;
  downloadable: boolean;
};

const KIND_ICONS: Record<string, string> = {
  image: "🖼️",
  pdf: "📄",
  audio: "🎧",
  video: "🎬",
  document: "📃",
  other: "📎",
};

/**
 * One note, read-only (spec section 10 rules 2-4): only the last published
 * version, its visible files, its tags, and the "suggest a correction"
 * button. Students from other courses or unpublished notes get a 404.
 */
export default async function StudentNotePage({
  params,
}: PageProps<"/s/notes/[nodeId]">) {
  const scope = await requireStudentScope();
  const { nodeId } = await params;

  const admin = createAdminClient();
  const { data: node } = await admin
    .from("nodes")
    .select(
      "id, course_id, kind, title, area, status, published_version_id, deleted_at",
    )
    .eq("id", nodeId)
    .single();
  if (!node || node.deleted_at || node.status !== "published") notFound();
  if (!node.published_version_id) notFound();

  // Core pages (course_id null) are visible to every joined student; course
  // notes only inside the student's scope.
  if (node.course_id) {
    const courseIds = await getStudentCourseIds(scope);
    if (!courseIds.includes(node.course_id)) notFound();
  }

  const { data: version } = await admin
    .from("node_versions")
    .select("body_md")
    .eq("id", node.published_version_id)
    .single();

  const { data: tagRows } = await admin
    .from("node_tags")
    .select("tags(name)")
    .eq("node_id", nodeId);

  const tagNames = (tagRows ?? [])
    .map(
      (t) => (t as unknown as { tags?: { name?: string } | null }).tags?.name,
    )
    .filter((n): n is string => Boolean(n));

  // Only files marked student_visible reach this page; downloads also check
  // student_downloadable (spec section 10 rule 3).
  const { data: assetRows } = await admin
    .from("assets")
    .select(
      "id, title, kind, storage, path_or_url, mime, size_bytes, student_downloadable",
    )
    .eq("node_id", nodeId)
    .eq("student_visible", true)
    .order("created_at");

  const assets: AssetItem[] = (assetRows ?? []).map((a) => ({
    id: a.id,
    title: a.title || a.path_or_url,
    kind: a.kind,
    storage: a.storage,
    pathOrUrl: a.path_or_url,
    mime: a.mime,
    sizeBytes: a.size_bytes,
    downloadable: a.student_downloadable,
  }));

  return (
    <div className="grid gap-4">
      <div>
        <Link
          href={node.course_id ? `/s/courses/${node.course_id}` : "/s"}
          className="text-muted-foreground text-sm underline underline-offset-4 print:hidden"
        >
          ← Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold" dir="auto">
          {node.title}
        </h1>
        {tagNames.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-2">
            {tagNames.map((t) => (
              <Link
                key={t}
                href={`/s/tags/${encodeURIComponent(t)}`}
                className="bg-secondary text-secondary-foreground rounded-full px-2.5 py-0.5 text-xs font-medium"
              >
                #{t}
              </Link>
            ))}
          </p>
        )}
      </div>

      <div className="prose prose-sm sm:prose-base max-w-none" dir="auto">
        <Markdown>{version?.body_md || "*Nothing published yet.*"}</Markdown>
      </div>

      {assets.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold">Files</h2>
          <ul className="mt-2 grid gap-2">
            {assets.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-md border p-3 text-sm"
              >
                <span aria-hidden>
                  {KIND_ICONS[a.kind] ?? KIND_ICONS.other}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {a.title}
                </span>
                {a.storage === "supabase" && a.downloadable && (
                  <Link
                    href={`/s/download/${a.id}`}
                    className="shrink-0 text-sm font-medium underline underline-offset-4"
                  >
                    Download
                  </Link>
                )}
                {a.storage !== "supabase" && a.downloadable && (
                  <a
                    href={a.pathOrUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-sm font-medium underline underline-offset-4"
                  >
                    Open ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="print:hidden">
        <SuggestForm nodeId={nodeId} />
      </div>
    </div>
  );
}
