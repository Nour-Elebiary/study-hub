import { randomStoragePath } from "@/lib/file-allowlist";
import {
  jobParamsSchema,
  jobResultNaming,
  workerClaimSchema,
  type JobType,
} from "@/lib/jobs";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWorkerToken } from "@/lib/worker-auth";

/**
 * POST /api/worker/claim (spec section 7 rule 5). The Home Worker calls this
 * every 10 seconds with its WORKER_TOKEN. The database hands out at most one
 * queued job atomically (FOR UPDATE SKIP LOCKED), so two workers can never
 * take the same job. The response carries a signed URL to download the input
 * and a signed URL to upload the result — the worker never sees a Supabase
 * key. The claim doubles as the worker's heartbeat.
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
  const parsed = workerClaimSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: claimed, error } = await admin.rpc("claim_worker_job", {
    worker_name: parsed.data.worker_name,
  });
  if (error) {
    return Response.json({ error: "claim failed" }, { status: 500 });
  }
  const job = (claimed as Array<Record<string, unknown>>)?.[0];
  if (!job) {
    return Response.json({ job: null });
  }

  const params = jobParamsSchema.safeParse(job.params);
  if (!params.success || params.data.type !== job.job_type) {
    // A job with unusable params should never have been queued; park it as
    // failed so it cannot wedge the queue.
    await admin
      .from("jobs")
      .update({
        status: "failed",
        error: "The job's options are invalid.",
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.job_id as string);
    return Response.json({ job: null });
  }

  // A signed URL to download the input (one hour is plenty for one file).
  const { data: download, error: downloadError } = await admin.storage
    .from("assets")
    .createSignedUrl(job.input_path as string, 3600);
  if (downloadError || !download) {
    return Response.json({ error: "signing failed" }, { status: 500 });
  }

  // The result file's name and folder come from the job itself, so the
  // worker cannot write outside its course.
  const { data: source } = await admin
    .from("assets")
    .select("title")
    .eq("id", job.input_asset_id as string)
    .maybeSingle();
  const sourceTitle = source?.title || "file";
  const naming = jobResultNaming(
    job.job_type as JobType,
    params.data,
    sourceTitle,
  );
  const resultPath = randomStoragePath(
    job.course_id as string,
    naming.resultTitle,
  );
  const { data: upload, error: uploadError } = await admin.storage
    .from("assets")
    .createSignedUploadUrl(resultPath);
  if (uploadError || !upload) {
    return Response.json({ error: "signing failed" }, { status: 500 });
  }

  return Response.json({
    job: {
      id: job.job_id,
      course_id: job.course_id,
      type: job.job_type,
      params: params.data,
      attempts: job.attempts,
    },
    download_url: download.signedUrl,
    upload_url: upload.signedUrl,
    upload_path: resultPath,
  });
}
