import "server-only";
import { getSession, type Session } from "@/lib/dal";

/**
 * Guard for admin Server Actions. Unlike the page gate (requireAdmin, which
 * renders a 404), actions return null so the action can answer with a
 * generic "not allowed" state instead of a navigation error.
 */
export async function requireAdminSession(): Promise<Session | null> {
  const session = await getSession();
  if (!session || session.profile.global_role !== "admin") {
    return null;
  }
  return session;
}
