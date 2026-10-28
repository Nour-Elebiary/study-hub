import { FirstRunTour } from "@/app/(leader)/first-run-tour";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireSession } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * Leader home (M0 placeholder). The three real lists — assigned to me,
 * waiting for my review, changed since my last visit — arrive with the
 * content tree in M2 (spec section 6).
 */
export default async function LeaderHomePage() {
  const session = await requireSession();
  const supabase = await createClient();
  const { data: courses } = await supabase
    .from("courses")
    .select("code, title")
    .order("code");

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">
        Welcome, {session.profile.display_name}
      </h1>

      {!session.profile.tour_done && <FirstRunTour />}

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
              <p key={course.code} className="text-sm">
                <span className="font-medium">{course.title}</span>{" "}
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What&apos;s next</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground grid gap-1 text-sm">
          <p>• Notes, reviews and jobs arrive in the next milestones.</p>
          <p>• You can add your own AI key later from the AI tab.</p>{" "}
        </CardContent>
      </Card>
    </div>
  );
}
