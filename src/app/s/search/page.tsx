import type { Metadata } from "next";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { searchSchema } from "@/lib/schemas";
import {
  requireStudentScope,
  getStudentCourseIds,
  getStudentCourses,
} from "@/lib/student-access";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Search — Study Hub" };

type SearchHit = {
  id: string;
  title: string;
  courseTitle: string;
};

/**
 * Student search (spec section 10 rule 2): finds words in titles and bodies
 * of published notes inside the student's courses only. The course filter is
 * the join-code scope, not a client choice.
 */
export default async function StudentSearchPage({
  searchParams,
}: PageProps<"/s/search">) {
  const scope = await requireStudentScope();
  const raw = await searchParams;
  const parsed = searchSchema.safeParse({
    q: typeof raw.q === "string" ? raw.q : undefined,
  });
  const q = parsed.success ? parsed.data.q : "";

  const courseIds = await getStudentCourseIds(scope);
  const courseTitles = new Map(
    (await getStudentCourses(scope)).map((c) => [c.id, c.title]),
  );

  let hits: SearchHit[] = [];
  if (q && courseIds.length > 0) {
    const admin = createAdminClient();
    const { data: rows } = await admin
      .from("nodes")
      .select("id, title, course_id")
      .eq("status", "published")
      .is("deleted_at", null)
      .in("course_id", courseIds)
      .textSearch("search", q, { type: "websearch" })
      .limit(30);
    hits = (rows ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      courseTitle: courseTitles.get(r.course_id) ?? "",
    }));
  }

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Search</h1>

      <form className="flex gap-2">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search your courses…"
          aria-label="Search"
        />
        <Button type="submit">Search</Button>
      </form>

      {q && hits.length === 0 && (
        <p className="text-muted-foreground text-sm">
          Nothing found for “{q}” in your courses.
        </p>
      )}

      <ul className="grid gap-2">
        {hits.map((h) => (
          <li key={h.id}>
            <Link
              href={`/s/notes/${h.id}`}
              className="block rounded-md border p-3 text-sm"
            >
              <span className="font-medium" dir="auto">
                {h.title}
              </span>
              {h.courseTitle && (
                <span className="text-muted-foreground text-xs">
                  {" "}
                  · {h.courseTitle}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
