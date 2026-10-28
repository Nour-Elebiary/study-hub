import { requireSession } from "@/lib/dal";
import { WORKER_ONLINE_WINDOW_MS } from "@/lib/jobs";
import { createClient } from "@/lib/supabase/server";
import {
  JobsClient,
  type AssetOption,
  type CourseOption,
  type JobRow,
} from "./jobs-client";

/**
 * Jobs screen (spec section 7): the leader starts light processing jobs and
 * watches them run. Light work happens in the leader's own browser (see
 * job-runner.tsx); heavy work waits for the Home Worker, whose heartbeat is
 * shown as an online/offline badge (spec section 7 rule 5).
 */
export const instant = false;

export const metadata = { title: "Jobs" };

/** A worker is online if it checked in within the window (spec rule 5). */
function isOnline(lastSeenAt: string): boolean {
  return Date.now() - new Date(lastSeenAt).getTime() < WORKER_ONLINE_WINDOW_MS;
}

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

  // Worker heartbeat (spec section 7 rule 5): RLS gives admins the rows and
  // everyone else none, so a non-admin leader gets no badge at all rather
  // than a misleading "offline".
  const { data: heartbeats } = await supabase
    .from("worker_heartbeats")
    .select("id, last_seen_at");
  const workerOnline = (heartbeats ?? []).some((h) => isOnline(h.last_seen_at));

  return (
    <JobsClient
      courses={courseList}
      assets={assetList}
      initialJobs={jobList}
      userId={session.userId}
      isAdmin={session.profile.global_role === "admin"}
      workerOnline={
        session.profile.global_role === "admin" ? workerOnline : null
      }
    />
  );
}
