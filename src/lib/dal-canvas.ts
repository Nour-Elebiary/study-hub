import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { canvasOps } from "@/lib/canvas/schemas";
import type { CanvasCard, CanvasEdge } from "@/lib/canvas/types";
import { mapDbError } from "@/lib/canvas/errors";
import type { CourseTreeInput, CourseSectionRef } from "@/lib/canvas/generate";
import { settingDefault, readSettings } from "@/lib/settings";
import { getStudentCourseIds } from "@/lib/student-access";
import type { StudentPayload } from "@/lib/student-cookie";

/**
 * Canvas data access (CANVAS-SPEC section 5.5). Re-exported from `dal.ts` so
 * it stays the single choke point (R6). RLS has the final word on every
 * leader query (the caller's own session is used); the student path
 * (account-less students — R8) goes through the service-role client with
 * the join-cookie scope applied explicitly, the same pattern as
 * `student-access.ts`.
 */

export type CanvasKind = "course" | "subject" | "free";

export type CanvasLegend = Record<string, string>;
export type CanvasViewport = { x: number; y: number; zoom: number };

export type CanvasRow = {
  id: string;
  courseId: string;
  title: string;
  kind: CanvasKind;
  rootNodeId: string | null;
  isDefault: boolean;
  published: boolean;
  legend: CanvasLegend;
  viewport: CanvasViewport;
  rev: number;
  updatedAt: string;
};

export type CanvasListRow = {
  id: string;
  title: string;
  kind: CanvasKind;
  isDefault: boolean;
  published: boolean;
  updatedAt: string;
};

export type ResolvedNote = {
  id: string;
  title: string;
  slug: string;
  area: string;
  /** The note has a published version (students see it). */
  published: boolean;
  /** The note is soft-deleted (leaders see a ghost "Deleted note" card). */
  deleted: boolean;
  /** First ~300 characters of the PUBLISHED body (never the draft). */
  preview: string | null;
};

export type ResolvedFile = {
  id: string;
  name: string;
  kind: string;
  mime: string;
  bytes: number | null;
  /** Students may see it at all. */
  visible: boolean;
  /** Students may download it. */
  downloadable: boolean;
  /** Storage path or URL (leaders sign image URLs for thumbnails). */
  pathOrUrl: string;
};

export type CanvasDetail = {
  canvas: CanvasRow;
  cards: CanvasCard[];
  edges: CanvasEdge[];
  notes: Record<string, ResolvedNote>;
  files: Record<string, ResolvedFile>;
};

/** Every DAL write returns a plain-language result instead of throwing. */
export type CanvasResult<T> =
  { ok: true; data: T } | { ok: false; user: string; log: string };

const ok = <T>(data: T): CanvasResult<T> => ({ ok: true, data });
const fail = <T>(user: string, log: string): CanvasResult<T> => ({
  ok: false,
  user,
  log,
});

const failWithError = <T>(message: string): CanvasResult<T> =>
  fail(mapDbError(message, { cardLimit: 300 }).user, message);

// ---------------------------------------------------------------------------
// Row mappers (snake_case database → camelCase app shape)
// ---------------------------------------------------------------------------

const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, zoom: 1 };

type CanvasRawRow = {
  id: string;
  course_id: string;
  title: string;
  kind: string;
  root_node_id: string | null;
  is_default: boolean;
  published: boolean;
  legend: unknown;
  viewport: unknown;
  rev: number;
  updated_at: string;
};

const asLegend = (raw: unknown): CanvasLegend => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: CanvasLegend = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
};

const asViewport = (raw: unknown): CanvasViewport => {
  if (!raw || typeof raw !== "object") return DEFAULT_VIEWPORT;
  const v = raw as Record<string, unknown>;
  const zoom = typeof v.zoom === "number" ? v.zoom : 1;
  return {
    x: typeof v.x === "number" ? v.x : 0,
    y: typeof v.y === "number" ? v.y : 0,
    zoom: Math.min(2, Math.max(0.1, zoom)),
  };
};

const toCanvasRow = (row: CanvasRawRow): CanvasRow => ({
  id: row.id,
  courseId: row.course_id,
  title: row.title,
  kind: (["course", "subject", "free"].includes(row.kind)
    ? row.kind
    : "free") as CanvasKind,
  rootNodeId: row.root_node_id,
  isDefault: row.is_default,
  published: row.published,
  legend: asLegend(row.legend),
  viewport: asViewport(row.viewport),
  rev: row.rev,
  updatedAt: row.updated_at,
});

type NodeRawRow = {
  id: string;
  kind: string;
  node_id: string | null;
  asset_id: string | null;
  url: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  color: string | null;
  body: string | null;
  label: string | null;
  student_visible: boolean;
};

const toCard = (row: NodeRawRow): CanvasCard => ({
  id: row.id,
  kind: row.kind as CanvasCard["kind"],
  nodeId: row.node_id,
  assetId: row.asset_id,
  url: row.url,
  x: row.x,
  y: row.y,
  width: row.width,
  height: row.height,
  z: row.z,
  color: (row.color as CanvasCard["color"]) ?? null,
  body: row.body,
  label: row.label,
  studentVisible: row.student_visible,
});

type EdgeRawRow = {
  id: string;
  from_node: string;
  to_node: string;
  from_side: string;
  to_side: string;
  from_end: string;
  to_end: string;
  label: string | null;
  color: string | null;
};

const toEdge = (row: EdgeRawRow): CanvasEdge => ({
  id: row.id,
  from: row.from_node,
  to: row.to_node,
  fromSide: row.from_side as CanvasEdge["fromSide"],
  toSide: row.to_side as CanvasEdge["toSide"],
  fromEnd: row.from_end as CanvasEdge["fromEnd"],
  toEnd: row.to_end as CanvasEdge["toEnd"],
  label: row.label,
  color: (row.color as CanvasEdge["color"]) ?? null,
});

// ---------------------------------------------------------------------------
// Settings helpers (limits live in `settings`, never in code — rule 8)
// ---------------------------------------------------------------------------

const settingsNumber = async (key: string): Promise<number> => {
  const values = await readSettings();
  const value = Number(values[key]);
  if (Number.isFinite(value) && value > 0) return value;
  const fallback = Number(settingDefault(key));
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 1;
};

const readCardLimit = () => settingsNumber("max_canvas_cards");

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The base column list for a full canvas row (embed keys match the FKs). */
const CANVAS_COLUMNS =
  "id, course_id, title, kind, root_node_id, is_default, published, legend, viewport, rev, updated_at";
const CARD_COLUMNS =
  "canvas_nodes ( id, kind, node_id, asset_id, url, x, y, width, height, z, color, body, label, student_visible )";
const EDGE_COLUMNS =
  "canvas_edges ( id, from_node, to_node, from_side, to_side, from_end, to_end, label, color )";

/**
 * The designer's maps list (spec 5.5): staff sees all undeleted maps of the
 * course, other callers only published ones — the caller's RLS decides, so
 * this stays one query.
 */
export async function listCanvases(courseId: string): Promise<CanvasListRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("canvases")
    .select("id, title, kind, is_default, published, updated_at")
    .eq("course_id", courseId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    kind: row.kind as CanvasKind,
    isDefault: row.is_default,
    published: row.published,
    updatedAt: row.updated_at,
  }));
}

/**
 * Loads one canvas with cards, edges AND resolved targets (note title, slug,
 * area, published flag, deleted flag; file name, kind, bytes, downloadable
 * flag) in at most 4 queries — one canvas query with both embeds, then one
 * `in` query per target table. No N+1.
 */
export async function getCanvas(
  canvasId: string,
): Promise<CanvasDetail | null> {
  const supabase = await createClient();

  // Query 1: canvas + cards + edges (RLS of all three tables applies inside
  // the embeds; a map the caller cannot see comes back null).
  const { data: canvas, error } = await supabase
    .from("canvases")
    .select(`${CANVAS_COLUMNS}, ${CARD_COLUMNS}, ${EDGE_COLUMNS}`)
    .eq("id", canvasId)
    .maybeSingle();
  if (error || !canvas) return null;

  const cards = ((canvas.canvas_nodes ?? []) as NodeRawRow[]).map(toCard);
  const edges = ((canvas.canvas_edges ?? []) as EdgeRawRow[]).map(toEdge);

  // Queries 2+3: the note and file targets, in bulk.
  const { notes, files } = await resolveTargets(supabase, cards);

  return {
    canvas: toCanvasRow(canvas as CanvasRawRow),
    cards,
    edges,
    notes,
    files,
  };
}

/**
 * Only the canvas's revision counter (spec 6.4): the cheap read the editor
 * makes on window focus to notice another leader's edits. RLS decides
 * access exactly as in getCanvas.
 */
export async function getCanvasRev(canvasId: string): Promise<number | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("canvases")
    .select("rev")
    .eq("id", canvasId)
    .maybeSingle<{ rev: number }>();
  return data?.rev ?? null;
}

/** Bulk-resolves the note/file targets of the given cards (2 queries). */
async function resolveTargets(
  supabase:
    | Awaited<ReturnType<typeof createClient>>
    | Awaited<ReturnType<typeof createAdminClient>>,
  cards: CanvasCard[],
): Promise<{
  notes: Record<string, ResolvedNote>;
  files: Record<string, ResolvedFile>;
}> {
  const noteIds = [
    ...new Set(cards.flatMap((c) => (c.nodeId ? [c.nodeId] : []))),
  ];
  const fileIds = [
    ...new Set(cards.flatMap((c) => (c.assetId ? [c.assetId] : []))),
  ];

  const notes: Record<string, ResolvedNote> = {};
  const files: Record<string, ResolvedFile> = {};

  if (noteIds.length > 0) {
    // Query 2: note targets.
    const { data } = await supabase
      .from("nodes")
      .select("id, title, slug, area, published_version_id, deleted_at")
      .in("id", noteIds);
    const versionOfNote = new Map<string, string | null>();
    for (const row of data ?? []) {
      notes[row.id] = {
        id: row.id,
        title: row.title,
        slug: row.slug,
        area: row.area,
        published:
          !row.deleted_at &&
          row.published_version_id !== null &&
          row.published_version_id !== undefined,
        deleted: Boolean(row.deleted_at),
        preview: null,
      };
      versionOfNote.set(row.id, row.published_version_id);
    }

    // Query 3: the published bodies for the card previews. Only published
    // versions are read — a note's draft body never reaches a canvas — and
    // only the first 300 characters are kept.
    const versionIds = [...versionOfNote.values()].filter(
      (v): v is string => typeof v === "string",
    );
    if (versionIds.length > 0) {
      const { data: versions } = await supabase
        .from("node_versions")
        .select("id, node_id, body_md")
        .in("id", versionIds);
      for (const version of versions ?? []) {
        const note = notes[version.node_id];
        if (note) {
          note.preview = version.body_md.slice(0, 300);
        }
      }
    }
  }
  if (fileIds.length > 0) {
    // Query 3: file targets.
    const { data } = await supabase
      .from("assets")
      .select(
        "id, title, path_or_url, kind, mime, size_bytes, student_visible, student_downloadable",
      )
      .in("id", fileIds);
    for (const row of data ?? []) {
      files[row.id] = {
        id: row.id,
        name: row.title || row.path_or_url,
        kind: row.kind,
        mime: row.mime,
        bytes: row.size_bytes,
        visible: Boolean(row.student_visible),
        downloadable: Boolean(row.student_downloadable),
        pathOrUrl: row.path_or_url,
      };
    }
  }
  return { notes, files };
}

/**
 * Student path (R6/R8): the join-cookie scope. Same shape as `getCanvas`,
 * served with the service-role client and filtered here exactly like the
 * RLS in §5.2: only a published, undeleted map inside the student's scope;
 * only cards students may see; edges whose both ends stay. Note cards whose
 * note has no published version are dropped entirely (RLS test 02 case 2),
 * so there is no draft body to strip — the text of an unpublished note never
 * exists on the card (cards reference notes, D1).
 */
export async function getStudentCanvas(
  canvasId: string,
  scope: StudentPayload,
): Promise<CanvasDetail | null> {
  const admin = createAdminClient();
  const courseIds = await getStudentCourseIds(scope);
  if (courseIds.length === 0) return null;

  // Query 1 of 4 (courses already counted): canvas + cards + edges.
  const { data: canvas } = await admin
    .from("canvases")
    .select(`${CANVAS_COLUMNS}, ${CARD_COLUMNS}, ${EDGE_COLUMNS}`)
    .eq("id", canvasId)
    .eq("published", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (!canvas) return null;
  const row = toCanvasRow(canvas as CanvasRawRow);
  if (!courseIds.includes(row.courseId)) return null;

  const allCards = ((canvas.canvas_nodes ?? []) as NodeRawRow[]).map(toCard);
  const allEdges = ((canvas.canvas_edges ?? []) as EdgeRawRow[]).map(toEdge);

  const { notes, files } = await resolveTargets(admin, allCards);

  // §5.2 card visibility: student_visible, and the target must be visible.
  const cards = allCards.filter((card) => {
    if (!card.studentVisible) return false;
    if (card.kind === "note" && card.nodeId) {
      const note = notes[card.nodeId];
      return Boolean(note) && note!.published;
    }
    if (card.kind === "file" && card.assetId) {
      const file = files[card.assetId];
      return Boolean(file) && file!.visible;
    }
    return (
      card.kind === "text" || card.kind === "link" || card.kind === "group"
    );
  });

  const kept = new Set(cards.map((c) => c.id));
  const edges = allEdges.filter((e) => kept.has(e.from) && kept.has(e.to));

  // Targets of hidden cards are not for the student — keep only the visible.
  const visibleNotes: Record<string, ResolvedNote> = {};
  for (const card of cards) {
    if (card.nodeId && notes[card.nodeId])
      visibleNotes[card.nodeId] = notes[card.nodeId]!;
  }
  const visibleFiles: Record<string, ResolvedFile> = {};
  for (const card of cards) {
    if (card.assetId && files[card.assetId])
      visibleFiles[card.assetId] = files[card.assetId]!;
  }

  return {
    canvas: row,
    cards,
    edges,
    notes: visibleNotes,
    files: visibleFiles,
  };
}

/** The default published map of a course, for `/s/map/[courseId]` (§5.7). */
export async function getStudentDefaultCanvas(
  courseId: string,
  scope: StudentPayload,
): Promise<CanvasRow | null> {
  const courseIds = await getStudentCourseIds(scope);
  if (!courseIds.includes(courseId)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("canvases")
    .select(CANVAS_COLUMNS)
    .eq("course_id", courseId)
    .eq("published", true)
    .eq("is_default", true)
    .is("deleted_at", null)
    .maybeSingle();
  return data ? toCanvasRow(data as CanvasRawRow) : null;
}

/** Just the map's course id — used by server actions for the TS-side check. */
export async function canvasCourseId(canvasId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("canvases")
    .select("course_id")
    .eq("id", canvasId)
    .maybeSingle();
  return data?.course_id ?? null;
}

// ---------------------------------------------------------------------------
// Writes (all return plain-language results; RLS is the real gate)
// ---------------------------------------------------------------------------

const MAX_TITLE = 120;

/**
 * Creates a map (server action only). Fails in plain language when the
 * course reached `max_canvases_per_course`.
 */
export async function createCanvas(input: {
  courseId: string;
  title: string;
  kind?: CanvasKind;
  rootNodeId?: string | null;
}): Promise<CanvasResult<CanvasRow>> {
  const supabase = await createClient();

  const canvasesPerCourse = await settingsNumber("max_canvases_per_course");
  const { count, error: countError } = await supabase
    .from("canvases")
    .select("id", { count: "exact", head: true })
    .eq("course_id", input.courseId)
    .is("deleted_at", null);
  if (countError) {
    return failWithError(countError.message);
  }
  if (count !== null && count >= canvasesPerCourse) {
    return fail(
      `This course already has the maximum of ${canvasesPerCourse} maps. Delete or merge one first.`,
      "canvas count at cap",
    );
  }

  const { data, error } = await supabase
    .from("canvases")
    .insert({
      course_id: input.courseId,
      title: input.title.slice(0, MAX_TITLE),
      kind: input.kind ?? "free",
      root_node_id: input.rootNodeId ?? null,
    })
    .select(CANVAS_COLUMNS)
    .single();
  if (error || !data) {
    return failWithError(error?.message ?? "insert returned no row");
  }
  return ok(toCanvasRow(data as CanvasRawRow));
}

/**
 * Applies a validated batch of ops through the `canvas_apply_ops` RPC (the
 * only writer of cards and edges, QUESTIONS #43). An automatic snapshot is
 * taken before the first write after 30 minutes of idle time (spec 5.5).
 * Errors are mapped to plain language with the live card limit.
 */
export async function applyCanvasOps(
  canvasId: string,
  ops: unknown[],
): Promise<CanvasResult<{ rev: number; applied: number; skipped: number }>> {
  const supabase = await createClient();

  const parsed = canvasOps.safeParse(ops);
  if (!parsed.success) {
    // The flow only ever sends ops built in the editor; an invalid batch is
    // one to report, not to decode for the user.
    return fail(
      "We could not save this change (it breaks a map rule). Try undoing it or reload the page.",
      `invalid ops: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    );
  }

  const { data: canvas } = await supabase
    .from("canvases")
    .select("updated_at")
    .eq("id", canvasId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!canvas) {
    return fail(
      "This map no longer exists (maybe it was just deleted).",
      "canvas not found before apply",
    );
  }

  // Automatic snapshot: the first write after 30 minutes of inactivity.
  const idleFor = Date.now() - new Date(canvas.updated_at).getTime();
  if (idleFor > 30 * 60 * 1000) {
    const { data: snapshot, error: snapError } = await supabase.rpc(
      "canvas_snapshot_json",
      { p_canvas_id: canvasId },
    );
    if (snapError || typeof snapshot === "undefined") {
      return failWithError(snapError?.message ?? "no snapshot returned");
    }
    const { error: insertError } = await supabase
      .from("canvas_versions")
      .insert({ canvas_id: canvasId, auto: true, snapshot });
    if (insertError) return failWithError(insertError.message);
    await pruneAutoVersions(canvasId);
  }

  const { data: result, error } = await supabase.rpc("canvas_apply_ops", {
    p_canvas_id: canvasId,
    p_ops: parsed.data,
  });
  if (error) {
    const cardLimit = await readCardLimit();
    return fail(mapDbError(error.message, { cardLimit }).user, error.message);
  }
  const r = result as { rev: number; applied: number; skipped: number };
  return ok({ rev: r.rev, applied: r.applied, skipped: r.skipped });
}

/** Saves a manual snapshot (kept forever, spec 5.5). */
export async function saveVersion(
  canvasId: string,
  label: string,
): Promise<CanvasResult<{ versionNo: number }>> {
  const supabase = await createClient();
  const { data: snapshot, error: snapError } = await supabase.rpc(
    "canvas_snapshot_json",
    { p_canvas_id: canvasId },
  );
  if (snapError || typeof snapshot === "undefined") {
    return failWithError(snapError?.message ?? "no snapshot returned");
  }
  const { data, error } = await supabase
    .from("canvas_versions")
    .insert({
      canvas_id: canvasId,
      label: label || null,
      auto: false,
      snapshot,
    })
    .select("version_no")
    .single();
  if (error || !data) return failWithError(error?.message ?? "no version_no");
  return ok({ versionNo: data.version_no });
}

export type CanvasVersionRow = {
  id: string;
  versionNo: number;
  label: string | null;
  auto: boolean;
  createdAt: string;
};

/** The backup list (metadata only — the snapshots themselves stay in the DB). */
export async function listVersions(
  canvasId: string,
): Promise<CanvasVersionRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("canvas_versions")
    .select("id, version_no, label, auto, created_at")
    .eq("canvas_id", canvasId)
    .order("version_no", { ascending: false })
    .limit(200);
  return (data ?? []).map((row) => ({
    id: row.id,
    versionNo: row.version_no,
    label: row.label,
    auto: row.auto,
    createdAt: row.created_at,
  }));
}

export type RestoreCounts = {
  nodesRestored: number;
  nodesDropped: number;
  edgesRestored: number;
  edgesDropped: number;
};

/** Restores one backup; the RPC writes the "Before restore" snapshot itself. */
export async function restoreVersion(
  versionId: string,
): Promise<CanvasResult<RestoreCounts>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("canvas_restore_version", {
    p_version_id: versionId,
  });
  if (error) return failWithError(error.message);
  const r = data as RestoreCounts;
  const { data: version } = await supabase
    .from("canvas_versions")
    .select("canvas_id")
    .eq("id", versionId)
    .single();
  if (version?.canvas_id) await pruneAutoVersions(version.canvas_id);
  return ok(r);
}

/**
 * Deletes old automatic backups so only the newest
 * `canvas_version_keep_auto` remain (manual ones stay forever). The admin
 * client is used because `canvas_versions` has no delete policy (spec 5.5;
 * same pattern as the AI-retention cleanup).
 */
export async function pruneAutoVersions(canvasId: string): Promise<void> {
  const admin = createAdminClient();
  const keep = Math.floor(await settingsNumber("canvas_version_keep_auto"));
  const { data } = await admin
    .from("canvas_versions")
    .select("id")
    .eq("canvas_id", canvasId)
    .eq("auto", true)
    .order("created_at", { ascending: false });
  const rows = data ?? [];
  if (rows.length <= keep) return;
  const ids = rows.slice(keep).map((row) => row.id);
  await admin.from("canvas_versions").delete().in("id", ids);
}

/**
 * Recently deleted maps, for the restore link on the designer's list
 * (restore window = `retention_deleted_note_days`). Read with the admin
 * client because RLS hides soft-deleted rows by design.
 */
export async function listDeletedCanvases(
  courseId: string,
): Promise<CanvasListRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("canvases")
    .select("id, title, kind, is_default, published, updated_at, deleted_at")
    .eq("course_id", courseId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .limit(20);
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    kind: row.kind as CanvasKind,
    isDefault: row.is_default,
    published: row.published,
    updatedAt: row.deleted_at,
  }));
}

/** Soft delete through the admin client + restore window rule (spec 5.5). */
export async function softDeleteCanvas(
  canvasId: string,
): Promise<CanvasResult<void>> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("canvases")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", canvasId)
    .is("deleted_at", null);
  if (error) return failWithError(error.message);
  return ok<void>(void 0);
}

/** Restores a soft-deleted map — only inside the retention window. */
export async function restoreCanvas(
  canvasId: string,
): Promise<CanvasResult<void>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("canvases")
    .select("deleted_at")
    .eq("id", canvasId)
    .maybeSingle();
  const days = await retentionDeletedDays();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  if (!data?.deleted_at || new Date(data.deleted_at).getTime() < cutoff) {
    return fail(
      "This map was deleted too long ago and cannot be restored.",
      "restore outside retention window",
    );
  }
  const { error } = await admin
    .from("canvases")
    .update({ deleted_at: null, is_default: false })
    .eq("id", canvasId);
  if (error) return failWithError(error.message);
  return ok<void>(void 0);
}

const retentionDeletedDays = () =>
  settingsNumber("retention_deleted_note_days");

/** Publish/unpublish (the designer's switch; audit comes from the action). */
export async function setPublished(
  canvasId: string,
  published: boolean,
): Promise<CanvasResult<void>> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("canvases")
    .update({ published })
    .eq("id", canvasId);
  if (error) return failWithError(error.message);
  return ok<void>(void 0);
}

/**
 * Makes one map the course default ("/s/map" target). The one-default
 * unique index means the old default must be cleared first; if the second
 * step fails there is simply no default until the leader tries again.
 */
export async function setDefault(
  courseId: string,
  canvasId: string,
): Promise<CanvasResult<void>> {
  const supabase = await createClient();
  const cleared = await supabase
    .from("canvases")
    .update({ is_default: false })
    .eq("course_id", courseId)
    .neq("id", canvasId)
    .eq("is_default", true);
  if (cleared.error) return failWithError(cleared.error.message);
  const { error } = await supabase
    .from("canvases")
    .update({ is_default: true })
    .eq("id", canvasId);
  if (error) return failWithError(error.message);
  return ok<void>(void 0);
}

/** Saves the colour legend ({ "1": "red = important for the exam", ... }). */
export async function updateLegend(
  canvasId: string,
  legend: CanvasLegend,
): Promise<CanvasResult<void>> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("canvases")
    .update({ legend })
    .eq("id", canvasId);
  if (error) return failWithError(error.message);
  return ok<void>(void 0);
}

/** Saves the pan/zoom state (debounced on the client, at most 2/minute). */
export async function saveViewport(
  canvasId: string,
  viewport: CanvasViewport,
): Promise<CanvasResult<void>> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("canvases")
    .update({ viewport })
    .eq("id", canvasId);
  if (error) return failWithError(error.message);
  return ok(void 0);
}

// ---------------------------------------------------------------------------
// Course tree for "generate a map from the course" (spec section 5.8 step 1)
// ---------------------------------------------------------------------------

/**
 * The course tree in stored order: the home note, every section (kind
 * "section") and, under each section, every note (kind "note") flattened
 * depth-first so nested groupings stay in stored order. Leaders see drafts
 * too — the student RLS hides them from students automatically.
 * 2 queries (courses + all live nodes of the course).
 */
export async function getCourseTree(
  courseId: string,
): Promise<CourseTreeInput | null> {
  const supabase = await createClient();
  const { data: course } = await supabase
    .from("courses")
    .select("title")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return null;

  const { data: rows } = await supabase
    .from("nodes")
    .select("id, parent_id, kind, title, area, sort_order")
    .eq("course_id", courseId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });

  const all = rows ?? [];
  const childrenOf = new Map<string, typeof all>();
  for (const row of all) {
    if (!row.parent_id) continue;
    const list = childrenOf.get(row.parent_id) ?? [];
    list.push(row);
    childrenOf.set(row.parent_id, list);
  }

  const home = all.find((row) => row.kind === "course_home");

  // Depth-first walk of one section, collecting note refs in stored order.
  const sectionNotes = (sectionId: string): CourseSectionRef["notes"] => {
    const notes: CourseSectionRef["notes"] = [];
    const walk = (parentId: string) => {
      for (const child of childrenOf.get(parentId) ?? []) {
        if (child.kind === "note") {
          notes.push({ id: child.id, title: child.title });
        }
        walk(child.id);
      }
    };
    walk(sectionId);
    return notes;
  };

  const sections: CourseSectionRef[] = all
    .filter((row) => row.kind === "section")
    .map((row) => ({
      id: row.id,
      title: row.title,
      area: row.area,
      notes: sectionNotes(row.id),
    }));

  return {
    courseTitle: course.title,
    home: home ? { id: home.id, title: home.title } : null,
    sections,
  };
}

// ---------------------------------------------------------------------------
// Picker lists (spec 5.6: "add a note or file card from a picker list")
// ---------------------------------------------------------------------------

export type PickerNote = {
  id: string;
  title: string;
  area: string;
  published: boolean;
};

export type PickerFile = {
  id: string;
  title: string;
  kind: string;
  bytes: number | null;
  /** Hidden files never reach the student viewer. */
  visible: boolean;
  downloadable: boolean;
};

/** Live notes of the course in stored order (the note picker). */
export async function listCourseNotes(courseId: string): Promise<PickerNote[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("nodes")
    .select("id, title, area, published_version_id, deleted_at")
    .eq("course_id", courseId)
    .eq("kind", "note")
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    area: row.area,
    published: row.published_version_id !== null,
  }));
}

/** Live assets of the course, newest first (the file picker). */
export async function listCourseFiles(courseId: string): Promise<PickerFile[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("assets")
    .select(
      "id, title, kind, size_bytes, student_visible, student_downloadable, created_at",
    )
    .eq("course_id", courseId)
    .eq("storage", "supabase")
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    kind: row.kind,
    bytes: row.size_bytes,
    visible: Boolean(row.student_visible),
    downloadable: Boolean(row.student_downloadable),
  }));
}
