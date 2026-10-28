import "server-only";
import { notFound } from "next/navigation";
import { requireSession, type Session } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * Gate for every admin page (spec section 9, security rule 4): admin pages
 * are not linked from leader interfaces and return 404 to non-admins —
 * a redirect would confirm the pages exist.
 */
export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (session.profile.global_role !== "admin") {
    notFound();
  }
  return session;
}

/** Gate for pages an admin or a course owner may open (the team matrix). */
export async function requireAdminOrCourseOwner(): Promise<Session> {
  const session = await requireSession();
  if (session.profile.global_role === "admin") {
    return session;
  }
  const supabase = await createClient();
  const { count } = await supabase
    .from("course_members")
    .select("course_id", { count: "exact", head: true })
    .eq("user_id", session.userId)
    .eq("role", "owner");
  if (!count) {
    notFound();
  }
  return session;
}

const RECENT_LOGIN_WINDOW_MS = 10 * 60 * 1000; // spec section 9 rule 1: 10 minutes

export type RecentLoginCheck =
  { ok: true } | { ok: false; needsPassword: true };

/**
 * Sensitive actions (reset password, disable a leader, edit limits) require
 * the admin to confirm their password if they signed in more than 10 minutes
 * ago. Verifying with signInWithPassword also refreshes the session, which
 * updates last_sign_in_at — so one confirmation covers the next 10 minutes.
 */
export async function checkRecentLogin(
  password?: string,
): Promise<RecentLoginCheck> {
  const session = await requireSession();
  if (!session) {
    return { ok: false, needsPassword: true };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const lastSignIn = user?.last_sign_in_at
    ? Date.parse(user.last_sign_in_at)
    : 0;

  if (Date.now() - lastSignIn < RECENT_LOGIN_WINDOW_MS) {
    return { ok: true };
  }

  if (!password) {
    return { ok: false, needsPassword: true };
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: session.email,
    password,
  });
  if (error) {
    return { ok: false, needsPassword: true };
  }
  return { ok: true };
}
