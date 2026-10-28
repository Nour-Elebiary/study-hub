import { writeAudit } from "@/lib/audit";
import { fileJobResult } from "@/lib/job-results";
import {
  MAX_JOB_ATTEMPTS,
  retryDelaySeconds,
  workerCompleteSchema,
} from "@/lib/jobs";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWorkerToken } from "@/lib/worker-auth";

/**
 * POST /api/worker/complete (spec section 7 rules 1 and 5). The Home Worker
 * reports a finished job here with its WORKER_TOKEN. A success files the
 * result as a draft note plus asset; a failure requeues the job (up to 3
 * tries with a growing delay) or marks it failed. The worker never talks to
 * the database or Storage directly.
 */
export async function POST(request: Request) {
  if (!verifyWorkerToken(request.headers.get("authorization"))) {
    return Response.json({ error: "not authorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const parsed = workerCompleteSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const report = parsed.data;

  const admin = createAdminClient();
  const { data: job } = await admin
    .from("jobs")
    .select(
      "id, course_id, type, status, runner, params, created_by, input_asset_id, claimed_by, attempts",
    )
    .eq("id", report.job_id)
    .maybeSingle();
  if (!job) {
    return Response.json({ error: "job not found" }, { status: 404 });
  }
  if (job.status !== "running" || job.runner !== "worker") {
    // Already completed, cancelled, or never a worker job: the report is
    // stale, not an error the worker should retry.
    return Response.json({ ok: true, ignored: true });
  }

  // ---- failure: retry with a growing delay, then fail for good ------------
  if (!report.ok) {
    const attempts = job.attempts + 1;
    const message = report.error || "The worker could not finish the job.";
    const giveUp = attempts >= MAX_JOB_ATTEMPTS;
    const { error } = await admin
      .from("jobs")
      .update({
        status: giveUp ? "failed" : "queued",
        attempts,
        error: message,
        run_after: giveUp
          ? null
          : new Date(Date.now() + retryDelaySeconds(attempts) * 1000),
        finished_at: giveUp ? new Date().toISOString() : null,
      })
      .eq("id", job.id);
    if (error) {
      return Response.json({ error: "update failed" }, { status: 500 });
    }
    await writeAudit({
      actorId: job.created_by,
      action: "job.fail",
      entity: "jobs",
      entityId: job.id,
      meta: {
        course_id: job.course_id,
        type: job.type,
        worker: job.claimed_by,
        attempt: attempts,
        reason: message,
      },
    });
    return Response.json({ ok: true, requeued: !giveUp });
  }

  // ---- success: the file must land inside the job's course folder ---------
  if (!report.result_path || !report.mime || !report.size_bytes) {
    return Response.json(
      { error: "a successful report needs result_path, mime and size_bytes" },
      { status: 400 },
    );
  }
  if (!report.result_path.startsWith(`${job.course_id}/`)) {
    return Response.json(
      { error: "the result file must be saved in the course's folder" },
      { status: 400 },
    );
  }

  const filed = await fileJobResult(admin, job, {
    path: report.result_path,
    mime: report.mime,
    sizeBytes: report.size_bytes,
    text: report.text,
  });
  if (!filed.ok) {
    // The upload itself succeeded, so the file exists; filing it failed.
    // Requeue like any other failure rather than losing the job silently.
    const attempts = job.attempts + 1;
    const giveUp = attempts >= MAX_JOB_ATTEMPTS;
    await admin
      .from("jobs")
      .update({
        status: giveUp ? "failed" : "queued",
        attempts,
        error: filed.error,
        run_after: giveUp
          ? null
          : new Date(Date.now() + retryDelaySeconds(attempts) * 1000),
        finished_at: giveUp ? new Date().toISOString() : null,
      })
      .eq("id", job.id);
    await writeAudit({
      actorId: job.created_by,
      action: "job.fail",
      entity: "jobs",
      entityId: job.id,
      meta: {
        course_id: job.course_id,
        type: job.type,
        worker: job.claimed_by,
        attempt: attempts,
        reason: filed.error,
      },
    });
    return Response.json({ ok: true, filed: false });
  }

  const { error } = await admin
    .from("jobs")
    .update({
      status: "done",
      result_asset_id: filed.assetId,
      result_node_id: filed.noteId,
      finished_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", job.id);
  if (error) {
    return Response.json({ error: "update failed" }, { status: 500 });
  }

  await writeAudit({
    actorId: job.created_by,
    action: "job.complete",
    entity: "jobs",
    entityId: job.id,
    meta: {
      course_id: job.course_id,
      type: job.type,
      note_id: filed.noteId,
      result_asset_id: filed.assetId,
      worker: job.claimed_by,
    },
  });
  return Response.json({ ok: true, filed: true });
}
