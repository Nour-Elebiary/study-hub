"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { joinCodeInputSchema, suggestionSchema } from "@/lib/schemas";
import { hashJoinCode } from "@/lib/join-code";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  STUDENT_COOKIE,
  signStudentCookie,
  studentCookieOptions,
  verifyStudentCookie,
} from "@/lib/student-cookie";
import { requireStudentScope, getStudentCourseIds } from "@/lib/student-access";
import { createAdminClient } from "@/lib/supabase/admin";

export type JoinActionState = { error: string } | null;

const GENERIC_ERROR =
  "That code is not valid, or it has expired. Ask your teacher for a new one.";

/**
 * The join flow (spec section 10 rule 1): check the code against its hash,
 * honour expiry and use limits, then set the signed 90-day cookie carrying
 * the allowed course scope. Joining again with another code adds that course
 * to the existing scope. Join attempts are limited to 5 per minute per IP.
 */
export async function joinAction(
  _prev: JoinActionState,
  formData: FormData,
): Promise<JoinActionState> {
  const parsed = joinCodeInputSchema.safeParse(formData.get("code"));
  if (!parsed.success) return { error: GENERIC_ERROR };

  const ip = getClientIp(await headers());
  if (!(await checkRateLimit("join", ip))) {
    return {
      error: "Too many tries. Wait a minute and try the code again.",
    };
  }

  const admin = createAdminClient();
  const { data: codes } = await admin
    .from("join_codes")
    .select("id, course_id, expires_at, max_uses, uses")
    .eq("code_hash", hashJoinCode(parsed.data))
    .limit(1);
  const code = codes?.[0];
  if (!code) return { error: GENERIC_ERROR };

  if (code.expires_at && new Date(code.expires_at) <= new Date()) {
    return { error: GENERIC_ERROR };
  }
  if (code.max_uses !== null && code.uses >= code.max_uses) {
    return { error: GENERIC_ERROR };
  }

  // A course-scoped code must point at a course that still exists and is
  // open (not archived). The platform-wide code (course_id null) has no
  // course to check.
  if (code.course_id) {
    const { data: course } = await admin
      .from("courses")
      .select("archived")
      .eq("id", code.course_id)
      .single();
    if (!course || course.archived) return { error: GENERIC_ERROR };
  }

  // Count the use atomically: only bump when uses is still what we read.
  // (Class-scale concurrency; one retry covers the rare race.)
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: bumped, error } = await admin
      .from("join_codes")
      .update({ uses: code.uses + 1 })
      .eq("id", code.id)
      .eq("uses", code.uses)
      .select("id");
    if (!error && bumped && bumped.length === 1) break;
    if (attempt === 1) return { error: GENERIC_ERROR };
  }

  // Merge into the existing scope (a student in two courses joins twice).
  const cookieStore = await cookies();
  const existing = verifyStudentCookie(cookieStore.get(STUDENT_COOKIE)?.value);
  const scope = mergeScope(existing, code.course_id);

  cookieStore.set(
    STUDENT_COOKIE,
    signStudentCookie(scope),
    studentCookieOptions(),
  );
  redirect("/s");
}

function mergeScope(
  existing: ReturnType<typeof verifyStudentCookie>,
  courseId: string | null,
): {
  v: 1;
  iat: number;
  scope: { all: true } | { all: false; courseIds: string[] };
} {
  if (courseId === null) {
    // A platform-wide code unlocks everything.
    return { v: 1, iat: Date.now(), scope: { all: true } };
  }
  if (existing && existing.scope.all) {
    // Already unlocked everywhere; a course code changes nothing.
    return { v: 1, iat: Date.now(), scope: { all: true } };
  }
  const existingIds =
    existing && existing.scope.all === false ? existing.scope.courseIds : [];
  if (existingIds.length < 200) {
    const courseIds = Array.from(new Set([...existingIds, courseId]));
    return { v: 1, iat: Date.now(), scope: { all: false, courseIds } };
  }
  return {
    v: 1,
    iat: Date.now(),
    scope: { all: false, courseIds: existingIds },
  };
}

export type SuggestActionState = { error: string } | { ok: true } | null;

/**
 * "Suggest a correction" (spec section 10 rule 4): inserts an anonymous
 * suggestion on a published note the student can see. No personal data is
 * stored — the rate limiter keeps only a salted hash of the IP. Limited to
 * 3 per hour per IP.
 */
export async function suggestCorrectionAction(
  nodeId: string,
  _prev: SuggestActionState,
  formData: FormData,
): Promise<SuggestActionState> {
  const scope = await requireStudentScope();

  const parsed = suggestionSchema.safeParse({
    note_id: nodeId,
    text: formData.get("text"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the text." };
  }

  if (!(await checkRateLimit("suggest", getClientIp(await headers())))) {
    return {
      error: "You have sent several corrections recently. Try again later.",
    };
  }

  // The note must be published and inside the student's scope.
  const admin = createAdminClient();
  const { data: node } = await admin
    .from("nodes")
    .select("id, course_id, status, deleted_at")
    .eq("id", parsed.data.note_id)
    .single();
  if (!node || node.deleted_at || node.status !== "published") {
    return { error: "This note is not available." };
  }
  if (node.course_id) {
    const courseIds = await getStudentCourseIds(scope);
    if (!courseIds.includes(node.course_id)) {
      return { error: "This note is not available." };
    }
  }

  const { error } = await admin.from("suggestions").insert({
    note_id: parsed.data.note_id,
    text: parsed.data.text,
  });
  if (error) {
    return { error: "Could not send the correction. Try again." };
  }

  return { ok: true };
}
