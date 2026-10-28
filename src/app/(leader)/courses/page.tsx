import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireSession } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

export default async function CoursesPage() {
  await requireSession();
  const supabase = await createClient();
  const { data: courses } = await supabase
    .from("courses")
    .select("code, title, semester")
    .order("code");

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Courses</h1>
      <p className="text-muted-foreground text-sm">
        Courses you are a member of. The content tree arrives in milestone M2.
      </p>
      {courses && courses.length > 0 ? (
        <div className="grid gap-3">
          {courses.map((course) => (
            <Card key={course.code}>
              <CardHeader>
                <CardTitle className="text-base">{course.title}</CardTitle>
                <CardDescription>
                  {course.semester ? `${course.semester} · ` : ""}
                  {course.code}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="text-muted-foreground pt-6 text-sm">
            You are not a member of any course yet. Ask your administrator to
            add you.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
