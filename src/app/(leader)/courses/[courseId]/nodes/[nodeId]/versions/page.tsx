import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RestoreButton } from "@/app/(leader)/courses/[courseId]/nodes/[nodeId]/versions/restore-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { diffLines } from "@/lib/diff";
import { getMembership } from "@/lib/course-access";
import { requireSession } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Version history" };

/**
 * Version history (spec section 6): every save is listed, a version can be
 * compared with the one before it, and restoring writes the old text as a
 * NEW version — the history is never rewritten.
 */
export default async function VersionsPage({
  params,
  searchParams,
}: PageProps<"/courses/[courseId]/nodes/[nodeId]/versions">) {
  const session = await requireSession();
  const { courseId, nodeId } = await params;
  const { v } = await searchParams;
  const supabase = await createClient();

  const { data: node } = await supabase
    .from("nodes")
    .select("id, title, area, created_by")
    .eq("id", nodeId)
    .eq("course_id", courseId)
    .single();
  if (!node) notFound();

  const membership = await getMembership(courseId, session.userId);
  const isAdmin = session.profile.global_role === "admin";
  if (!membership && !isAdmin) notFound();

  const { data: versions } = await supabase
    .from("node_versions")
    .select("version_no, body_md, author_id, change_note, created_at")
    .eq("node_id", nodeId)
    .order("version_no", { ascending: false });

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .is("deleted_at", null);
  const nameByUser = new Map(
    (profiles ?? []).map((p) => [p.id, p.display_name]),
  );

  const role = membership?.role ?? null;
  const inArea =
    role === "editor" || role === "contributor"
      ? (membership?.areas ?? []).includes(node.area)
      : false;
  const canWrite =
    isAdmin ||
    role === "owner" ||
    (role === "editor" && inArea) ||
    (role === "contributor" && inArea && node.created_by === session.userId);

  const selected =
    versions?.find((ver) => String(ver.version_no) === v) ?? null;
  const previous = selected
    ? (versions?.find((ver) => ver.version_no === selected.version_no - 1) ??
      null)
    : null;

  return (
    <div className="grid gap-4">
      <div>
        <Link
          href={`/courses/${courseId}/nodes/${nodeId}`}
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          ← Back to the note
        </Link>
        <h1 className="mt-2 text-2xl font-bold" dir="auto">
          Version history — {node.title || "Untitled note"}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Every save is kept. Restoring an old version adds it back as the
          newest version; nothing is ever deleted.
        </p>
      </div>

      {(versions ?? []).length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No versions yet. Press Save in the editor to keep the first one.
        </p>
      ) : (
        <ol className="grid gap-2">
          {versions!.map((ver) => (
            <li
              key={ver.version_no}
              className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <Badge
                variant={
                  selected?.version_no === ver.version_no
                    ? "default"
                    : "outline"
                }
              >
                Version {ver.version_no}
              </Badge>
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {ver.change_note || "—"}
              </span>
              <span className="text-muted-foreground text-xs">
                {nameByUser.get(ver.author_id) ?? "—"} ·{" "}
                {new Date(ver.created_at).toLocaleString()}
              </span>
              <Link
                href={`/courses/${courseId}/nodes/${nodeId}/versions?v=${ver.version_no}`}
                className="underline underline-offset-4"
              >
                Compare
              </Link>
              <RestoreButton
                nodeId={nodeId}
                versionNo={ver.version_no}
                canWrite={canWrite}
              />
            </li>
          ))}
        </ol>
      )}

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Version {selected.version_no} compared with{" "}
              {previous ? `version ${previous.version_no}` : "an empty note"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className="grid gap-0.5 rounded-md border p-3 font-mono text-xs"
              dir="auto"
            >
              {diffLines(previous?.body_md ?? "", selected.body_md).map(
                (line, index) => (
                  <div
                    key={index}
                    className={
                      line.kind === "added"
                        ? "bg-green-100 dark:bg-green-950"
                        : line.kind === "removed"
                          ? "bg-red-100 line-through dark:bg-red-950"
                          : ""
                    }
                  >
                    <span
                      aria-hidden
                      className="mr-2 inline-block w-4 text-center select-none"
                    >
                      {line.kind === "added"
                        ? "+"
                        : line.kind === "removed"
                          ? "−"
                          : " "}
                    </span>
                    {line.text || " "}
                  </div>
                ),
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
