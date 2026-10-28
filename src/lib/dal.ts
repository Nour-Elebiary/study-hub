import { redirect } from "next/navigation";
import { cache } from "react";
import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  display_name: string;
  global_role: "admin" | "leader";
  must_change_password: boolean;
  is_active: boolean;
  deleted_at: string | null;
  tour_done: boolean;
};

export type Session = {
  userId: string;
  email: string;
  profile: Profile;
};

/** Per-render-pass memoized session lookup (docs: DAL pattern). */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select(
      "id, display_name, global_role, must_change_password, is_active, deleted_at, tour_done",
    )
    .eq("id", user.id)
    .single();
  if (error || !profile) return null;

  return {
    userId: user.id,
    email: user.email ?? "",
    profile: profile as Profile,
  };
});

/**
 * Entry gate for every leader/admin page.
 * Redirects are safe here: each page (not the layout) calls this so every
 * route change re-checks authorization.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  if (!session.profile.is_active || session.profile.deleted_at) {
    // Disabled or soft-deleted account (spec section 9): end the session and
    // show the notice.
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login?disabled=1");
  }
  if (session.profile.must_change_password) {
    redirect("/reset-password");
  }
  return session;
}
