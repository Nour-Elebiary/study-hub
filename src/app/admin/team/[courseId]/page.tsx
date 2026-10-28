import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AddMemberForm,
  MemberEditor,
  type MemberRow,
} from "@/app/admin/team/member-editor";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminOrCourseOwner } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Course team" };

/**
 * One course's team: the grid row of the team matrix, mobile-first.
 * Admins open any course; a course owner only their own (404 otherwise).
 */
export default async function CourseTeamPage({
  params,
}: PageProps<"/admin/team/[courseId]">) {
  const session = await requireAdminOrCourseOwner();
  const { courseId } = await params;
  const supabase = await createClient();
  const isAdmin = session.profile.global_role === "admin";

  const { data: course } = await supabase
    .from("courses")
    .select("id, code, title")
    .eq("id", courseId)
    .single();
  if (!course) notFound();

  if (!isAdmin) {
    // A course owner may manage only their own course.
    const { data: own } = await supabase
      .from("course_members")
      .select("course_id")
      .eq("course_id", courseId)
      .eq("user_id", session.userId)
      .eq("role", "owner")
      .maybeSingle();
    if (!own) notFound();
  }

  const { data: members } = await supabase
    .from("course_members")
    .select("user_id, role, areas, valid_from, valid_until")
    .eq("course_id", courseId)
    .order("user_id");

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("display_name");

  const nameByUser = new Map(
    (profiles ?? []).map((p) => [p.id, p.display_name]),
  );

  const memberRows: MemberRow[] = (members ?? [])
    .filter((m) => nameByUser.has(m.user_id))
    .map((m) => ({
      userId: m.user_id,
      displayName: nameByUser.get(m.user_id) ?? "—",
      role: m.role,
      areas: m.areas ?? [],
      validFrom: m.valid_from,
      validUntil: m.valid_until,
    }));

  const memberIds = new Set(memberRows.map((m) => m.userId));
  const candidates = (profiles ?? [])
    .filter((p) => !memberIds.has(p.id))
    .map((p) => ({ id: p.id, displayName: p.display_name }));

  return (
    <div className="grid gap-4">
      <div>
        <Link
          href="/admin/team"
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          ← All courses
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 text-2xl font-bold">
          {course.title}
          <Badge variant="secondary">{course.code}</Badge>
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          An owner has every area and manages the team. Editors and contributors
          work only in the areas you tick.
        </p>
      </div>

      <div className="grid gap-3">
        {memberRows.map((member) => (
          <MemberEditor
            key={member.userId}
            courseId={course.id}
            member={member}
          />
        ))}
        {memberRows.length === 0 && (
          <Card>
            <CardContent className="text-muted-foreground pt-6 text-sm">
              No members yet. Add the first leader below.
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Add a leader</CardTitle>
        </CardHeader>
        <CardContent>
          <AddMemberForm courseId={course.id} candidates={candidates} />
        </CardContent>
      </Card>
    </div>
  );
}
