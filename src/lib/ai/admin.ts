import "server-only";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { pacificMidnightUtc } from "@/lib/ai/usage";

/**
 * Admin side of the AI assistant (spec sections 8 and 9): the usage bars
 * per key, the editable ai_limits rows, and the retention cleanup for AI
 * messages. All reads and writes use the service role — ai_limits is
 * admin-only by policy and the usage table has no client writes at all.
 */

export type AiUsageOverview = {
  allowance: number;
  totals: { conversations: number; messages: number };
  keys: Array<{
    id: string;
    label: string;
    owner_name: string;
    project_label: string;
    key_last4: string;
    status: string;
    cooldown_until: string | null;
    created_at: string;
    day: Record<string, { requests: number; tokens: number }>;
    minute: Record<string, { requests: number; tokens: number }>;
  }>;
  limits: Array<{
    model: string;
    rpm: number;
    tpm: number;
    rpd: number;
    soft_pct: number;
  }>;
};

const usageRowSchema = z.object({
  key_id: z.string(),
  model: z.string(),
  bucket_kind: z.enum(["minute", "day"]),
  requests: z.number(),
  tokens_est: z.number(),
});

export async function getAiUsageOverview(): Promise<AiUsageOverview> {
  const admin = createAdminClient();
  const now = new Date();
  const dayStart = pacificMidnightUtc(now).toISOString();
  const minuteStart = new Date(
    Math.floor(now.getTime() / 60_000) * 60_000,
  ).toISOString();

  const [
    keysRes,
    usageRes,
    limitsRes,
    conversationsRes,
    messagesRes,
    settingsRes,
  ] = await Promise.all([
    admin
      .from("ai_keys")
      .select(
        "id, label, project_label, key_last4, status, cooldown_until, created_at, owner_id",
      )
      .order("created_at"),
    admin
      .from("ai_usage")
      .select("key_id, model, requests, tokens_est, bucket_start, bucket_kind")
      .in("bucket_start", [dayStart, minuteStart]),
    admin
      .from("ai_limits")
      .select("model, rpm, tpm, rpd, soft_pct")
      .order("model"),
    admin.from("ai_conversations").select("id", { count: "exact", head: true }),
    admin.from("ai_messages").select("id", { count: "exact", head: true }),
    admin
      .from("settings")
      .select("value")
      .eq("key", "ai_daily_allowance_per_leader")
      .maybeSingle(),
  ]);

  // Owner names in one query (profiles are few in a school-sized install).
  const ownerIds = [...new Set((keysRes.data ?? []).map((k) => k.owner_id))];
  const { data: ownerRows } = ownerIds.length
    ? await admin.from("profiles").select("id, display_name").in("id", ownerIds)
    : { data: [] as { id: string; display_name: string }[] | null };
  const nameByOwner = new Map(
    (ownerRows ?? []).map((p) => [p.id, p.display_name]),
  );

  const day: Record<
    string,
    Record<string, { requests: number; tokens: number }>
  > = {};
  const minute: Record<
    string,
    Record<string, { requests: number; tokens: number }>
  > = {};
  for (const row of usageRes.data ?? []) {
    const parsed = usageRowSchema.safeParse(row);
    if (!parsed.success) continue;
    const target = parsed.data.bucket_kind === "day" ? day : minute;
    target[parsed.data.key_id] ??= {};
    target[parsed.data.key_id][parsed.data.model] = {
      requests: parsed.data.requests,
      tokens: parsed.data.tokens_est,
    };
  }

  const allowanceSetting = settingsRes.data?.value;
  return {
    allowance: typeof allowanceSetting === "number" ? allowanceSetting : 0,
    totals: {
      conversations: conversationsRes.count ?? 0,
      messages: messagesRes.count ?? 0,
    },
    keys: (keysRes.data ?? []).map((key) => ({
      id: key.id,
      label: key.label,
      owner_name: nameByOwner.get(key.owner_id) ?? "A leader",
      project_label: key.project_label,
      key_last4: key.key_last4,
      status: key.status,
      cooldown_until: key.cooldown_until,
      created_at: key.created_at,
      day: day[key.id] ?? {},
      minute: minute[key.id] ?? {},
    })),
    limits: limitsRes.data ?? [],
  };
}

export const aiLimitsUpdateSchema = z.object({
  rows: z
    .array(
      z.object({
        model: z.string().min(1).max(80),
        rpm: z.number().int().positive().max(10_000),
        tpm: z.number().int().positive().max(100_000_000),
        rpd: z.number().int().positive().max(1_000_000),
        soft_pct: z.number().int().min(1).max(100),
      }),
    )
    .max(20),
  password: z.string().optional(),
});

/**
 * Updates the ai_limits rows (spec section 8: the admin edits them when
 * Google changes the free tier). Editing limits is a sensitive action, so
 * the caller may need to confirm their password (checkRecentLogin).
 */
export async function updateAiLimits(
  adminId: string,
  rows: Array<{
    model: string;
    rpm: number;
    tpm: number;
    rpd: number;
    soft_pct: number;
  }>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  for (const row of rows) {
    const { error } = await admin
      .from("ai_limits")
      .upsert({ provider: "gemini", ...row }, { onConflict: "provider,model" });
    if (error) {
      return { ok: false, error: "The limits could not be saved." };
    }
  }
  await writeAudit({
    actorId: adminId,
    action: "ai_limits_updated",
    entity: "ai_limits",
    meta: { models: rows.map((row) => row.model) },
  });
  return { ok: true };
}

/**
 * Retention (spec section 8): AI messages are kept N days
 * (settings.retention_ai_days, default 90) and can be deleted by their
 * author. There is no cron on the free tier, so the cleanup runs when the
 * admin opens the AI screen (docs/QUESTIONS.md #20).
 */
export async function applyAiRetention(): Promise<number> {
  const admin = createAdminClient();
  const { data: setting } = await admin
    .from("settings")
    .select("value")
    .eq("key", "retention_ai_days")
    .maybeSingle();
  const days =
    typeof setting?.value === "number" && setting.value > 0
      ? setting.value
      : 90;
  const cutoff = new Date(Date.now() - days * 24 * 3_600_000).toISOString();

  const { count } = await admin
    .from("ai_messages")
    .select("id", { count: "exact", head: true })
    .lt("created_at", cutoff);
  if (!count) return 0;
  const { error } = await admin
    .from("ai_messages")
    .delete()
    .lt("created_at", cutoff);
  if (error) return 0;
  return count;
}
