import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type HealthItem = {
  courseId: string;
  courseTitle: string;
  id: string;
  title: string;
  detail: string;
};

export type UsageVerdict = {
  pct: number;
  level: "ok" | "warn" | "full";
};

/**
 * How close the usage is to the free-tier limit (spec section 9: warning at
 * 70%). 70–99% warns, 100% or more is full.
 */
export function usageVerdict(usedBytes: number, limitMb: number): UsageVerdict {
  const limitBytes = limitMb * 1024 * 1024;
  const pct = limitBytes > 0 ? Math.round((usedBytes / limitBytes) * 100) : 0;
  return {
    pct,
    level: pct >= 100 ? "full" : pct >= 70 ? "warn" : "ok",
  };
}

/** The courses the viewer may see: everything for an admin, own courses otherwise. */
export async function visibleCourseIds(
  isAdmin: boolean,
  userId: string,
): Promise<Array<{ id: string; title: string }>> {
  const admin = createAdminClient();
  if (isAdmin) {
    const { data } = await admin.from("courses").select("id, title");
    return data ?? [];
  }
  const { data } = await admin
    .from("course_members")
    .select("course_id")
    .eq("user_id", userId)
    .eq("role", "owner");
  const ids = (data ?? []).map((m) => m.course_id);
  if (!ids.length) return [];
  const { data: courses } = await admin
    .from("courses")
    .select("id, title")
    .in("id", ids);
  return courses ?? [];
}

/** Drafts untouched for more than 14 days (spec section 9, Content health). */
export async function staleDrafts(courseIds: string[]): Promise<HealthItem[]> {
  if (!courseIds.length) return [];
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 14 * 24 * 3_600_000).toISOString();
  const { data, error } = await admin
    .from("nodes")
    .select(
      "id, course_id, title, kind, draft_updated_at, created_at, courses!inner(title)",
    )
    .in("course_id", courseIds)
    .eq("status", "draft")
    .is("deleted_at", null)
    .lt("created_at", cutoff);
  if (error) throw new Error(`Could not read drafts: ${error.message}`);

  // created_at is older than 14 days for every row here, but a draft that
  // was touched recently is not stale — use the newer of the two dates.
  return (data ?? [])
    .map((n) => {
      const lastTouch = new Date(
        (n.draft_updated_at ?? n.created_at) as string,
      );
      const days = Math.floor(
        (Date.now() - lastTouch.getTime()) / (24 * 3_600_000),
      );
      return { node: n, days };
    })
    .filter(({ days }) => days >= 14)
    .map(({ node, days }) => ({
      courseId: node.course_id,
      courseTitle: (node.courses as unknown as { title: string }).title,
      id: node.id,
      title: node.title || "Untitled",
      detail: `untouched for ${days} days`,
    }));
}

/** Notes nobody is assigned to finish (spec section 9, Content health). */
export async function unownedNotes(courseIds: string[]): Promise<HealthItem[]> {
  if (!courseIds.length) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("nodes")
    .select("id, course_id, title, courses!inner(title)")
    .in("course_id", courseIds)
    .eq("kind", "note")
    .is("assigned_to", null)
    .is("deleted_at", null);
  if (error) throw new Error(`Could not read notes: ${error.message}`);
  return (data ?? []).map((n) => ({
    courseId: n.course_id,
    courseTitle: (n.courses as unknown as { title: string }).title,
    id: n.id,
    title: n.title || "Untitled",
    detail: "no leader is assigned",
  }));
}

/** Uploaded files over the size gate in the settings (spec section 9). */
export async function oversizedAssets(
  courseIds: string[],
  maxFileMb: number,
): Promise<HealthItem[]> {
  if (!courseIds.length) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("assets")
    .select("id, course_id, title, size_bytes, courses!inner(title)")
    .in("course_id", courseIds)
    .gt("size_bytes", maxFileMb * 1024 * 1024);
  if (error) throw new Error(`Could not read assets: ${error.message}`);
  return (data ?? []).map((a) => ({
    courseId: a.course_id,
    courseTitle: (a.courses as unknown as { title: string }).title,
    id: a.id,
    title: a.title || "Untitled file",
    detail: `${(Number(a.size_bytes) / (1024 * 1024)).toFixed(1)} MB`,
  }));
}

/**
 * File storage used by the assets bucket (bytes). The storage schema is not
 * reachable through PostgREST, so this walks the bucket through the Storage
 * API: one folder per course, files named by uuid.
 */
export async function storageBytesUsed(courseIds: string[]): Promise<number> {
  const admin = createAdminClient();
  let total = 0;
  for (const courseId of courseIds) {
    let offset = 0;
    for (;;) {
      const { data } = await admin.storage
        .from("assets")
        .list(courseId, { limit: 1000, offset });
      const entries = data ?? [];
      for (const entry of entries) {
        total += entry.metadata?.size ?? 0;
      }
      if (entries.length < 1000) break;
      offset += 1000;
    }
  }
  return total;
}

/** Database size in bytes, through the service-only RPC (migration 00012). */
export async function databaseBytesUsed(): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("db_size_bytes");
  if (error)
    throw new Error(`Could not measure the database: ${error.message}`);
  return Number(data ?? 0);
}
