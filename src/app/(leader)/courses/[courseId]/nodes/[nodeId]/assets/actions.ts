"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { getMembership } from "@/lib/course-access";
import { requireSession } from "@/lib/dal";
import { mimeForFileName } from "@/lib/file-allowlist";
import {
  addLinkAssetSchema,
  deleteAssetSchema,
  registerUploadSchema,
  replaceAssetSchema,
  updateAssetSchema,
} from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export type AssetActionState = { error: string } | { ok: true } | null;

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form.";
}

/**
 * Who may touch files at all: admins, owners, editors and contributors.
 * Reviewers read files but never upload (spec section 4). The database
 * policies enforce this again.
 */
async function assertCanManageAssets(courseId: string): Promise<string | null> {
  const session = await requireSession();
  if (session.profile.global_role === "admin") return null;
  const membership = await getMembership(courseId, session.userId);
  if (
    membership &&
    (membership.role === "owner" ||
      membership.role === "editor" ||
      membership.role === "contributor")
  ) {
    return null;
  }
  return "You do not have permission to manage files in this course.";
}

/**
 * Server-side re-check of the upload rules (spec section 11 rule 4): the
 * stored path must sit under the course folder and its extension must match
 * the claimed type. The browser already checked; this is the second gate.
 */
function checkStoragePath(
  courseId: string,
  pathOrUrl: string,
  mime: string,
): string | null {
  if (!pathOrUrl.startsWith(`${courseId}/`)) {
    return "The file path is not valid for this course.";
  }
  if (mimeForFileName(pathOrUrl) !== mime) {
    return "This file type is not allowed.";
  }
  return null;
}

/**
 * Records an upload the browser has already placed in Storage. The insert
 * goes through the leader's own session, so RLS has the final word.
 */
export async function registerUploadAction(
  _prev: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = registerUploadSchema.safeParse({
    course_id: formData.get("course_id"),
    node_id: formData.get("node_id") || null,
    kind: formData.get("kind"),
    path_or_url: formData.get("path_or_url"),
    title: formData.get("title"),
    mime: formData.get("mime"),
    size_bytes: Number(formData.get("size_bytes")),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const blocked = await assertCanManageAssets(parsed.data.course_id);
  if (blocked) return { error: blocked };

  const pathError = checkStoragePath(
    parsed.data.course_id,
    parsed.data.path_or_url,
    parsed.data.mime,
  );
  if (pathError) return { error: pathError };

  const session = await requireSession();
  const supabase = await createClient();
  const { data: asset, error } = await supabase
    .from("assets")
    .insert({
      course_id: parsed.data.course_id,
      node_id: parsed.data.node_id,
      kind: parsed.data.kind,
      storage: "supabase",
      path_or_url: parsed.data.path_or_url,
      title: parsed.data.title,
      mime: parsed.data.mime,
      size_bytes: parsed.data.size_bytes,
    })
    .select("id")
    .single();
  if (error || !asset) {
    return { error: "The upload was not allowed. Refresh and try again." };
  }

  await writeAudit({
    actorId: session.userId,
    action: "asset.upload",
    entity: "assets",
    entityId: asset.id,
    meta: {
      course_id: parsed.data.course_id,
      node_id: parsed.data.node_id,
      mime: parsed.data.mime,
      size_bytes: parsed.data.size_bytes,
    },
  });

  revalidatePath(`/courses/${parsed.data.course_id}`);
  return { ok: true };
}

/** Adds a Drive or web link instead of an oversized upload (spec section 6). */
export async function addLinkAssetAction(
  _prev: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = addLinkAssetSchema.safeParse({
    course_id: formData.get("course_id"),
    node_id: formData.get("node_id") || null,
    kind: formData.get("kind"),
    storage: formData.get("storage"),
    url: formData.get("url"),
    title: formData.get("title"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  if (!parsed.data.url.startsWith("https://")) {
    return { error: "Use a link that starts with https://" };
  }

  const blocked = await assertCanManageAssets(parsed.data.course_id);
  if (blocked) return { error: blocked };

  const session = await requireSession();
  const supabase = await createClient();
  const { data: asset, error } = await supabase
    .from("assets")
    .insert({
      course_id: parsed.data.course_id,
      node_id: parsed.data.node_id,
      kind: parsed.data.kind,
      storage: parsed.data.storage,
      path_or_url: parsed.data.url,
      title: parsed.data.title,
      mime: "text/uri-list",
      size_bytes: null,
    })
    .select("id")
    .single();
  if (error || !asset) {
    return { error: "The link was not allowed. Refresh and try again." };
  }

  await writeAudit({
    actorId: session.userId,
    action: "asset.link",
    entity: "assets",
    entityId: asset.id,
    meta: { course_id: parsed.data.course_id, node_id: parsed.data.node_id },
  });

  return { ok: true };
}

/** Renames an asset or toggles its student flags (spec section 10). */
export async function updateAssetAction(
  _prev: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = updateAssetSchema.safeParse({
    asset_id: formData.get("asset_id"),
    title: formData.get("title") || undefined,
    student_visible:
      formData.get("student_visible") === null
        ? undefined
        : formData.get("student_visible") === "true",
    student_downloadable:
      formData.get("student_downloadable") === null
        ? undefined
        : formData.get("student_downloadable") === "true",
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const session = await requireSession();
  const supabase = await createClient();

  const { data: asset } = await supabase
    .from("assets")
    .select("id, course_id, title")
    .eq("id", parsed.data.asset_id)
    .single();
  if (!asset) {
    return { error: "This file is no longer available." };
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.student_visible !== undefined) {
    patch.student_visible = parsed.data.student_visible;
  }
  if (parsed.data.student_downloadable !== undefined) {
    patch.student_downloadable = parsed.data.student_downloadable;
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  // RLS allows only the creator, the course owner or an admin.
  const { error } = await supabase
    .from("assets")
    .update(patch)
    .eq("id", parsed.data.asset_id);
  if (error) {
    return {
      error:
        "Only the person who added this file, the course owner or an admin can change it.",
    };
  }

  if (patch.title !== undefined) {
    await writeAudit({
      actorId: session.userId,
      action: "asset.rename",
      entity: "assets",
      entityId: asset.id,
      meta: { from: asset.title, to: patch.title },
    });
  }

  revalidatePath(`/courses/${asset.course_id}`);
  return { ok: true };
}

/**
 * Replaces a file's contents with a new upload (already placed in Storage by
 * the browser) or a new link. The old storage object is removed.
 */
export async function replaceAssetAction(
  _prev: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = replaceAssetSchema.safeParse({
    asset_id: formData.get("asset_id"),
    storage: formData.get("storage"),
    path_or_url: formData.get("path_or_url"),
    mime: formData.get("mime"),
    size_bytes:
      formData.get("size_bytes") === null || formData.get("size_bytes") === ""
        ? null
        : Number(formData.get("size_bytes")),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const session = await requireSession();
  const supabase = await createClient();

  const { data: asset } = await supabase
    .from("assets")
    .select("id, course_id, storage, path_or_url")
    .eq("id", parsed.data.asset_id)
    .single();
  if (!asset) return { error: "This file is no longer available." };

  const blocked = await assertCanManageAssets(asset.course_id);
  if (blocked) return { error: blocked };

  if (parsed.data.storage === "supabase") {
    const pathError = checkStoragePath(
      asset.course_id,
      parsed.data.path_or_url,
      parsed.data.mime,
    );
    if (pathError) return { error: pathError };
  } else if (!parsed.data.path_or_url.startsWith("https://")) {
    return { error: "Use a link that starts with https://" };
  }

  const { error } = await supabase
    .from("assets")
    .update({
      storage: parsed.data.storage,
      path_or_url: parsed.data.path_or_url,
      mime: parsed.data.mime,
      size_bytes: parsed.data.size_bytes,
    })
    .eq("id", parsed.data.asset_id);
  if (error) {
    return {
      error:
        "Only the person who added this file, the course owner or an admin can replace it.",
    };
  }

  // Remove the replaced storage object (same course, so RLS allows it).
  if (asset.storage === "supabase") {
    await supabase.storage.from("assets").remove([asset.path_or_url]);
  }

  await writeAudit({
    actorId: session.userId,
    action: "asset.replace",
    entity: "assets",
    entityId: asset.id,
    meta: { course_id: asset.course_id },
  });

  revalidatePath(`/courses/${asset.course_id}`);
  return { ok: true };
}

/** Deletes an asset row and its storage object (hard delete, audited). */
export async function deleteAssetAction(
  _prev: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const parsed = deleteAssetSchema.safeParse({
    asset_id: formData.get("asset_id"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const session = await requireSession();
  const supabase = await createClient();

  const { data: asset } = await supabase
    .from("assets")
    .select("id, course_id, storage, path_or_url, title")
    .eq("id", parsed.data.asset_id)
    .single();
  if (!asset) return { error: "This file is no longer available." };

  // RLS allows only the creator, the course owner or an admin.
  const { error } = await supabase
    .from("assets")
    .delete()
    .eq("id", parsed.data.asset_id);
  if (error) {
    return {
      error:
        "Only the person who added this file, the course owner or an admin can delete it.",
    };
  }

  if (asset.storage === "supabase") {
    await supabase.storage.from("assets").remove([asset.path_or_url]);
  }

  await writeAudit({
    actorId: session.userId,
    action: "asset.delete",
    entity: "assets",
    entityId: asset.id,
    meta: { course_id: asset.course_id, title: asset.title },
  });

  revalidatePath(`/courses/${asset.course_id}`);
  return { ok: true };
}
