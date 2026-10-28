import type { Metadata } from "next";
import {
  createLeaderFlowHint,
  LeadersList,
} from "@/app/admin/leaders/leaders-list";
import { CreateLeaderForm } from "@/app/admin/leaders/create-leader-form";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Leaders" };

export default async function AdminLeadersPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, global_role, is_active, deleted_at, created_at")
    .order("created_at", { ascending: true });

  const { data: memberships } = await supabase
    .from("course_members")
    .select("user_id, courses(code)")
    .order("user_id");

  // last_sign_in_at lives in auth.users — readable only through the
  // admin API from the server.
  const admin = createAdminClient();
  const { data: usersData } = await admin.auth.admin.listUsers({
    perPage: 500,
  });
  const lastSignInByUser = new Map<string, string>();
  for (const user of usersData?.users ?? []) {
    if (user.last_sign_in_at) {
      lastSignInByUser.set(user.id, user.last_sign_in_at);
    }
  }

  const emailByUser = new Map<string, string>();
  for (const user of usersData?.users ?? []) {
    if (user.email) emailByUser.set(user.id, user.email);
  }

  const coursesByUser = new Map<string, string[]>();
  for (const m of memberships ?? []) {
    const code = (m as unknown as { courses?: { code?: string } }).courses
      ?.code;
    if (!code) continue;
    const list = coursesByUser.get(m.user_id) ?? [];
    list.push(code);
    coursesByUser.set(m.user_id, list);
  }

  const leaders = (profiles ?? []).map((p) => ({
    id: p.id,
    email: emailByUser.get(p.id) ?? "—",
    displayName: p.display_name,
    globalRole: p.global_role,
    isActive: p.is_active,
    deletedAt: p.deleted_at,
    lastSignIn: lastSignInByUser.get(p.id) ?? null,
    courses: coursesByUser.get(p.id) ?? [],
  }));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">Leaders</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {createLeaderFlowHint()}
        </p>
      </div>
      <CreateLeaderForm />
      <LeadersList leaders={leaders} />
    </div>
  );
}
