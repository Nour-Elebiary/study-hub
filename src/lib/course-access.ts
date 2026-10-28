import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ContentArea, CourseRole } from "@/lib/schemas";

export type Membership = {
  role: CourseRole;
  areas: ContentArea[];
};

/**
 * The caller's membership in a course, honouring the optional validity
 * dates (a membership outside its window counts as absent — spec section 4).
 * RLS already limits which rows a leader can read; these helpers mirror the
 * same rules for UI decisions and server actions ("enforced twice").
 */
export async function getMembership(
  courseId: string,
  userId: string,
): Promise<Membership | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("course_members")
    .select("role, areas, valid_from, valid_until")
    .eq("course_id", courseId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return null;

  const today = new Date().toISOString().slice(0, 10);
  if (
    (data.valid_from && data.valid_from > today) ||
    (data.valid_until && data.valid_until < today)
  ) {
    return null;
  }

  return {
    role: data.role as CourseRole,
    areas: (data.areas ?? []) as ContentArea[],
  };
}

/** May this member write content in the given area? (spec section 4) */
export function canWriteArea(
  membership: Membership | null,
  area: ContentArea,
): boolean {
  if (!membership) return false;
  if (membership.role === "owner") return true;
  if (membership.role === "editor" || membership.role === "contributor") {
    return membership.areas.includes(area);
  }
  return false; // reviewer
}

/** May this member review (approve/publish/send back)? */
export function canReview(membership: Membership | null): boolean {
  return (
    membership !== null &&
    (membership.role === "owner" || membership.role === "reviewer")
  );
}
