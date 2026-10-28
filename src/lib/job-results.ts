import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jobParamsSchema, jobResultNaming, type JobType } from "@/lib/jobs";
import { slugify } from "@/lib/slug";

/**
 * Files a finished job's result (spec section 7 rule 2): a DRAFT note next
 * to the source file, tagged auto-text, plus the result asset. Shared by
 * the browser completion action (the leader's own RLS client) and the
 * worker complete endpoint (the service-role client) so both behave
 * identically. The original source file is never touched.
 */

type JobLike = {
  id: string;
  course_id: string;
  type: string;
  params: unknown;
  input_asset_id: string;
};

export type FileResultOutcome =
  { ok: true; noteId: string; assetId: string } | { ok: false; error: string };

export async function fileJobResult(
  supabase: SupabaseClient,
  job: JobLike,
  result: { path: string; mime: string; sizeBytes: number; text?: string },
): Promise<FileResultOutcome> {
  const parsed = jobParamsSchema.safeParse(job.params);
  if (!parsed.success)
    return { ok: false, error: "The job's options are invalid." };
  const params = parsed.data;
  if (params.type !== job.type) {
    return { ok: false, error: "The job's options do not match its type." };
  }

  const { data: source } = await supabase
    .from("assets")
    .select("id, title, node_id")
    .eq("id", job.input_asset_id)
    .maybeSingle();
  if (!source) return { ok: false, error: "The source file is gone." };

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

  const sourceTitle = source.title || "the source file";
  const naming = jobResultNaming(
    job.type as JobType,
    params,
    sourceTitle,
    result.text,
  );

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
      title: naming.title,
      slug: slugify(naming.title),
      sort_order: sortOrder,
      draft_body_md: naming.body,
    })
    .select("id")
    .single();
  if (noteError || !note) {
    return { ok: false, error: "Could not create the draft note. Try again." };
  }

  // The auto-text tag marks machine-made drafts for human review.
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

  const kind =
    result.mime === "application/pdf"
      ? "pdf"
      : result.mime.startsWith("audio/")
        ? "audio"
        : result.mime.startsWith("video/")
          ? "video"
          : "document";
  const { data: resultAsset, error: assetError } = await supabase
    .from("assets")
    .insert({
      course_id: job.course_id,
      node_id: note.id,
      kind,
      storage: "supabase",
      path_or_url: result.path,
      title: naming.resultTitle,
      mime: result.mime,
      size_bytes: result.sizeBytes,
    })
    .select("id")
    .single();
  if (assetError || !resultAsset) {
    return {
      ok: false,
      error: "Could not register the result file. Try again.",
    };
  }

  return { ok: true, noteId: note.id, assetId: resultAsset.id };
}
