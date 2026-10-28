"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { getMembership } from "@/lib/course-access";
import { requireSession } from "@/lib/dal";
import { resolveSuggestionSchema, type ContentArea } from "@/lib/schemas";
import { writeAudit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";

export type ResolveSuggestionActionState =
  { error: string } | { ok: true } | null;

/**
 * Marks a student's correction as handled (or reopens it) — spec section 10
 * rule 4: leaders see suggestions and act on them. Who may: an admin, the
 * course owner, or a member whose assigned areas include the note's area —
 * the same visibility the suggestions RLS policy grants for reading.
 * The suggestions table has no client write grants, so the update goes
 * through the service-role client and is audited.
 */
export async function resolveSuggestionAction(
  _prev: ResolveSuggestionActionState,
  formData: FormData,
): Promise<ResolveSuggestionActionState> {
  const session = await requireSession();
  const parsed = resolveSuggestionSchema.safeParse({
    suggestion_id: String(formData.get("suggestion_id") ?? ""),
    resolved: formData.get("resolved") === "true",
  });
  if (!parsed.success) return { error: "Check the form." };

  const admin = createAdminClient();
  const { data: suggestion } = await admin
    .from("suggestions")
    .select("id, note_id, resolved")
    .eq("id", parsed.data.suggestion_id)
    .maybeSingle();
  if (!suggestion) notFound();

  const { data: node } = await admin
    .from("nodes")
    .select("course_id, area, deleted_at")
    .eq("id", suggestion.note_id)
    .maybeSingle();
  if (!node || node.deleted_at) notFound();

  const courseId = node.course_id as string;
  const isAdmin = session.profile.global_role === "admin";
  const membership = await getMembership(courseId, session.userId);
  const allowed =
    isAdmin ||
    Boolean(
      membership &&
      (membership.role === "owner" ||
        membership.areas.includes(node.area as ContentArea)),
    );
  if (!allowed) notFound();

  if (parsed.data.resolved === suggestion.resolved) return { ok: true };

  const { error } = await admin
    .from("suggestions")
    .update({
      resolved: parsed.data.resolved,
      resolved_at: parsed.data.resolved ? new Date().toISOString() : null,
      resolved_by: parsed.data.resolved ? session.userId : null,
    })
    .eq("id", suggestion.id);
  if (error) return { error: "Could not save. Try again." };

  await writeAudit({
    actorId: session.userId,
    action: parsed.data.resolved ? "suggestion.resolve" : "suggestion.reopen",
    entity: "suggestions",
    entityId: suggestion.id,
    meta: { course_id: courseId, note_id: suggestion.note_id },
  });

  revalidatePath(`/courses/${courseId}`);
  return { ok: true };
}
