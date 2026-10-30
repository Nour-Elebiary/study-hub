"use server";

import { redirect } from "next/navigation";
import { changePasswordSchema } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ChangePasswordState = { error: string } | null;

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const parsed = changePasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });

  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "Use a password of at least 10 characters.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    return { error: "Could not set your new password. Try again." };
  }

  // Clear the first-sign-in gate here, after GoTrue confirmed the password
  // change. (The old database trigger did this, but it also fired when
  // Supabase rewrote the hash format during sign-in — see migration 00017.)
  // The service-role client is needed because profiles has no UPDATE grant
  // for `authenticated`; the user id comes from the verified session.
  const admin = createAdminClient();
  const { error: profileError } = await admin
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", user.id);

  if (profileError) {
    // The password is already changed; a retry through this form clears the
    // flag, so ask the user to try again rather than leaving them stuck.
    return {
      error: "The password was set, but something went wrong. Try again.",
    };
  }

  redirect("/");
}
