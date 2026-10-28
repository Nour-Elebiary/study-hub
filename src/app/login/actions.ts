"use server";

import { redirect } from "next/navigation";
import { signInSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error: string } | null;

export async function signInAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      error: "Enter your email and a password of at least 10 characters.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Never log credentials or echo the raw auth error (spec rule 7).
    return { error: "Could not sign you in with that email and password." };
  }

  redirect("/");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
