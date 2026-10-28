import Link from "next/link";
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
    .select("id, code, title, semester")
    .order("code");

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Courses</h1>
      <p className="text-muted-foreground text-sm">
        Open a course to see its content tree — areas, sections and notes.
      </p>
      {courses && courses.length > 0 ? (
        <div className="grid gap-3">
          {courses.map((course) => (
            <Card key={course.id}>
              <CardHeader>
                <Link
                  href={`/courses/${course.id}`}
                  className="hover:underline"
                >
                  <CardTitle className="text-base">{course.title}</CardTitle>
                </Link>
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
