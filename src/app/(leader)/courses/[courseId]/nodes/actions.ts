"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import type { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { canReview, canWriteArea, getMembership } from "@/lib/course-access";
import { requireSession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/slug";
import { getTemplate } from "@/lib/templates";
import {
  addCommentSchema,
  assignNodeSchema,
  createNodeSchema,
  renameNodeSchema,
  reorderNodeSchema,
  resolveCommentSchema,
  restoreVersionSchema,
  saveDraftSchema,
  saveVersionSchema,
  setNodeStatusSchema,
  setNodeTagsSchema,
  softDeleteNodeSchema,
  type ContentArea,
} from "@/lib/schemas";

export type NodeActionState =
  { error: string } | { ok: true; nodeId?: string } | null;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function zUuid(value: FormDataEntryValue | null): string | null {
  const v = typeof value === "string" ? value : "";
  return UUID_PATTERN.test(v) ? v : null;
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form.";
}

/**
 * Creates a section or note from a template (spec section 6). The insert
 * goes through the leader's own session, so RLS has the final word on
 * course and area permission.
 */
export async function createNodeAction(
  _prev: NodeActionState,
  formData: FormData,
): Promise<NodeActionState> {
  await requireSession(); // RLS uses the caller's own session for the insert
  const parsed = createNodeSchema.safeParse({
    course_id: formData.get("course_id"),
    parent_id: zUuid(formData.get("parent_id")),
    area: formData.get("area"),
    kind: formData.get("kind"),
    title: formData.get("title"),
    template_id: formData.get("template_id") || undefined,
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();

  // Sort at the end of the parent's children.
  let sortOrder = 0;
  if (parsed.data.parent_id) {
    const { data: siblings } = await supabase
      .from("nodes")
      .select("sort_order")
      .eq("parent_id", parsed.data.parent_id)
      .is("deleted_at", null)
      .order("sort_order", { ascending: false })
      .limit(1);
    sortOrder = (siblings?.[0]?.sort_order ?? -1) + 1;
  }

  const template = parsed.data.template_id
    ? getTemplate(parsed.data.template_id)
    : undefined;

  const { data: node, error } = await supabase
    .from("nodes")
    .insert({
      course_id: parsed.data.course_id,
      parent_id: parsed.data.parent_id,
      area: parsed.data.area,
      kind: parsed.data.kind,
      title: parsed.data.title,
      slug: slugify(parsed.data.title),
      sort_order: sortOrder,
      draft_body_md: template
        ? template.bodyMd.replaceAll("{title}", parsed.data.title)
        : "",
    })
    .select("id")
    .single();

  if (error || !node) {
    return {
      error: "Could not create it. Check that you may write in this area.",
    };
  }

  revalidatePath(`/courses/${parsed.data.course_id}`);
  return { ok: true, nodeId: node.id };
}

/** Autosave: stores the working draft every 5 seconds (spec section 6). */
export async function saveDraftAction(
  _prev: NodeActionState,
  formData: FormData,
): Promise<NodeActionState> {
  await requireSession();
  const parsed = saveDraftSchema.safeParse({
    node_id: formData.get("node_id"),
    body_md: formData.get("body_md"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("nodes")
    .update({
      draft_body_md: parsed.data.body_md,
      draft_updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.node_id);

  if (error) return { error: "The draft could not be saved." };
  return { ok: true };
}

/**
 * Save: writes an immutable version row (spec section 6 — a version on
 * Save or after 60 seconds of changes). RLS enforces write rights.
 */
export async function saveVersionAction(
  _prev: NodeActionState,
  formData: FormData,
): Promise<NodeActionState> {
  const session = await requireSession();
  const parsed = saveVersionSchema.safeParse({
    node_id: formData.get("node_id"),
    body_md: formData.get("body_md"),
    change_note: formData.get("change_note") || "",
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { data: node } = await supabase
    .from("nodes")
    .select("course_id, title")
    .eq("id", parsed.data.node_id)
    .single();
  if (!node) notFound();

  const { error } = await supabase.from("node_versions").insert({
    node_id: parsed.data.node_id,
    body_md: parsed.data.body_md,
    author_id: session.userId,
    change_note: parsed.data.change_note,
  });
  if (error) {
    return { error: "The save did not go through. Try again." };
  }

  revalidatePath(`/courses/${node.course_id}/nodes/${parsed.data.node_id}`);
  return { ok: true };
}

/**
 * Review workflow transitions (spec section 4 table + rule 1):
 * - send for review (draft → in_review): any writer of the note
 * - publish (in_review → published) and send back (→ draft): admin,
 *   course owner or reviewer only — enforced here on the server and
 *   mirrored by RLS, which gives those columns no client grant at all.
 * Every transition is audited.
 */
export async function transitionNodeStatusAction(
  _prev: NodeActionState,
  formData: FormData,
): Promise<NodeActionState> {
  const session = await requireSession();
  const parsed = setNodeStatusSchema.safeParse({
    node_id: formData.get("node_id"),
    status: formData.get("status"),
    send_back_comment: formData.get("send_back_comment") || undefined,
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { data: node } = await supabase
    .from("nodes")
    .select("id, course_id, area, status, created_by, title")
    .eq("id", parsed.data.node_id)
    .single();
  if (!node) notFound();

  const membership = await getMembership(node.course_id, session.userId);
  const isAdmin = session.profile.global_role === "admin";
  const nextStatus = parsed.data.status;

  if (nextStatus === "in_review") {
    const maySend =
      isAdmin ||
      (membership !== null &&
        (canWriteArea(membership, node.area as ContentArea) ||
          membership.role === "owner"));
    if (!maySend) {
      return { error: "You are not allowed to send this note to review." };
    }
  } else {
    // publish or send back: reviewer, owner or admin
    if (!isAdmin && !canReview(membership)) {
      return { error: "Only a reviewer or the course owner can do this." };
    }
  }

  const admin = createAdminClient();
  const patch: Record<string, unknown> = { status: nextStatus };

  if (nextStatus === "published") {
    const { data: versions } = await admin
      .from("node_versions")
      .select("id, version_no")
      .eq("node_id", node.id)
      .order("version_no", { ascending: false })
      .limit(1);
    const latest = versions?.[0];
    if (!latest) {
      return { error: "Save the note at least once before publishing." };
    }
    patch.published_version_id = latest.id;
  }

  if (nextStatus === "draft" && node.status === "in_review") {
    // Send back with a required comment (spec section 6).
    const body = parsed.data.send_back_comment ?? "";
    const { error: commentError } = await admin.from("comments").insert({
      node_id: node.id,
      author_id: session.userId,
      body,
    });
    if (commentError) {
      return { error: "Could not save the review comment. Try again." };
    }
  }

  const { error } = await admin.from("nodes").update(patch).eq("id", node.id);
  if (error) {
    return { error: "Could not update the note. Try again." };
  }

  await writeAudit({
    actorId: session.userId,
    action: `node.status.${nextStatus}`,
    entity: "nodes",
    entityId: node.id,
    meta: {
      course_id: node.course_id,
      from_status: node.status,
      title: node.title,
    },
  });

  revalidatePath(`/courses/${node.course_id}/nodes/${node.id}`);
  revalidatePath("/");
  // Student pages are read-only views of published content (spec section 10
  // rule 5): any status change reshapes what they may see, so refresh the
  // whole student site on publish, unpublish or send-back.
  revalidatePath("/s");
  revalidatePath("/s/search");
  revalidatePath("/s/tags");
  if (node.course_id) {
    revalidatePath(`/s/courses/${node.course_id}`);
    revalidatePath(`/s/map/${node.course_id}`);
  }
  revalidatePath(`/s/notes/${node.id}`);
  return { ok: true };
}

/**
 * Soft delete (spec section 5 rule 5): hidden for 30 days, then removed by
 * a scheduled job. Who may delete: admin or owner anywhere; an editor only
 * their own items; a contributor only their own drafts (spec section 4).
 */
export async function softDeleteNodeAction(
  _prev: NodeActionState,
  formData: FormData,
): Promise<NodeActionState> {
  const session = await requireSession();
  const parsed = softDeleteNodeSchema.safeParse({
    node_id: formData.get("node_id"),
  });
  if (!parsed.success) return { error: "Missing note." };

  const supabase = await createClient();
  const { data: node } = await supabase
    .from("nodes")
    .select("id, course_id, area, status, created_by, assigned_to, title")
    .eq("id", parsed.data.node_id)
    .single();
  if (!node) notFound();

  const isAdmin = session.profile.global_role === "admin";
  const membership = await getMembership(node.course_id, session.userId);
  const isOwner = membership?.role === "owner";
  const isMine = node.created_by === session.userId;
  const isAssigned = node.assigned_to === session.userId;

  const mayDelete =
    isAdmin ||
    isOwner ||
    (membership?.role === "editor" && (isMine || isAssigned)) ||
    (membership?.role === "contributor" && isMine && node.status === "draft");

  if (!mayDelete) {
    return { error: "You are not allowed to delete this." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("nodes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", node.id);
  if (error) return { error: "Could not delete the note. Try again." };

  await writeAudit({
    actorId: session.userId,
    action: "node.soft_delete",
    entity: "nodes",
    entityId: node.id,
    meta: { course_id: node.course_id, title: node.title },
  });

  revalidatePath(`/courses/${node.course_id}`);
  return { ok: true };
}

/** Restores an old version as a NEW version (the M2 acceptance test). */
export async function restoreVersionAction(
  _prev: NodeActionState,
  formData: FormData,
): Promise<NodeActionState> {
  const session = await requireSession();
  const parsed = restoreVersionSchema.safeParse({
    node_id: formData.get("node_id"),
    version_no: Number(formData.get("version_no")),
  });
  if (!parsed.success) return { error: "Missing version." };

  const supabase = await createClient();
  const { data: version } = await supabase
    .from("node_versions")
    .select("body_md")
    .eq("node_id", parsed.data.node_id)
    .eq("version_no", parsed.data.version_no)
    .single();
  if (!version) notFound();

  const { data: node } = await supabase
    .from("nodes")
    .select("course_id")
    .eq("id", parsed.data.node_id)
    .single();
  if (!node) notFound();

  const { error } = await supabase.from("node_versions").insert({
    node_id: parsed.data.node_id,
    body_md: version.body_md,
    author_id: session.userId,
    change_note: `Restored version ${parsed.data.version_no}`,
  });
  if (error) {
    return { error: "Could not restore. Check that you may edit this note." };
  }

  revalidatePath(`/courses/${node.course_id}/nodes/${parsed.data.node_id}`);
  return { ok: true };
}

export async function renameNodeAction(
  _prev: NodeActionState,
  formData: FormData,
): Promise<NodeActionState> {
  await requireSession();
  const parsed = renameNodeSchema.safeParse({
    node_id: formData.get("node_id"),
    title: formData.get("title"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("nodes")
    .update({ title: parsed.data.title, slug: slugify(parsed.data.title) })
    .eq("id", parsed.data.node_id);
  if (error) return { error: "Could not rename. Try again." };
  return { ok: true };
}

/** Assign a leader to a note with an optional due date (spec rule 2). */
export async function assignNodeAction(
  _prev: NodeActionState,
  formData: FormData,
): Promise<NodeActionState> {
  await requireSession();
  const parsed = assignNodeSchema.safeParse({
    node_id: formData.get("node_id"),
    assigned_to: zUuid(formData.get("assigned_to")),
    due_date: formData.get("due_date") || "",
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("nodes")
    .update({
      assigned_to: parsed.data.assigned_to,
      due_date: parsed.data.due_date || null,
    })
    .eq("id", parsed.data.node_id);
  if (error) return { error: "Could not assign. Try again." };
  return { ok: true };
}

/** Move a note up or down among its siblings (spec section 6). */
export async function reorderNodeAction(
  _prev: NodeActionState,
  formData: FormData,
): Promise<NodeActionState> {
  await requireSession();
  const parsed = reorderNodeSchema.safeParse({
    node_id: formData.get("node_id"),
    direction: formData.get("direction"),
  });
  if (!parsed.success) return { error: "Missing move." };

  const supabase = await createClient();
  const { data: node } = await supabase
    .from("nodes")
    .select("id, parent_id, sort_order, course_id")
    .eq("id", parsed.data.node_id)
    .single();
  if (!node) notFound();

  let query = supabase
    .from("nodes")
    .select("id, sort_order")
    .is("deleted_at", null)
    .order("sort_order");
  query =
    parsed.data.direction === "up"
      ? query.lt("sort_order", node.sort_order)
      : query.gt("sort_order", node.sort_order);
  if (node.parent_id) {
    query = query.eq("parent_id", node.parent_id);
  } else {
    query = query.is("parent_id", null);
  }

  const { data: neighbours } = await query.limit(1);
  const neighbour = neighbours?.[0];
  if (!neighbour) return { ok: true }; // already at the end

  // Swap the two sort orders (both updates are RLS-checked).
  const { error: e1 } = await supabase
    .from("nodes")
    .update({ sort_order: neighbour.sort_order })
    .eq("id", node.id);
  const { error: e2 } = await supabase
    .from("nodes")
    .update({ sort_order: node.sort_order })
    .eq("id", neighbour.id);
  if (e1 || e2) return { error: "Could not move. Try again." };

  revalidatePath(`/courses/${node.course_id}`);
  return { ok: true };
}

/** Sets the tags on a note, creating new tag names as needed. */
export async function setNodeTagsAction(
  _prev: NodeActionState,
  formData: FormData,
): Promise<NodeActionState> {
  await requireSession();
  const tags = formData
    .getAll("tags")
    .filter((v): v is string => typeof v === "string")
    .map((t) => t.trim())
    .filter(Boolean);
  const parsed = setNodeTagsSchema.safeParse({
    node_id: formData.get("node_id"),
    tags,
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();

  // Create any tag names that do not exist yet.
  const { data: existing } = await supabase
    .from("tags")
    .select("id, name")
    .in("name", parsed.data.tags.length > 0 ? parsed.data.tags : ["__none__"]);
  const existingNames = new Set((existing ?? []).map((t) => t.name));

  const missing = parsed.data.tags.filter((t) => !existingNames.has(t));
  let allTags = existing ?? [];
  if (missing.length > 0) {
    const { data: created, error } = await supabase
      .from("tags")
      .insert(missing.map((name) => ({ name })))
      .select("id, name");
    if (error) return { error: "Could not save the tags. Try again." };
    allTags = [...allTags, ...(created ?? [])];
  }

  const tagIdByName = new Map(allTags.map((t) => [t.name, t.id]));
  const wantedIds = parsed.data.tags
    .map((t) => tagIdByName.get(t))
    .filter((id): id is string => id !== undefined);

  const { data: current } = await supabase
    .from("node_tags")
    .select("tag_id")
    .eq("node_id", parsed.data.node_id);
  const currentIds = new Set((current ?? []).map((r) => r.tag_id));

  const toAdd = wantedIds.filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !wantedIds.includes(id));

  if (toAdd.length > 0) {
    const { error } = await supabase
      .from("node_tags")
      .insert(
        toAdd.map((tag_id) => ({ node_id: parsed.data.node_id, tag_id })),
      );
    if (error) return { error: "Could not save the tags. Try again." };
  }
  for (const tag_id of toRemove) {
    const { error } = await supabase
      .from("node_tags")
      .delete()
      .eq("node_id", parsed.data.node_id)
      .eq("tag_id", tag_id);
    if (error) return { error: "Could not save the tags. Try again." };
  }

  return { ok: true };
}

export async function addCommentAction(
  _prev: NodeActionState,
  formData: FormData,
): Promise<NodeActionState> {
  const session = await requireSession();
  const parsed = addCommentSchema.safeParse({
    node_id: formData.get("node_id"),
    parent_id: zUuid(formData.get("parent_id")),
    body: formData.get("body"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("comments").insert({
    node_id: parsed.data.node_id,
    parent_id: parsed.data.parent_id,
    author_id: session.userId,
    body: parsed.data.body,
  });
  if (error) return { error: "Could not post the comment. Try again." };
  return { ok: true };
}

export async function resolveCommentAction(
  _prev: NodeActionState,
  formData: FormData,
): Promise<NodeActionState> {
  await requireSession();
  const parsed = resolveCommentSchema.safeParse({
    comment_id: formData.get("comment_id"),
    resolved: formData.get("resolved") === "true",
  });
  if (!parsed.success) return { error: "Missing comment." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("comments")
    .update({ resolved: parsed.data.resolved })
    .eq("id", parsed.data.comment_id);
  if (error) return { error: "Could not update the comment. Try again." };
  return { ok: true };
}
