import Link from "next/link";
import { FirstRunTour } from "@/app/(leader)/first-run-tour";
import {
  ChangedSinceVisit,
  type ChangedNode,
} from "@/app/(leader)/changed-since-visit";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireSession } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Leader home (spec section 6): three lists — assigned to me, waiting for
 * my review, changed since I last opened the course.
 */
export default async function LeaderHomePage() {
  const session = await requireSession();
  const supabase = await createClient();
  const isAdmin = session.profile.global_role === "admin";

  const { data: courses } = await supabase
    .from("courses")
    .select("id, code, title")
    .order("code");

  const courseTitle = new Map((courses ?? []).map((c) => [c.id, c.title]));

  // My memberships decide which review queues I can see (owner or reviewer).
  const { data: memberships } = await supabase
    .from("course_members")
    .select("course_id, role")
    .eq("user_id", session.userId);
  const reviewCourseIds = (memberships ?? [])
    .filter((m) => m.role === "owner" || m.role === "reviewer")
    .map((m) => m.course_id);

  const nodeFields =
    "id, course_id, title, status, due_date, updated_at, courses(title)";

  // 1. Assigned to me.
  const { data: assigned } = await supabase
    .from("nodes")
    .select(nodeFields)
    .eq("assigned_to", session.userId)
    .is("deleted_at", null)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(20);

  // 2. Waiting for my review.
  let reviewQuery = supabase
    .from("nodes")
    .select(nodeFields)
    .eq("status", "in_review")
    .is("deleted_at", null)
    .order("updated_at", { ascending: true })
    .limit(20);
  if (!isAdmin) {
    reviewQuery = reviewQuery.in(
      "course_id",
      reviewCourseIds.length > 0 ? reviewCourseIds : [NIL_UUID],
    );
  }
  const { data: waitingReview } = await reviewQuery;

  // 3. Changed since my last visit (compared in the browser).
  const { data: recent } = await supabase
    .from("nodes")
    .select(nodeFields)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(100);

  const changedNodes: ChangedNode[] = (recent ?? [])
    .filter((n) => n.course_id !== null)
    .map((n) => ({
      courseId: n.course_id as string,
      courseTitle:
        (n as unknown as { courses?: { title?: string } }).courses?.title ??
        courseTitle.get(n.course_id as string) ??
        "A course",
      nodeId: n.id,
      title: n.title,
      updatedAt: n.updated_at,
    }));

  function NodeLink({
    nodeId,
    courseId,
    title,
    extra,
  }: {
    nodeId: string;
    courseId: string | null;
    title: string;
    extra?: string;
  }) {
    return (
      <li className="text-sm">
        <Link
          href={
            courseId
              ? `/courses/${courseId}/nodes/${nodeId}`
              : `/courses/${nodeId}`
          }
          className="underline underline-offset-4"
          dir="auto"
        >
          {title || "Untitled note"}
        </Link>
        {extra && <span className="text-muted-foreground"> — {extra}</span>}
      </li>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <h1 className="text-2xl font-bold lg:col-span-2">
        Welcome, {session.profile.display_name}
      </h1>

      {!session.profile.tour_done && <FirstRunTour />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assigned to me</CardTitle>
          <CardDescription>Notes with your name on them.</CardDescription>
        </CardHeader>
        <CardContent>
          {(assigned ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing is assigned to you right now.
            </p>
          ) : (
            <ul className="grid gap-1">
              {(assigned ?? []).map((n) => (
                <NodeLink
                  key={n.id}
                  nodeId={n.id}
                  courseId={n.course_id}
                  title={n.title}
                  extra={
                    n.due_date
                      ? `due ${n.due_date}`
                      : n.status.replaceAll("_", " ")
                  }
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Waiting for my review</CardTitle>
          <CardDescription>
            Notes sent for review in courses you own or review.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(waitingReview ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing is waiting for your review.
            </p>
          ) : (
            <ul className="grid gap-1">
              {(waitingReview ?? []).map((n) => (
                <NodeLink
                  key={n.id}
                  nodeId={n.id}
                  courseId={n.course_id}
                  title={n.title}
                  extra={
                    (n as unknown as { courses?: { title?: string } }).courses
                      ?.title ?? undefined
                  }
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ChangedSinceVisit nodes={changedNodes} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your courses</CardTitle>
          <CardDescription>
            You are a member of {courses?.length ?? 0} course
            {courses?.length === 1 ? "" : "s"}.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {courses && courses.length > 0 ? (
            courses.map((course) => (
              <p key={course.id} className="text-sm">
                <Link
                  href={`/courses/${course.id}`}
                  className="font-medium underline underline-offset-4"
                >
                  {course.title}
                </Link>{" "}
                <span className="text-muted-foreground">({course.code})</span>
              </p>
            ))
          ) : (
            <p className="text-muted-foreground text-sm">
              No course has you as a member yet. Ask your administrator to add
              you.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
