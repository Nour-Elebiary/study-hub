import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { contentAreas } from "@/lib/schemas";
import { requireStudentScope } from "@/lib/student-access";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Course — Study Hub" };

const AREA_LABELS: Record<string, string> = Object.fromEntries(
  contentAreas.map((a) => [a, a.replaceAll("_", " ")]),
);

/**
 * One course, read-only (spec section 10 rule 2): published content grouped
 * by area. Only published notes are listed; drafts and other courses are
 * unreachable by construction.
 */
export default async function StudentCoursePage({
  params,
}: PageProps<"/s/courses/[courseId]">) {
  const scope = await requireStudentScope();
  const { courseId } = await params;

  const admin = createAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select("id, code, title, semester")
    .eq("id", courseId)
    .eq("archived", false)
    .single();
  if (!course) notFound();

  // Scope check: the course must be inside the student's join-code scope.
  if (!scope.scope.all && !scope.scope.courseIds.includes(courseId)) {
    notFound();
  }

  const { data: rows } = await admin
    .from("nodes")
    .select("id, kind, title, area, sort_order")
    .eq("course_id", courseId)
    .eq("status", "published")
    // Only nodes with a published version are readable on the student site
    // (/s/notes 404s the rest), so the listing must match that guarantee.
    .not("published_version_id", "is", null)
    .is("deleted_at", null)
    .order("sort_order");

  const nodes = (rows ?? []).map((n) => ({
    id: n.id as string,
    title: n.title as string,
    area: n.area as string,
  }));

  const t = await getTranslations("student.course");

  const byArea = new Map<string, { id: string; title: string }[]>();
  for (const n of nodes) {
    const list = byArea.get(n.area) ?? [];
    list.push({ id: n.id, title: n.title });
    byArea.set(n.area, list);
  }

  return (
    <div className="grid gap-4">
      <div>
        <Link
          href="/s"
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          {t("back")}
        </Link>
        <h1 className="mt-2 text-2xl font-bold" dir="auto">
          {course.title}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {course.code}
          {course.semester ? ` · ${course.semester}` : ""}
        </p>
      </div>

      {/* Spec section 10: each course carries a sharing reminder. */}
      <p
        dir="auto"
        className="text-muted-foreground bg-muted/40 rounded-md border p-3 text-sm"
      >
        {t("reminder")}
      </p>

      <Link
        href={`/s/map/${courseId}`}
        className="text-sm font-medium underline underline-offset-4"
      >
        {t("outline")}
      </Link>

      {nodes.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        contentAreas
          .filter((area) => byArea.has(area))
          .map((area) => (
            <section key={area} className="grid gap-2">
              <h2 className="text-lg font-semibold capitalize">
                {AREA_LABELS[area]}
              </h2>
              <ul className="grid gap-1">
                {(byArea.get(area) ?? []).map((n) => (
                  <li key={n.id}>
                    <Link
                      href={`/s/notes/${n.id}`}
                      className="block rounded-md border p-3 text-sm font-medium"
                    >
                      {n.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
      )}
    </div>
  );
}
