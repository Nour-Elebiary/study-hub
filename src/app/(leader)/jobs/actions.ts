"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { requireSession } from "@/lib/dal";
import { fileJobResult } from "@/lib/job-results";
import {
  completeJobSchema,
  createJobSchema,
  DOCX_MIME,
  jobIdSchema,
  PPTX_MIME,
  runnerForJob,
} from "@/lib/jobs";
import { createClient } from "@/lib/supabase/server";

export type JobActionState = { error: string } | { ok: true } | null;

function firstError(message: string): { error: string } {
  return { error: message };
}

/**
 * Starts a processing job (spec section 7): one row in jobs, status queued.
 * The leader's own browser picks it up on the Jobs screen. RLS enforces who
 * may insert (admin, owner, editor, contributor); this action validates the
 * asset actually belongs to the course and matches the job type.
 */
export async function createJobAction(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const session = await requireSession();

  let rawParams: unknown;
  try {
    rawParams = JSON.parse(String(formData.get("params") ?? "{}"));
  } catch {
    return firstError("Check the job options.");
  }
  const parsed = createJobSchema.safeParse({
    course_id: String(formData.get("course_id") ?? ""),
    type: String(formData.get("type") ?? ""),
    input_asset_id: String(formData.get("input_asset_id") ?? ""),
    params: rawParams,
  });
  if (!parsed.success) {
    return firstError(parsed.error.issues[0]?.message ?? "Check the form.");
  }

  const supabase = await createClient();

  const { data: asset } = await supabase
    .from("assets")
    .select("id, course_id, kind, mime, storage")
    .eq("id", parsed.data.input_asset_id)
    .maybeSingle();
  if (!asset || asset.course_id !== parsed.data.course_id) notFound();

  // Type-specific eligibility (spec section 7 table). The runner is derived
  // from the job, never chosen by the leader: light work in the browser,
  // heavy work on the Home Worker.
  const params = parsed.data.params;
  const runner = runnerForJob(parsed.data.type, params);
  if (params.type !== parsed.data.type) {
    return firstError("The job options do not match the job type.");
  }
  if (params.type === "ocr") {
    if (params.source === "pdf_scan") {
      if (asset.kind !== "pdf") {
        return firstError("Scanned-PDF OCR works on PDF files.");
      }
    } else if (asset.kind !== "image") {
      return firstError("OCR works on image files. Pick a photo or scan.");
    }
  } else if (params.type === "convert") {
    switch (params.tool) {
      case "word_to_markdown":
        if (asset.mime !== DOCX_MIME) {
          return firstError("Word to Markdown works on .docx files.");
        }
        break;
      case "pdf_merge": {
        if (asset.kind !== "pdf") {
          return firstError("PDF tools work on PDF files.");
        }
        if (!params.asset_ids || params.asset_ids.length < 2) {
          return firstError("Pick at least two PDFs to merge.");
        }
        const { data: inputs } = await supabase
          .from("assets")
          .select("id, course_id, kind")
          .in("id", params.asset_ids);
        if (
          !inputs ||
          inputs.length !== params.asset_ids.length ||
          inputs.some(
            (a) => a.course_id !== parsed.data.course_id || a.kind !== "pdf",
          )
        ) {
          return firstError("All PDFs to merge must be in this course.");
        }
        break;
      }
      case "pdf_split":
        if (asset.kind !== "pdf") {
          return firstError("PDF tools work on PDF files.");
        }
        if (!params.pages) {
          return firstError("Say which pages to keep, like 1-3,5.");
        }
        break;
      case "office_to_pdf":
        if (asset.mime !== DOCX_MIME && asset.mime !== PPTX_MIME) {
          return firstError("This tool works on .docx and .pptx files.");
        }
        break;
      case "video_to_audio":
      case "compress_video":
        if (asset.kind !== "video") {
          return firstError("Video tools work on video files.");
        }
        break;
    }
  } else if (params.type === "transcribe") {
    if (asset.kind !== "audio" && asset.kind !== "video") {
      return firstError("Transcription works on audio and video files.");
    }
  } else {
    // ai_task arrives with the AI assistant (M7).
    return firstError("That job type is not available yet.");
  }
  // Heavy jobs run on the leader's own PC, which fetches the file through a
  // signed URL — a Drive link has nothing to hand over.
  if (runner === "worker" && asset.storage !== "supabase") {
    return firstError(
      "This job needs the file stored in Study Hub, not a Drive link.",
    );
  }

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      course_id: parsed.data.course_id,
      type: parsed.data.type,
      runner,
      input_asset_id: parsed.data.input_asset_id,
      params,
    })
    .select("id")
    .single();
  if (error || !job) {
    return firstError(
      "Could not start the job. Check that you may upload in this course.",
    );
  }

  await writeAudit({
    actorId: session.userId,
    action: "job.create",
    entity: "jobs",
    entityId: job.id,
    meta: {
      course_id: parsed.data.course_id,
      type: parsed.data.type,
      input_asset_id: parsed.data.input_asset_id,
    },
  });

  revalidatePath("/jobs");
  return { ok: true };
}

/**
 * The leader cancels a waiting or running job (spec section 7 rule 1).
 * Cancelling is an update to failed — there is no delete, the history stays.
 */
export async function cancelJobAction(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const session = await requireSession();
  const parsed = jobIdSchema.safeParse({
    job_id: String(formData.get("job_id") ?? ""),
  });
  if (!parsed.success) return firstError("Check the form.");

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, course_id, status, created_by")
    .eq("id", parsed.data.job_id)
    .maybeSingle();
  if (!job) notFound();
  if (
    job.created_by !== session.userId &&
    session.profile.global_role !== "admin"
  ) {
    notFound();
  }
  if (job.status !== "queued" && job.status !== "running") {
    return firstError("Only a waiting or running job can be cancelled.");
  }

  const { error } = await supabase
    .from("jobs")
    .update({
      status: "failed",
      error: "Cancelled",
      finished_at: new Date().toISOString(),
    })
    .eq("id", job.id);
  if (error) return firstError("Could not cancel the job. Try again.");

  await writeAudit({
    actorId: session.userId,
    action: "job.cancel",
    entity: "jobs",
    entityId: job.id,
    meta: { course_id: job.course_id },
  });

  revalidatePath("/jobs");
  return { ok: true };
}

/** Puts a failed job back in the queue from the beginning. */
export async function retryJobAction(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const session = await requireSession();
  const parsed = jobIdSchema.safeParse({
    job_id: String(formData.get("job_id") ?? ""),
  });
  if (!parsed.success) return firstError("Check the form.");

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, course_id, status, created_by")
    .eq("id", parsed.data.job_id)
    .maybeSingle();
  if (!job) notFound();
  if (
    job.created_by !== session.userId &&
    session.profile.global_role !== "admin"
  ) {
    notFound();
  }
  if (job.status !== "failed") {
    return firstError("Only a failed job can be retried.");
  }

  const { error } = await supabase
    .from("jobs")
    .update({
      status: "queued",
      attempts: 0,
      run_after: new Date().toISOString(),
      error: null,
      finished_at: null,
    })
    .eq("id", job.id);
  if (error) return firstError("Could not retry the job. Try again.");

  revalidatePath("/jobs");
  return { ok: true };
}

/**
 * Called by the browser runner when the work is finished (spec section 7
 * rule 2): the result becomes a new asset plus a DRAFT note tagged
 * auto-text, and the source file is never touched. The runner has already
 * uploaded the result file to Storage under the course's own folder.
 */
export async function completeJobAction(
  _prev: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const session = await requireSession();
  const parsed = completeJobSchema.safeParse({
    job_id: String(formData.get("job_id") ?? ""),
    result_path: String(formData.get("result_path") ?? ""),
    mime: String(formData.get("mime") ?? ""),
    size_bytes: Number(formData.get("size_bytes") ?? 0),
    text: formData.get("text") ? String(formData.get("text")) : undefined,
  });
  if (!parsed.success) {
    return firstError(parsed.error.issues[0]?.message ?? "Check the form.");
  }

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, course_id, type, status, runner, params, created_by, input_asset_id",
    )
    .eq("id", parsed.data.job_id)
    .maybeSingle();
  if (!job) notFound();
  if (job.created_by !== session.userId) notFound();
  if (job.status !== "running") {
    return firstError("The job is not running, so its result cannot be saved.");
  }
  if (job.runner !== "browser") {
    return firstError("Only browser jobs are handled here.");
  }
  // The result must live inside the job's course folder in Storage.
  if (!parsed.data.result_path.startsWith(`${job.course_id}/`)) {
    return firstError("The result file must be saved in the course's folder.");
  }

  const filed = await fileJobResult(supabase, job, {
    path: parsed.data.result_path,
    mime: parsed.data.mime,
    sizeBytes: parsed.data.size_bytes,
    text: parsed.data.text,
  });
  if (!filed.ok) {
    return firstError(filed.error);
  }

  const { error: jobError } = await supabase
    .from("jobs")
    .update({
      status: "done",
      result_asset_id: filed.assetId,
      result_node_id: filed.noteId,
      finished_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", job.id);
  if (jobError) {
    return firstError("Could not mark the job as done. Try again.");
  }

  await writeAudit({
    actorId: session.userId,
    action: "job.complete",
    entity: "jobs",
    entityId: job.id,
    meta: {
      course_id: job.course_id,
      type: job.type,
      note_id: filed.noteId,
      result_asset_id: filed.assetId,
    },
  });

  revalidatePath("/jobs");
  revalidatePath(`/courses/${job.course_id}`);
  return { ok: true };
}
