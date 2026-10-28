"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { requireSession } from "@/lib/dal";
import {
  completeJobSchema,
  CONVERT_TOOL_LABELS,
  createJobSchema,
  JOB_TYPE_LABELS,
  jobIdSchema,
  type JobParams,
} from "@/lib/jobs";
import { slugify } from "@/lib/slug";
import { createClient } from "@/lib/supabase/server";

export type JobActionState = { error: string } | { ok: true } | null;

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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
    runner: "browser",
    input_asset_id: String(formData.get("input_asset_id") ?? ""),
    params: rawParams,
  });
  if (!parsed.success) {
    return firstError(parsed.error.issues[0]?.message ?? "Check the form.");
  }

  const supabase = await createClient();

  const { data: asset } = await supabase
    .from("assets")
    .select("id, course_id, kind, mime, title")
    .eq("id", parsed.data.input_asset_id)
    .maybeSingle();
  if (!asset || asset.course_id !== parsed.data.course_id) notFound();

  // Type-specific eligibility and params (spec section 7 table).
  const params: JobParams = parsed.data.params;
  if (params.type !== parsed.data.type) {
    return firstError("The job options do not match the job type.");
  }
  if (parsed.data.type === "ocr") {
    if (asset.kind !== "image") {
      return firstError("OCR works on image files. Pick a photo or scan.");
    }
  } else if (
    parsed.data.type === "convert" &&
    params.type === "convert" &&
    params.tool === "word_to_markdown"
  ) {
    if (asset.mime !== DOCX_MIME) {
      return firstError("Word to Markdown works on .docx files.");
    }
  } else if (
    parsed.data.type === "convert" &&
    params.type === "convert" &&
    (params.tool === "pdf_merge" || params.tool === "pdf_split")
  ) {
    if (asset.kind !== "pdf") {
      return firstError("PDF tools work on PDF files.");
    }
    if (params.tool === "pdf_merge") {
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
    }
    if (params.tool === "pdf_split" && !params.pages) {
      return firstError("Say which pages to keep, like 1-3,5.");
    }
  } else {
    // transcribe and ai_task arrive with the Home Worker (M6) and Gemini (M7).
    return firstError("That job type is not available yet.");
  }

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      course_id: parsed.data.course_id,
      type: parsed.data.type,
      runner: parsed.data.runner,
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

  const { data: source } = await supabase
    .from("assets")
    .select("id, title, node_id")
    .eq("id", job.input_asset_id)
    .maybeSingle();
  if (!source) notFound();

  // The draft note sits next to the source file when there is one.
  let area = "official_materials";
  let parentId: string | null = null;
  if (source.node_id) {
    const { data: sourceNode } = await supabase
      .from("nodes")
      .select("area, parent_id, deleted_at")
      .eq("id", source.node_id)
      .maybeSingle();
    if (sourceNode && !sourceNode.deleted_at) {
      area = sourceNode.area;
      parentId = sourceNode.parent_id;
    }
  }

  const params = job.params as JobParams;
  const sourceTitle = source.title || "the source file";
  // Convert jobs carry a tool in params; the label comes from the tool, not
  // the generic "convert" type label.
  const tool = params.type === "convert" ? params.tool : undefined;
  const label =
    tool !== undefined
      ? CONVERT_TOOL_LABELS[tool]
      : (JOB_TYPE_LABELS[job.type as keyof typeof JOB_TYPE_LABELS] ?? job.type);

  let title: string;
  let body: string;
  let resultTitle: string;
  if (tool === "pdf_merge" || tool === "pdf_split") {
    title =
      tool === "pdf_merge"
        ? `Merged PDF — ${sourceTitle}`
        : `Split PDF — ${sourceTitle}`;
    body =
      tool === "pdf_merge"
        ? `A combined PDF made from ${
            params.type === "convert" ? (params.asset_ids?.length ?? 0) : 0
          } files. Review it, then publish or delete this note.`
        : `Pages ${
            params.type === "convert" ? (params.pages ?? "") : ""
          } of ${sourceTitle}, saved as a new PDF. Review it, then publish or delete this note.`;
    resultTitle =
      tool === "pdf_merge"
        ? `${sourceTitle} (merged).pdf`
        : `${sourceTitle} (split).pdf`;
  } else {
    const text = parsed.data.text ?? "";
    title = `${label} — ${sourceTitle}`;
    body = `*Source file: ${sourceTitle}.*\n\n${text}`;
    resultTitle = `${sourceTitle} (text).md`;
  }

  let sortOrder = 0;
  if (parentId) {
    const { data: siblings } = await supabase
      .from("nodes")
      .select("sort_order")
      .eq("parent_id", parentId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: false })
      .limit(1);
    sortOrder = (siblings?.[0]?.sort_order ?? -1) + 1;
  }

  const { data: note, error: noteError } = await supabase
    .from("nodes")
    .insert({
      course_id: job.course_id,
      parent_id: parentId,
      area,
      kind: "note",
      title,
      slug: slugify(title),
      sort_order: sortOrder,
      draft_body_md: body,
    })
    .select("id")
    .single();
  if (noteError || !note) {
    return firstError("Could not create the draft note. Try again.");
  }

  // The auto-text tag marks machine-made drafts for human review
  // (spec section 7 rule 2).
  const { data: existingTag } = await supabase
    .from("tags")
    .select("id")
    .eq("name", "auto-text")
    .maybeSingle();
  let tagId = existingTag?.id;
  if (!tagId) {
    const { data: newTag } = await supabase
      .from("tags")
      .insert({ name: "auto-text" })
      .select("id")
      .single();
    tagId = newTag?.id;
  }
  if (tagId) {
    await supabase
      .from("node_tags")
      .insert({ node_id: note.id, tag_id: tagId });
  }

  const kind = parsed.data.mime === "application/pdf" ? "pdf" : "document";
  const { data: resultAsset, error: assetError } = await supabase
    .from("assets")
    .insert({
      course_id: job.course_id,
      node_id: note.id,
      kind,
      storage: "supabase",
      path_or_url: parsed.data.result_path,
      title: resultTitle,
      mime: parsed.data.mime,
      size_bytes: parsed.data.size_bytes,
    })
    .select("id")
    .single();
  if (assetError || !resultAsset) {
    return firstError("Could not register the result file. Try again.");
  }

  const { error: jobError } = await supabase
    .from("jobs")
    .update({
      status: "done",
      result_asset_id: resultAsset.id,
      result_node_id: note.id,
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
      note_id: note.id,
      result_asset_id: resultAsset.id,
    },
  });

  revalidatePath("/jobs");
  revalidatePath(`/courses/${job.course_id}`);
  return { ok: true };
}
