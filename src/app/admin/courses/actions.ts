"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin-actions-guard";
import { checkRecentLogin } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import {
  courseArchiveSchema,
  courseCreateSchema,
  courseRenameSchema,
} from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export type CourseActionState =
  { error: string; needsPassword?: boolean } | { ok: true } | null;

/**
 * Creates a course (admin only — RLS also enforces this at the database).
 * Optionally sets the first owner in the same flow.
 */
export async function createCourseAction(
  _prev: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  const session = await requireAdminSession();
  if (!session) return { error: "You are not allowed to do this." };

  const recent = await checkRecentLogin(
    (formData.get("confirm_password") as string) || undefined,
  );
  if (!recent.ok) {
    return { error: "", needsPassword: true };
  }

  const parsed = courseCreateSchema.safeParse({
    code: formData.get("code"),
    title: formData.get("title"),
    semester: formData.get("semester") || "",
    owner_id: formData.get("owner_id") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const supabase = await createClient();
  const { data: course, error } = await supabase
    .from("courses")
    .insert({
      code: parsed.data.code,
      title: parsed.data.title,
      semester: parsed.data.semester ?? "",
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !course) {
    return {
      error:
        error && error.message.includes("duplicate")
          ? "That course code is already in use."
          : "Could not create the course. Try again.",
    };
  }

  if (parsed.data.owner_id) {
    const { error: memberError } = await supabase
      .from("course_members")
      .insert({
        course_id: course.id,
        user_id: parsed.data.owner_id,
        role: "owner",
        areas: [
          "official_materials",
          "student_notes",
          "quiz_exam_prep",
          "external_resources",
          "glossary",
          "open_questions",
        ],
      });
    if (memberError) {
      // The course exists; the owner can be set from the team matrix.
      return {
        error:
          "The course was created, but the owner could not be set. Set the owner on the Team page.",
      };
    }
  }

  await writeAudit({
    actorId: session.userId,
    action: "course.create",
    entity: "courses",
    entityId: course.id,
    meta: { code: parsed.data.code, title: parsed.data.title },
  });

  revalidatePath("/admin/courses");
  revalidatePath("/courses");
  return { ok: true };
}

export async function renameCourseAction(
  _prev: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  const session = await requireAdminSession();
  if (!session) return { error: "You are not allowed to do this." };

  const recent = await checkRecentLogin(
    (formData.get("confirm_password") as string) || undefined,
  );
  if (!recent.ok) {
    return { error: "", needsPassword: true };
  }

  const parsed = courseRenameSchema.safeParse({
    course_id: formData.get("course_id"),
    title: formData.get("title"),
    semester: formData.get("semester") || "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("courses")
    .update({ title: parsed.data.title, semester: parsed.data.semester ?? "" })
    .eq("id", parsed.data.course_id);

  if (error) {
    return { error: "Could not rename the course. Try again." };
  }

  await writeAudit({
    actorId: session.userId,
    action: "course.rename",
    entity: "courses",
    entityId: parsed.data.course_id,
    meta: { title: parsed.data.title },
  });

  revalidatePath("/admin/courses");
  return { ok: true };
}

/** Archive is the safe "delete": nothing is removed, students stop seeing it. */
export async function archiveCourseAction(
  _prev: CourseActionState,
  formData: FormData,
): Promise<CourseActionState> {
  const session = await requireAdminSession();
  if (!session) return { error: "You are not allowed to do this." };

  const recent = await checkRecentLogin(
    (formData.get("confirm_password") as string) || undefined,
  );
  if (!recent.ok) {
    return { error: "", needsPassword: true };
  }

  const parsed = courseArchiveSchema.safeParse({
    course_id: formData.get("course_id"),
    archived: formData.get("archived") === "true",
  });
  if (!parsed.success) {
    return { error: "Check the form." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("courses")
    .update({ archived: parsed.data.archived })
    .eq("id", parsed.data.course_id);

  if (error) {
    return { error: "Could not update the course. Try again." };
  }

  await writeAudit({
    actorId: session.userId,
    action: parsed.data.archived ? "course.archive" : "course.unarchive",
    entity: "courses",
    entityId: parsed.data.course_id,
  });

  revalidatePath("/admin/courses");
  return { ok: true };
}
