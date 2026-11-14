import { notFound, redirect } from "next/navigation";
import { getMembership } from "@/lib/course-access";
import { requireSession } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * `/courses/[courseId]/map` now points at the newest canvas experience
 * (CANVAS-SPEC D10): it redirects to the course's default map if one is
 * set, otherwise the most recently updated map, otherwise the maps list
 * when the course has no maps yet. The old tree view stays reachable at
 * `/courses/[courseId]/outline` as the accessible alternative
 * (docs/QUESTIONS.md 40).
 */
// Reads session-bound data on every request — blocking route, not prerendered.
export const instant = false;

export default async function MapRedirectPage({
  params,
}: PageProps<"/courses/[courseId]/map">) {
  const session = await requireSession();
  const { courseId } = await params;
  const supabase = await createClient();

  const { data: course } = await supabase
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .single();
  if (!course) notFound();

  const membership = await getMembership(courseId, session.userId);
  const isAdmin = session.profile.global_role === "admin";
  if (!membership && !isAdmin) notFound();

  // Same read as the maps list: the caller's RLS decides, so leaders see
  // unpublished maps here too.
  const { data: canvases } = await supabase
    .from("canvases")
    .select("id, is_default")
    .eq("course_id", courseId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  const defaultCanvas = canvases?.find((canvas) => canvas.is_default);
  const target = defaultCanvas ?? canvases?.[0];
  if (target) redirect(`/courses/${courseId}/canvas/${target.id}`);

  // No maps yet — send the leader to the list where they can make one.
  redirect(`/courses/${courseId}/canvas`);
}
