import { requireSession } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import {
  JobsClient,
  type AssetOption,
  type CourseOption,
  type JobRow,
} from "./jobs-client";

/**
 * Jobs screen (spec section 7): the leader starts light processing jobs and
 * watches them run. The heavy lifting happens in the leader's own browser
 * (see job-runner.tsx) — the server only stores the queue and the results.
 */
export const instant = false;

export const metadata = { title: "Jobs" };

export default async function JobsPage() {
  const session = await requireSession();
  const supabase = await createClient();

  // RLS decides which courses, assets and jobs this leader may see; the
  // queries below simply ask for everything and let the policies filter.
  const { data: courses } = await supabase
    .from("courses")
    .select("id, code, title")
    .order("code");

  const { data: assets } = await supabase
    .from("assets")
    .select("id, course_id, title, kind, mime")
    .order("created_at", { ascending: false })
    .limit(500);

  const { data: jobs } = await supabase
    .from("jobs")
    .select(
      "id, course_id, type, status, runner, params, error, attempts, run_after, created_by, created_at, finished_at, input_asset_id",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  const courseList: CourseOption[] = (courses ?? []).map((c) => ({
    id: c.id,
    code: c.code,
    title: c.title,
  }));
  const assetList: AssetOption[] = (assets ?? []).map((a) => ({
    id: a.id,
    course_id: a.course_id,
    title: a.title,
    kind: a.kind,
    mime: a.mime,
  }));
  const jobList: JobRow[] = (jobs ?? []).map((j) => ({
    id: j.id,
    course_id: j.course_id,
    type: j.type,
    status: j.status,
    runner: j.runner,
    params: j.params,
    error: j.error,
    attempts: j.attempts,
    run_after: j.run_after,
    created_by: j.created_by,
    created_at: j.created_at,
    finished_at: j.finished_at,
    input_asset_id: j.input_asset_id,
  }));

  return (
    <JobsClient
      courses={courseList}
      assets={assetList}
      initialJobs={jobList}
      userId={session.userId}
      isAdmin={session.profile.global_role === "admin"}
    />
  );
}
