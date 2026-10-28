"use server";

import { redirect } from "next/navigation";
import { changePasswordSchema } from "@/lib/schemas";
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

  // must_change_password is cleared by the on_user_password_changed trigger.
  redirect("/");
}
