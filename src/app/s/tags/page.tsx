import type { Metadata } from "next";
import Link from "next/link";
import { requireStudentScope, getStudentCourseIds } from "@/lib/student-access";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Tags — Study Hub" };

/**
 * Tag index (spec section 10 rule 2: "Tag filter such as quiz1"): every tag
 * used by published notes in the student's courses, with how many notes
 * carry it.
 */
export default async function StudentTagsPage() {
  const scope = await requireStudentScope();
  const courseIds = await getStudentCourseIds(scope);

  const admin = createAdminClient();

  // Published notes the student can see, then their tags.
  const { data: nodes } = await admin
    .from("nodes")
    .select("id")
    .eq("status", "published")
    .is("deleted_at", null)
    .in(
      "course_id",
      courseIds.length > 0
        ? courseIds
        : ["00000000-0000-0000-0000-000000000000"],
    );
  const nodeIds = (nodes ?? []).map((n) => n.id);

  const counts = new Map<string, { id: string; count: number }>();
  if (nodeIds.length > 0) {
    const { data: links } = await admin
      .from("node_tags")
      .select("tag_id, tags(id, name)")
      .in("node_id", nodeIds);
    for (const link of links ?? []) {
      const tag = (
        link as unknown as { tags?: { id: string; name: string } | null }
      ).tags;
      if (!tag) continue;
      const entry = counts.get(tag.name) ?? { id: tag.id, count: 0 };
      entry.count += 1;
      counts.set(tag.name, entry);
    }
  }

  const tags = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Tags</h1>
      {tags.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No tags in your courses yet.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {tags.map(([name, info]) => (
            <li key={info.id}>
              <Link
                href={`/s/tags/${encodeURIComponent(name)}`}
                className="bg-secondary text-secondary-foreground inline-block rounded-full px-3 py-1.5 text-sm font-medium"
                dir="auto"
              >
                #{name} ({info.count})
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
