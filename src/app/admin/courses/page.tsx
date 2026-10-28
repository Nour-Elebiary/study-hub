import type { Metadata } from "next";
import Link from "next/link";
import {
  CourseRowActions,
  CreateCourseForm,
} from "@/app/admin/courses/course-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Courses · Admin" };

export default async function AdminCoursesPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: courses } = await supabase
    .from("courses")
    .select("id, code, title, semester, archived")
    .order("code");

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, global_role, is_active, deleted_at")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("display_name");

  const leaders = (profiles ?? [])
    .filter((p) => p.global_role === "leader" || p.global_role === "admin")
    .map((p) => ({ id: p.id, displayName: p.display_name }));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">Courses</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Deleting is not allowed — archive a course instead, so nothing is ever
          lost by accident.
        </p>
      </div>
      <CreateCourseForm leaders={leaders} />

      <div className="grid gap-3">
        {(courses ?? []).map((course) => (
          <Card key={course.id}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">{course.title}</CardTitle>
                <Badge variant="secondary">{course.code}</Badge>
                {course.archived && <Badge variant="outline">archived</Badge>}
              </div>
              {course.semester && (
                <p className="text-muted-foreground text-sm">
                  {course.semester}
                </p>
              )}
            </CardHeader>
            <CardContent className="grid gap-3">
              <CourseRowActions
                courseId={course.id}
                title={course.title}
                semester={course.semester ?? ""}
                archived={course.archived}
              />
              <Link
                href={`/admin/team/${course.id}`}
                className="text-sm font-medium underline underline-offset-4"
              >
                Manage the team for this course →
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
