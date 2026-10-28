"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin-actions-guard";
import { writeAudit } from "@/lib/audit";
import { membershipRemoveSchema, membershipSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export type MembershipActionState = { error: string } | { ok: true } | null;

/**
 * Adds or updates one membership (role, areas, optional dates).
 * Permission is enforced by RLS: only an admin or the course owner can
 * write course_members, so the authenticated client is the right caller.
 */
export async function saveMembershipAction(
  _prev: MembershipActionState,
  formData: FormData,
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  if (!session) return { error: "You are not allowed to do this." };

  const areas = formData
    .getAll("areas")
    .filter((v): v is string => typeof v === "string");
  const parsed = membershipSchema.safeParse({
    course_id: formData.get("course_id"),
    user_id: formData.get("user_id"),
    role: formData.get("role"),
    areas,
    valid_from: formData.get("valid_from") || "",
    valid_until: formData.get("valid_until") || "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("course_members").upsert(
    {
      course_id: parsed.data.course_id,
      user_id: parsed.data.user_id,
      role: parsed.data.role,
      areas: parsed.data.areas,
      valid_from: parsed.data.valid_from || null,
      valid_until: parsed.data.valid_until || null,
    },
    { onConflict: "course_id,user_id" },
  );

  if (error) {
    return { error: "Could not save the membership. Try again." };
  }

  await writeAudit({
    actorId: session.userId,
    action: "member.upsert",
    entity: "course_members",
    entityId: parsed.data.user_id,
    meta: {
      course_id: parsed.data.course_id,
      role: parsed.data.role,
      areas: parsed.data.areas,
    },
  });

  revalidatePath("/admin/team");
  return { ok: true };
}

export async function removeMembershipAction(
  _prev: MembershipActionState,
  formData: FormData,
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  if (!session) return { error: "You are not allowed to do this." };

  const parsed = membershipRemoveSchema.safeParse({
    course_id: formData.get("course_id"),
    user_id: formData.get("user_id"),
  });
  if (!parsed.success) {
    return { error: "Check the form." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("course_members")
    .delete()
    .eq("course_id", parsed.data.course_id)
    .eq("user_id", parsed.data.user_id);

  if (error) {
    return { error: "Could not remove the member. Try again." };
  }

  await writeAudit({
    actorId: session.userId,
    action: "member.remove",
    entity: "course_members",
    entityId: parsed.data.user_id,
    meta: { course_id: parsed.data.course_id },
  });

  revalidatePath("/admin/team");
  return { ok: true };
}
