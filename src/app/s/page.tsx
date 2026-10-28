import type { Metadata } from "next";
import Link from "next/link";
import { requireStudentScope, getStudentCourses } from "@/lib/student-access";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "My courses — Study Hub" };

/**
 * Student Home (spec section 10 rule 2): the course list, upcoming
 * deadlines, and the platform's core pages (calendar, links). Everything
 * here is published content inside the student's join-code scope, read by
 * the server with the scope applied explicitly.
 */
export default async function StudentHomePage() {
  const scope = await requireStudentScope();
  const courses = await getStudentCourses(scope);
  const courseIds = courses.map((c) => c.id);

  const admin = createAdminClient();

  // Upcoming deadlines across the student's courses.
  const { data: deadlineRows } = await admin
    .from("nodes")
    .select("id, title, due_date, course_id")
    .eq("status", "published")
    .is("deleted_at", null)
    .not("due_date", "is", null)
    .gte("due_date", new Date().toISOString().slice(0, 10))
    .in(
      "course_id",
      courseIds.length > 0
        ? courseIds
        : ["00000000-0000-0000-0000-000000000000"],
    )
    .order("due_date")
    .limit(10);

  const courseTitles = new Map(courses.map((c) => [c.id, c.title]));
  const deadlines = (deadlineRows ?? []).map((d) => ({
    id: d.id as string,
    title: d.title as string,
    dueDate: d.due_date as string,
    courseTitle: courseTitles.get(d.course_id as string) ?? "",
  }));

  // Core pages are platform-level (course_id null) — every joined student
  // sees them.
  const { data: corePages } = await admin
    .from("nodes")
    .select("id, title")
    .is("course_id", null)
    .eq("kind", "core")
    .eq("status", "published")
    .is("deleted_at", null)
    .order("sort_order");

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">My courses</h1>
        {courses.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">
            No courses yet. Enter another join code to add a course.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {courses.map((course) => (
              <li key={course.id}>
                <Link
                  href={`/s/courses/${course.id}`}
                  className="block rounded-md border p-3"
                >
                  <p className="font-medium">{course.title}</p>
                  <p className="text-muted-foreground text-xs">
                    {course.code}
                    {course.semester ? ` · ${course.semester}` : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold">Coming up</h2>
        {!deadlines || deadlines.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">
            No deadlines in the next weeks.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {deadlines.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/s/notes/${d.id}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <span className="font-medium">{d.title}</span>
                  <span className="text-muted-foreground text-xs">
                    {d.courseTitle} · {new Date(d.dueDate).toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {corePages && corePages.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold">Useful pages</h2>
          <ul className="mt-3 grid gap-2">
            {corePages.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/s/notes/${p.id}`}
                  className="block rounded-md border p-3 text-sm font-medium"
                >
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
