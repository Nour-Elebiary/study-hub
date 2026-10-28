import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AccessManager,
  type JoinCodeRow,
} from "@/app/(leader)/courses/[courseId]/access/access-manager";
import { getMembership } from "@/lib/course-access";
import { requireSession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Student access" };

/**
 * Join-code management for one course (spec section 10 rule 1). Codes live
 * only as hashes in the database, so this screen shows use counts, never
 * the codes themselves.
 */
export default async function AccessPage({
  params,
}: PageProps<"/courses/[courseId]/access">) {
  const session = await requireSession();
  const { courseId } = await params;

  const supabase = await createClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id, code, title")
    .eq("id", courseId)
    .single();
  if (!course) notFound();

  const membership = await getMembership(courseId, session.userId);
  if (!membership && session.profile.global_role !== "admin") notFound();
  const canManage =
    session.profile.global_role === "admin" || membership?.role === "owner";

  // Join codes have no client grants; the service role reads them here.
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("join_codes")
    .select("id, label, uses, max_uses, expires_at, created_at")
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });

  const codes: JoinCodeRow[] = (rows ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    uses: r.uses,
    maxUses: r.max_uses,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  }));

  return (
    <div className="grid gap-4">
      <div>
        <Link
          href={`/courses/${courseId}`}
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          ← {course.title}
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Student access</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Students open the student site, enter a join code once, and see this
          course read-only. They never need an account.
        </p>
      </div>

      <AccessManager courseId={courseId} codes={codes} canManage={canManage} />
    </div>
  );
}
