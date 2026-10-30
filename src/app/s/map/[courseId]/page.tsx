import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStudentScope } from "@/lib/student-access";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Outline — Study Hub" };

type OutlineNode = {
  id: string;
  parentId: string | null;
  title: string;
  /** True when /s/notes/<id> can render this node. */
  openable: boolean;
};

/**
 * The course as an outline (spec section 10 rule 2: "Mind-map (outline on
 * phones)"): the same tree the leader sees as a mind-map, drawn as nested
 * lists that work at 360 px without JavaScript.
 */
export default async function StudentMapPage({
  params,
}: PageProps<"/s/map/[courseId]">) {
  const scope = await requireStudentScope();
  const { courseId } = await params;

  const admin = createAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select("id, title")
    .eq("id", courseId)
    .eq("archived", false)
    .single();
  if (!course) notFound();
  if (!scope.scope.all && !scope.scope.courseIds.includes(courseId)) {
    notFound();
  }

  const { data: rows } = await admin
    .from("nodes")
    .select("id, parent_id, title, published_version_id, sort_order")
    .eq("course_id", courseId)
    .eq("status", "published")
    .is("deleted_at", null)
    .order("sort_order");

  const nodes: OutlineNode[] = (rows ?? []).map((n) => ({
    id: n.id,
    parentId: n.parent_id,
    title: n.title,
    // Sections can be published without a version (they are folders, not
    // notes); those stay in the tree as headings but must not link to
    // /s/notes, which 404s them.
    openable: n.published_version_id !== null,
  }));

  const childrenOf = new Map<string, OutlineNode[]>();
  for (const n of nodes) {
    const key = n.parentId ?? "";
    const list = childrenOf.get(key) ?? [];
    list.push(n);
    childrenOf.set(key, list);
  }

  function Outline({ parentKey, depth }: { parentKey: string; depth: number }) {
    const children = childrenOf.get(parentKey) ?? [];
    if (children.length === 0) return null;
    return (
      <ul className={depth === 0 ? "grid gap-1" : "grid gap-1 border-l pl-4"}>
        {children.map((n) => (
          <li key={n.id}>
            {n.openable ? (
              <Link
                href={`/s/notes/${n.id}`}
                className="hover:bg-muted block rounded px-2 py-1.5 text-sm"
                dir="auto"
              >
                {n.title}
              </Link>
            ) : (
              <span className="block px-2 py-1.5 text-sm" dir="auto">
                {n.title}
              </span>
            )}
            <Outline parentKey={n.id} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="grid gap-4">
      <div>
        <Link
          href={`/s/courses/${courseId}`}
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          ← {course.title}
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Outline</h1>
      </div>

      {nodes.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing published here yet.
        </p>
      ) : (
        <Outline parentKey="" depth={0} />
      )}
    </div>
  );
}
