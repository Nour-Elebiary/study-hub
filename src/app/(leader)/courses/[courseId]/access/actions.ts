"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/dal";
import { getMembership } from "@/lib/course-access";
import { generateJoinCode, hashJoinCode } from "@/lib/join-code";
import { joinCodeCreateSchema } from "@/lib/schemas";
import { writeAudit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";

export type JoinCodeActionState =
  { error: string } | { ok: true; code: string; label: string } | null;

/**
 * Creates a join code for this course (spec section 10 rule 1). Who may:
 * the course owner or an admin (docs/QUESTIONS.md #12). The plaintext code
 * is returned once — only its hash is stored.
 */
export async function createJoinCodeAction(
  _prev: JoinCodeActionState,
  formData: FormData,
): Promise<JoinCodeActionState> {
  const session = await requireSession();
  const courseId = String(formData.get("course_id") ?? "");
  // Codes created here are always course-scoped; the platform-wide kind
  // (course_id null) has no UI yet (docs/QUESTIONS.md #12).
  if (!courseId) notFound();
  const membership = await getMembership(courseId, session.userId);
  if (!membership && session.profile.global_role !== "admin") notFound();
  if (membership && membership.role !== "owner") {
    return { error: "Only the course owner can create join codes." };
  }

  const parsed = joinCodeCreateSchema.safeParse({
    course_id: courseId,
    label: formData.get("label") || "",
    expires_in_days: formData.get("expires_in_days")
      ? Number(formData.get("expires_in_days"))
      : null,
    max_uses: formData.get("max_uses")
      ? Number(formData.get("max_uses"))
      : null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const code = generateJoinCode();
  const expiresAt = parsed.data.expires_in_days
    ? new Date(
        Date.now() + parsed.data.expires_in_days * 24 * 60 * 60 * 1000,
      ).toISOString()
    : null;

  const admin = createAdminClient();
  const { error } = await admin.from("join_codes").insert({
    course_id: courseId || null,
    code_hash: hashJoinCode(code),
    label: parsed.data.label,
    expires_at: expiresAt,
    max_uses: parsed.data.max_uses,
  });
  if (error) {
    return { error: "Could not create the code. Try again." };
  }

  await writeAudit({
    actorId: session.userId,
    action: "join_code.create",
    entity: "join_codes",
    meta: {
      course_id: courseId || null,
      label: parsed.data.label,
      expires_at: expiresAt,
      max_uses: parsed.data.max_uses,
    },
  });

  revalidatePath(`/courses/${courseId}/access`);
  return { ok: true, code, label: parsed.data.label };
}

/** Revokes a code by deleting it (the hash is useless once the row is gone). */
export async function revokeJoinCodeAction(
  _prev: JoinCodeActionState,
  formData: FormData,
): Promise<JoinCodeActionState> {
  const session = await requireSession();
  const courseId = String(formData.get("course_id") ?? "");
  const codeId = String(formData.get("code_id") ?? "");
  const membership = await getMembership(courseId, session.userId);
  if (!membership && session.profile.global_role !== "admin") notFound();
  if (membership && membership.role !== "owner") {
    return { error: "Only the course owner can revoke join codes." };
  }

  const admin = createAdminClient();
  const { data: deleted } = await admin
    .from("join_codes")
    .delete()
    .eq("id", codeId)
    .eq("course_id", courseId)
    .select("id");
  if (!deleted || deleted.length === 0) {
    return { error: "That code was already gone." };
  }

  await writeAudit({
    actorId: session.userId,
    action: "join_code.revoke",
    entity: "join_codes",
    entityId: codeId,
    meta: { course_id: courseId },
  });

  revalidatePath(`/courses/${courseId}/access`);
  return { ok: true, code: "", label: "" };
}
