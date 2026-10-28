import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminOrCourseOwner } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Team" };

/**
 * Team matrix entry: pick a course, then manage its members.
 * Admins see every course; a course owner sees only the courses they own
 * (spec section 9: "Team matrix — Admin, course owner (own course)").
 */
export default async function AdminTeamPage() {
  const session = await requireAdminOrCourseOwner();
  const supabase = await createClient();
  const isAdmin = session.profile.global_role === "admin";

  let query = supabase
    .from("courses")
    .select("id, code, title, archived, course_members(count)")
    .order("code");

  if (!isAdmin) {
    // RLS already limits the leader to member courses; filter to owned ones.
    query = query.eq("course_members.role", "owner");
  }

  const { data: courses } = await query;

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-bold">Team</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {isAdmin
            ? "Pick a course to set who works on it, their role and their areas."
            : "Pick one of your courses to manage its team."}
        </p>
      </div>

      <div className="grid gap-3">
        {(courses ?? []).map((course) => {
          const memberCount =
            (
              course.course_members as unknown as { count: number }[] | null
            )?.[0]?.count ?? 0;
          return (
            <Link key={course.id} href={`/admin/team/${course.id}`}>
              <Card className="hover:bg-muted/40 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base">{course.title}</CardTitle>
                    <Badge variant="secondary">{course.code}</Badge>
                    {course.archived && (
                      <Badge variant="outline">archived</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground text-sm">
                    {memberCount} member{memberCount === 1 ? "" : "s"}
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
        {(courses ?? []).length === 0 && (
          <Card>
            <CardContent className="text-muted-foreground pt-6 text-sm">
              No courses to show yet.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
