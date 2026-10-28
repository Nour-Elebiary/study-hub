"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin-actions-guard";
import { checkRecentLogin } from "@/lib/admin-auth";
import { writeAudit } from "@/lib/audit";
import { leaderCreateSchema } from "@/lib/schemas";
import { generateTemporaryPassword } from "@/lib/temp-password";
import { createAdminClient } from "@/lib/supabase/admin";

export type LeaderCredentials = {
  email: string;
  temporaryPassword: string;
};

export type LeaderActionState =
  | { error: string; needsPassword?: boolean }
  | { ok: true; credentials?: LeaderCredentials }
  | null;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function zUuid(value: FormDataEntryValue | null): string | null {
  const v = typeof value === "string" ? value : "";
  return UUID_PATTERN.test(v) ? v : null;
}

/** Guard the two-admins rule before disabling or deleting an admin. */
async function lastAdminGuard(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<string | null> {
  const { data: target } = await admin
    .from("profiles")
    .select("global_role")
    .eq("id", userId)
    .single();
  if (target?.global_role !== "admin") return null;

  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("global_role", "admin")
    .eq("is_active", true)
    .is("deleted_at", null);
  if (count !== null && count <= 1) {
    return "You need at least two admins. Enable another one first.";
  }
  return null;
}

/**
 * Creates a leader account with an already-confirmed email and a temporary
 * password — no email is sent (spec section 9). The password is returned
 * once so the admin can copy a ready-to-send message.
 */
export async function createLeaderAction(
  _prev: LeaderActionState,
  formData: FormData,
): Promise<LeaderActionState> {
  const session = await requireAdminSession();
  if (!session) return { error: "You are not allowed to do this." };

  const recent = await checkRecentLogin(
    (formData.get("confirm_password") as string) || undefined,
  );
  if (!recent.ok) {
    return { error: "", needsPassword: true };
  }

  const parsed = leaderCreateSchema.safeParse({
    display_name: formData.get("display_name"),
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const temporaryPassword = generateTemporaryPassword();
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: {
      display_name: parsed.data.display_name,
      global_role: "leader",
    },
  });

  if (error || !data.user) {
    return {
      error:
        error && error.message.includes("already")
          ? "That email already has an account."
          : "Could not create the account. Try again.",
    };
  }

  await writeAudit({
    actorId: session.userId,
    action: "leader.create",
    entity: "profiles",
    entityId: data.user.id,
    meta: { email: parsed.data.email },
  });

  revalidatePath("/admin/leaders");
  return {
    ok: true,
    credentials: {
      email: parsed.data.email,
      temporaryPassword,
    },
  };
}

/** Disables or re-enables a leader. A disabled leader cannot sign in. */
export async function setLeaderActiveAction(
  _prev: LeaderActionState,
  formData: FormData,
): Promise<LeaderActionState> {
  const session = await requireAdminSession();
  if (!session) return { error: "You are not allowed to do this." };

  const recent = await checkRecentLogin(
    (formData.get("confirm_password") as string) || undefined,
  );
  if (!recent.ok) {
    return { error: "", needsPassword: true };
  }

  const userId = zUuid(formData.get("user_id"));
  const makeActive = formData.get("make_active") === "true";
  if (!userId) return { error: "Missing leader." };

  const admin = createAdminClient();

  if (!makeActive) {
    const guardError = await lastAdminGuard(admin, userId);
    if (guardError) return { error: guardError };
  }

  const { error } = await admin
    .from("profiles")
    .update({ is_active: makeActive })
    .eq("id", userId);

  if (error) {
    return { error: "Could not update the leader. Try again." };
  }

  await writeAudit({
    actorId: session.userId,
    action: makeActive ? "leader.enable" : "leader.disable",
    entity: "profiles",
    entityId: userId,
  });

  revalidatePath("/admin/leaders");
  return { ok: true };
}

/** Creates a new temporary password. The old one stops working immediately. */
export async function resetLeaderPasswordAction(
  _prev: LeaderActionState,
  formData: FormData,
): Promise<LeaderActionState> {
  const session = await requireAdminSession();
  if (!session) return { error: "You are not allowed to do this." };

  const recent = await checkRecentLogin(
    (formData.get("confirm_password") as string) || undefined,
  );
  if (!recent.ok) {
    return { error: "", needsPassword: true };
  }

  const userId = zUuid(formData.get("user_id"));
  if (!userId) return { error: "Missing leader." };

  const temporaryPassword = generateTemporaryPassword();
  const admin = createAdminClient();

  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    password: temporaryPassword,
  });
  if (authError) {
    return { error: "Could not reset the password. Try again." };
  }

  // Force the leader through the change-password screen at next sign-in.
  const { error: profileError } = await admin
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", userId);
  if (profileError) {
    return { error: "Could not reset the password. Try again." };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .single();

  await writeAudit({
    actorId: session.userId,
    action: "leader.reset_password",
    entity: "profiles",
    entityId: userId,
    meta: { display_name: profile?.display_name ?? null },
  });

  revalidatePath("/admin/leaders");
  return {
    ok: true,
    credentials: {
      email: (formData.get("email") as string) || "",
      temporaryPassword,
    },
  };
}

/**
 * Soft-delete: the leader is blocked at sign-in and hidden from the active
 * list, but their rows stay (spec section 9).
 */
export async function softDeleteLeaderAction(
  _prev: LeaderActionState,
  formData: FormData,
): Promise<LeaderActionState> {
  const session = await requireAdminSession();
  if (!session) return { error: "You are not allowed to do this." };

  const recent = await checkRecentLogin(
    (formData.get("confirm_password") as string) || undefined,
  );
  if (!recent.ok) {
    return { error: "", needsPassword: true };
  }

  const userId = zUuid(formData.get("user_id"));
  if (!userId) return { error: "Missing leader." };
  if (userId === session.userId) {
    return { error: "You cannot delete your own account." };
  }

  const admin = createAdminClient();

  const guardError = await lastAdminGuard(admin, userId);
  if (guardError) return { error: guardError };

  const { error } = await admin
    .from("profiles")
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq("id", userId);

  if (error) {
    return { error: "Could not delete the leader. Try again." };
  }

  await writeAudit({
    actorId: session.userId,
    action: "leader.soft_delete",
    entity: "profiles",
    entityId: userId,
  });

  revalidatePath("/admin/leaders");
  return { ok: true };
}
