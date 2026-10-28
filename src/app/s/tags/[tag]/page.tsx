import type { Metadata } from "next";
import Link from "next/link";
import { requireStudentScope, getStudentCourseIds } from "@/lib/student-access";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Tag — Study Hub" };

/**
 * One tag across the student's courses (spec section 10 rule 2): published
 * notes carrying it, e.g. everything tagged #quiz1.
 */
export default async function StudentTagPage({
  params,
}: PageProps<"/s/tags/[tag]">) {
  const scope = await requireStudentScope();
  const { tag } = await params;
  const tagName = decodeURIComponent(tag);

  const courseIds = await getStudentCourseIds(scope);
  const admin = createAdminClient();

  const { data: tagRow } = await admin
    .from("tags")
    .select("id")
    .eq("name", tagName)
    .maybeSingle();

  let hits: { id: string; title: string }[] = [];
  if (tagRow && courseIds.length > 0) {
    const { data: links } = await admin
      .from("node_tags")
      .select("node_id")
      .eq("tag_id", tagRow.id);
    const nodeIds = (links ?? []).map((l) => l.node_id);
    if (nodeIds.length > 0) {
      const { data: rows } = await admin
        .from("nodes")
        .select("id, title")
        .eq("status", "published")
        .is("deleted_at", null)
        .in("course_id", courseIds)
        .in("id", nodeIds)
        .order("title");
      hits = (rows ?? []).map((r) => ({ id: r.id, title: r.title }));
    }
  }

  return (
    <div className="grid gap-4">
      <div>
        <Link
          href="/s/tags"
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          ← All tags
        </Link>
        <h1 className="mt-2 text-2xl font-bold">#{tagName}</h1>
      </div>

      {hits.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No published notes carry this tag in your courses.
        </p>
      ) : (
        <ul className="grid gap-2">
          {hits.map((h) => (
            <li key={h.id}>
              <Link
                href={`/s/notes/${h.id}`}
                className="block rounded-md border p-3 text-sm font-medium"
              >
                {h.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
