"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { getMembership } from "@/lib/course-access";
import { requireSession } from "@/lib/dal";
import {
  applyCanvasOps,
  createCanvas,
  getCourseTree,
  listCourseFiles,
  listCourseNotes,
  listVersions,
  restoreCanvas,
  restoreVersion,
  saveVersion,
  saveViewport,
  setDefault,
  setPublished,
  softDeleteCanvas,
  updateLegend,
  canvasCourseId,
  type CanvasLegend,
  type CanvasViewport,
} from "@/lib/dal-canvas";
import { generatePlan, chunkOps } from "@/lib/canvas/generate";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { readSettings } from "@/lib/settings";
import {
  canvasDeleteSchema,
  canvasLegendSchema,
  canvasVersionRestoreSchema,
  canvasVersionSaveSchema,
  canvasViewportSchema,
  createCanvasSchema,
  defaultCanvasSchema,
  publishCanvasSchema,
} from "@/lib/schemas";
import type { z } from "zod";

/**
 * Canvas server actions (CANVAS-SPEC section 5.5). Every action: zod
 * validates, the session + course role is resolved (defence in depth — RLS
 * remains the real gate), then the DAL call, an audit row where the spec
 * lists one, and a revalidate. New rate-limit purposes (spec section 10):
 * `canvas_ops` 240/min, `canvas_create` 20/h.
 */

export type CanvasActionState =
  { error: string } | { ok: true; canvasId?: string } | null;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form.";
}

function revalidateCourse(courseId: string | null, canvasId?: string): void {
  if (courseId) {
    revalidatePath(`/courses/${courseId}/canvas`);
    if (canvasId) revalidatePath(`/courses/${courseId}/canvas/${canvasId}`);
  }
}

const failed = (message: string): { error: string } => ({ error: message });

/**
 * May this session edit canvases in the course? (D7, QUESTIONS #31: every
 * course member of any level may edit; a global admin without membership
 * may too — same as the database `can_edit_canvas`.)
 */
async function canEdit(courseId: string): Promise<boolean> {
  const session = await requireSession();
  if (session.profile.global_role === "admin") return true;
  const membership = await getMembership(courseId, session.userId);
  return membership !== null;
}

/** The canvas's course id or null; used before the membership check. */
const courseOf = canvasCourseId;

// ---------------------------------------------------------------------------
// Create / delete / restore
// ---------------------------------------------------------------------------

export async function createCanvasAction(
  _prev: CanvasActionState,
  formData: FormData,
): Promise<CanvasActionState> {
  await requireSession();
  const parsed = createCanvasSchema.safeParse({
    course_id: formData.get("course_id"),
    title: formData.get("title"),
  });
  if (!parsed.success) return failed(firstIssue(parsed.error));
  const { course_id, title } = parsed.data;

  const allowed = await canEdit(course_id);
  if (!allowed) return failed("You are not allowed to edit this course.");

  if (!(await checkRateLimit("canvas_create", getClientIp(await headers())))) {
    return failed("Too many new maps. Wait a while and try again.");
  }

  const result = await createCanvas({ courseId: course_id, title });
  if (!result.ok) {
    console.error("createCanvas failed:", result.log);
    return failed(result.user);
  }
  const session = await requireSession();
  await writeAudit({
    actorId: session.userId,
    action: "canvas.create",
    entity: "canvas",
    entityId: result.data.id,
    meta: { course_id: course_id, title },
  });
  revalidateCourse(course_id, result.data.id);
  return { ok: true, canvasId: result.data.id };
}

export async function deleteCanvasAction(
  _prev: CanvasActionState,
  formData: FormData,
): Promise<CanvasActionState> {
  await requireSession();
  const parsed = canvasDeleteSchema.safeParse({
    canvas_id: formData.get("canvas_id"),
  });
  if (!parsed.success) return failed(firstIssue(parsed.error));

  const courseId = await courseOf(parsed.data.canvas_id);
  if (!courseId) return failed("This map no longer exists.");
  const allowed = await canEdit(courseId);
  if (!allowed) return failed("You are not allowed to edit this course.");

  const result = await softDeleteCanvas(parsed.data.canvas_id);
  if (!result.ok) {
    console.error("deleteCanvas failed:", result.log);
    return failed(result.user);
  }
  const session = await requireSession();
  await writeAudit({
    actorId: session.userId,
    action: "canvas.delete",
    entity: "canvas",
    entityId: parsed.data.canvas_id,
    meta: { course_id: courseId },
  });
  revalidateCourse(courseId, parsed.data.canvas_id);
  return { ok: true };
}

export async function restoreCanvasAction(
  _prev: CanvasActionState,
  formData: FormData,
): Promise<CanvasActionState> {
  await requireSession();
  const parsed = canvasDeleteSchema.safeParse({
    canvas_id: formData.get("canvas_id"),
  });
  if (!parsed.success) return failed(firstIssue(parsed.error));

  const courseId = await courseOf(parsed.data.canvas_id);
  if (!courseId) return failed("This map no longer exists.");
  const allowed = await canEdit(courseId);
  if (!allowed) return failed("You are not allowed to edit this course.");

  const result = await restoreCanvas(parsed.data.canvas_id);
  if (!result.ok) {
    console.error("restoreCanvas failed:", result.log);
    return failed(result.user);
  }
  const session = await requireSession();
  await writeAudit({
    actorId: session.userId,
    action: "canvas.restore",
    entity: "canvas",
    entityId: parsed.data.canvas_id,
    meta: { course_id: courseId },
  });
  revalidateCourse(courseId, parsed.data.canvas_id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Publish / default / legend / viewport
// ---------------------------------------------------------------------------

export async function publishCanvasAction(
  _prev: CanvasActionState,
  formData: FormData,
): Promise<CanvasActionState> {
  await requireSession();
  const parsed = publishCanvasSchema.safeParse({
    canvas_id: formData.get("canvas_id"),
    published: formData.get("published") === "true",
  });
  if (!parsed.success) return failed(firstIssue(parsed.error));

  const courseId = await courseOf(parsed.data.canvas_id);
  if (!courseId) return failed("This map no longer exists.");
  const allowed = await canEdit(courseId);
  if (!allowed) return failed("You are not allowed to edit this course.");

  const result = await setPublished(
    parsed.data.canvas_id,
    parsed.data.published,
  );
  if (!result.ok) {
    console.error("setPublished failed:", result.log);
    return failed(result.user);
  }
  const session = await requireSession();
  await writeAudit({
    actorId: session.userId,
    action: "canvas.publish",
    entity: "canvas",
    entityId: parsed.data.canvas_id,
    meta: { course_id: courseId, published: parsed.data.published },
  });
  revalidateCourse(courseId, parsed.data.canvas_id);
  revalidatePath(`/s/map/${courseId}`);
  return { ok: true };
}

export async function setDefaultCanvasAction(
  _prev: CanvasActionState,
  formData: FormData,
): Promise<CanvasActionState> {
  await requireSession();
  const parsed = defaultCanvasSchema.safeParse({
    course_id: formData.get("course_id"),
    canvas_id: formData.get("canvas_id"),
  });
  if (!parsed.success) return failed(firstIssue(parsed.error));

  const allowed = await canEdit(parsed.data.course_id);
  if (!allowed) return failed("You are not allowed to edit this course.");

  const result = await setDefault(parsed.data.course_id, parsed.data.canvas_id);
  if (!result.ok) {
    console.error("setDefault failed:", result.log);
    return failed(result.user);
  }
  revalidateCourse(parsed.data.course_id, parsed.data.canvas_id);
  revalidatePath(`/s/map/${parsed.data.course_id}`);
  return { ok: true };
}

/**
 * Saves the legend (colour → plain-language name, e.g. "red = for the
 * exam"). A { errors }-free variant: the editor calls it and shows the
 * result in the save chip; errors land here as { error }.
 */
export async function updateLegendAction(
  canvasId: string,
  legend: unknown,
): Promise<{ error?: string; ok?: true }> {
  await requireSession();
  const courseId = await courseOf(canvasId);
  if (!courseId) return { error: "This map no longer exists." };
  const allowed = await canEdit(courseId);
  if (!allowed) return { error: "You are not allowed to edit this course." };

  const parsed = canvasLegendSchema.safeParse(legend);
  if (!parsed.success) {
    return { error: firstIssue(parsed.error) || "Check the legend names." };
  }
  const result = await updateLegend(canvasId, parsed.data as CanvasLegend);
  if (!result.ok) {
    console.error("updateLegend failed:", result.log);
    return { error: result.user };
  }
  revalidateCourse(courseId, canvasId);
  return { ok: true };
}

/** Debounced on the client (spec 5.5: at most two saves per minute). */
export async function saveViewportAction(
  canvasId: string,
  viewport: unknown,
): Promise<{ error?: string; ok?: true }> {
  await requireSession();
  const courseId = await courseOf(canvasId);
  if (!courseId) return { error: "This map no longer exists." };
  const allowed = await canEdit(courseId);
  if (!allowed) return { error: "You are not allowed to edit this course." };

  const parsed = canvasViewportSchema.safeParse(viewport);
  if (!parsed.success) return {}; // a bad viewport is silently dropped
  const result = await saveViewport(canvasId, {
    x: parsed.data.x,
    y: parsed.data.y,
    zoom: parsed.data.zoom,
  } as CanvasViewport);
  if (!result.ok) return { error: result.user };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Versions (backups)
// ---------------------------------------------------------------------------

export async function saveVersionAction(
  _prev: CanvasActionState,
  formData: FormData,
): Promise<CanvasActionState> {
  await requireSession();
  const parsed = canvasVersionSaveSchema.safeParse({
    canvas_id: formData.get("canvas_id"),
    label: formData.get("label") || undefined,
  });
  if (!parsed.success) return failed(firstIssue(parsed.error));

  const courseId = await courseOf(parsed.data.canvas_id);
  if (!courseId) return failed("This map no longer exists.");
  const allowed = await canEdit(courseId);
  if (!allowed) return failed("You are not allowed to edit this course.");

  const result = await saveVersion(
    parsed.data.canvas_id,
    parsed.data.label ?? "",
  );
  if (!result.ok) {
    console.error("saveVersion failed:", result.log);
    return failed(result.user);
  }
  revalidateCourse(courseId, parsed.data.canvas_id);
  return { ok: true, canvasId: parsed.data.canvas_id };
}

export async function restoreVersionAction(
  _prev: CanvasActionState,
  formData: FormData,
): Promise<CanvasActionState> {
  await requireSession();
  const parsed = canvasVersionRestoreSchema.safeParse({
    canvas_id: formData.get("canvas_id"),
    version_id: formData.get("version_id"),
  });
  if (!parsed.success) return failed(firstIssue(parsed.error));

  const courseId = await courseOf(parsed.data.canvas_id);
  if (!courseId) return failed("This map no longer exists.");
  const allowed = await canEdit(courseId);
  if (!allowed) return failed("You are not allowed to edit this course.");

  const result = await restoreVersion(parsed.data.version_id);
  if (!result.ok) {
    console.error("restoreVersion failed:", result.log);
    return failed(result.user);
  }
  revalidateCourse(courseId, parsed.data.canvas_id);
  return { ok: true, canvasId: parsed.data.canvas_id };
}

/** The backup list for the Versions sheet (client opens it on demand). */
export async function listVersionsAction(canvasId: string): Promise<
  | {
      ok: true;
      versions: {
        id: string;
        versionNo: number;
        label: string | null;
        auto: boolean;
        createdAt: string;
      }[];
    }
  | { error: string }
> {
  await requireSession();
  const courseId = await courseOf(canvasId);
  if (!courseId || !(await canEdit(courseId))) {
    return { error: "You are not allowed to edit this map." };
  }
  return { ok: true, versions: await listVersions(canvasId) };
}

/** Note picker list for "Add note" (only notes of this course). */
export async function listPickerNotesAction(courseId: string): Promise<
  | {
      ok: true;
      notes: { id: string; title: string; area: string; published: boolean }[];
    }
  | { error: string }
> {
  await requireSession();
  if (!(await canEdit(courseId))) {
    return { error: "You are not allowed to edit this course." };
  }
  return { ok: true, notes: await listCourseNotes(courseId) };
}

/** File picker list for "Add file" (only files of this course). */
export async function listPickerFilesAction(courseId: string): Promise<
  | {
      ok: true;
      files: {
        id: string;
        title: string;
        kind: string;
        bytes: number | null;
        visible: boolean;
        downloadable: boolean;
      }[];
    }
  | { error: string }
> {
  await requireSession();
  if (!(await canEdit(courseId))) {
    return { error: "You are not allowed to edit this course." };
  }
  return { ok: true, files: await listCourseFiles(courseId) };
}

// ---------------------------------------------------------------------------
// Ops (the editor's saving queue entry point)
// ---------------------------------------------------------------------------

/**
 * The editor's channel for every change (D6): validated ops, rate-limited,
 * applied through the only database writer (`canvas_apply_ops`). Returns the
 * new revision, or a plain-language error plus `refetch: true` when the
 * local optimism must be thrown away.
 */
export async function applyCanvasOpsAction(
  canvasId: string,
  ops: unknown[],
): Promise<
  | { ok: true; rev: number; applied: number; skipped: number }
  | { error: string; refetch: true }
> {
  await requireSession();
  const courseId = await courseOf(canvasId);
  if (!courseId) return { error: "This map no longer exists.", refetch: true };
  const allowed = await canEdit(courseId);
  if (!allowed)
    return { error: "You are not allowed to edit this map.", refetch: true };

  if (!(await checkRateLimit("canvas_ops", getClientIp(await headers())))) {
    return {
      error: "You are changing the map very fast. Wait a moment and try again.",
      refetch: true,
    };
  }

  const result = await applyCanvasOps(canvasId, ops);
  if (!result.ok) {
    console.error("applyCanvasOps failed:", result.log);
    return { error: result.user, refetch: true };
  }
  return {
    ok: true,
    rev: result.data.rev,
    applied: result.data.applied,
    skipped: result.data.skipped,
  };
}

// ---------------------------------------------------------------------------
// Generate from course (spec section 5.8)
// ---------------------------------------------------------------------------

/**
 * "Generate a map from the course": builds the plan with the pure module,
 * then creates canvases and applies their ops in ≤200-op chunks. The first
 * canvas becomes the course default (step 9). On any failure inside a
 * canvas's ops, that half-built canvas is soft-deleted (step 7) and the
 * plain-language error is shown; canvases fully built before it stay.
 */
export async function generateCanvasAction(
  courseId: string,
): Promise<
  | { ok: true; canvases: number; message: string }
  | { error: string; refetch: true }
> {
  await requireSession();
  if (!UUID_PATTERN.test(courseId) || !(await canEdit(courseId))) {
    return { error: "You are not allowed to edit this course.", refetch: true };
  }
  if (!(await checkRateLimit("canvas_create", getClientIp(await headers())))) {
    return {
      error: "Too many new maps. Wait a while and try again.",
      refetch: true,
    };
  }

  const settings = await readSettings();
  const maxCards = Number(settings.max_canvas_cards);

  const tree = await getCourseTree(courseId);
  if (!tree) return { error: "This course no longer exists.", refetch: true };

  const plan = generatePlan(tree, maxCards, () => crypto.randomUUID());

  if (plan.length === 0) {
    return {
      ok: true,
      canvases: 0,
      message: "There is nothing to map yet in this course.",
    };
  }

  let created = 0;
  let firstCanvasId: string | null = null;
  for (const item of plan) {
    const canvasResult = await createCanvas({
      courseId,
      title: item.title,
      kind: item.kind,
    });
    if (!canvasResult.ok) {
      console.error("generate: createCanvas failed:", canvasResult.log);
      return { error: canvasResult.user, refetch: true };
    }
    const canvasId = canvasResult.data.id;
    if (!firstCanvasId) firstCanvasId = canvasId;

    let failedChunk: string | null = null;
    for (const chunk of chunkOps(item.ops)) {
      const applied = await applyCanvasOps(canvasId, chunk);
      if (!applied.ok) {
        failedChunk = applied.user;
        console.error("generate: applyCanvasOps failed:", applied.log);
        break;
      }
    }
    if (failedChunk) {
      await softDeleteCanvas(canvasId);
      return { error: failedChunk, refetch: true };
    }
    created += 1;
  }

  if (firstCanvasId) {
    await setDefault(courseId, firstCanvasId);
  }

  await writeAudit({
    actorId: (await requireSession()).userId,
    action: "canvas.create",
    entity: "canvas",
    entityId: firstCanvasId,
    meta: { course_id: courseId, generated: true, canvases: created },
  });

  revalidateCourse(courseId, firstCanvasId ?? undefined);

  return {
    ok: true,
    canvases: created,
    message:
      created === 1
        ? "Your course map is ready."
        : `Done. Because there are so many cards, the course was split into ${created} maps.`,
  };
}
