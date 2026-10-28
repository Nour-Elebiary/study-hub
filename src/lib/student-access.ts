import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  STUDENT_COOKIE,
  verifyStudentCookie,
  type StudentPayload,
} from "@/lib/student-cookie";

/**
 * Student reads go through the service-role client with the scope from the
 * signed cookie applied explicitly (students have no accounts, so RLS has no
 * identity to check — anon reads nothing, see RLS test 02). Every query here
 * filters to published, non-deleted content inside the allowed courses.
 */
export type StudentCourse = {
  id: string;
  code: string;
  title: string;
  semester: string | null;
};

/** The verified cookie payload, or null when the visitor has not joined. */
export async function getStudentScope(): Promise<StudentPayload | null> {
  const cookieStore = await cookies();
  return verifyStudentCookie(cookieStore.get(STUDENT_COOKIE)?.value);
}

/**
 * Entry gate for every student page except the join page. Redirects are safe
 * here: each page (not the layout) calls this so every navigation re-checks.
 */
export async function requireStudentScope(): Promise<StudentPayload> {
  const scope = await getStudentScope();
  if (!scope) {
    redirect("/s/join");
  }
  return scope;
}

/** The courses this student may see: non-archived and inside their scope. */
export async function getStudentCourses(
  scope: StudentPayload,
): Promise<StudentCourse[]> {
  const admin = createAdminClient();
  let query = admin
    .from("courses")
    .select("id, code, title, semester")
    .eq("archived", false)
    .order("title");
  if (!scope.scope.all) {
    if (scope.scope.courseIds.length === 0) return [];
    query = query.in("id", scope.scope.courseIds);
  }
  const { data } = await query;
  return (data ?? []) as StudentCourse[];
}

/** The course ids the scope currently resolves to (after the archived check). */
export async function getStudentCourseIds(
  scope: StudentPayload,
): Promise<string[]> {
  return (await getStudentCourses(scope)).map((c) => c.id);
}
