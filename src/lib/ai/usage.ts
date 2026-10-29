import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Limit sensing (spec section 8): the Gemini API does not report remaining
 * quota, so the app counts its own calls in minute and day buckets in
 * ai_usage. The counters are advisory — a real 429 is the final truth —
 * so a plain read-then-write increment is enough and a rare race only
 * undercounts slightly.
 *
 * Day buckets roll at midnight America/Los_Angeles, the timezone Google
 * uses for its daily resets.
 */

export const PACIFIC = "America/Los_Angeles";

/** `now` truncated to the start of its minute (UTC instant). */
export function minuteBucketStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000);
}

/** Offset of `timeZone` from UTC in minutes at the given instant. */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return (asUtc - date.getTime()) / 60_000;
}

/**
 * The UTC instant of midnight Pacific on the calendar day of `now`.
 * Computed from the offset at noon UTC that day (always Pacific daytime,
 * clear of the 2 a.m. DST transition). On the two transition days the
 * bucket may start an hour early or late — harmless for advisory counters.
 */
export function pacificMidnightUtc(now: Date): Date {
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: PACIFIC,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [year, month, day] = local.split("-").map(Number);
  const noonUtc = Date.UTC(year, month - 1, day, 12);
  const offsetMinutes = tzOffsetMinutes(new Date(noonUtc), PACIFIC);
  return new Date(noonUtc - offsetMinutes * 60_000 - 12 * 3_600_000);
}

const usageRowSchema = z.object({
  requests: z.number().int().nonnegative(),
  tokens_est: z.number().int().nonnegative(),
});

export type UsageSnapshot = {
  minuteRequests: number;
  minuteTokens: number;
  dayRequests: number;
  dayTokens: number;
};

/**
 * Adds one request (and its estimated tokens) to both the minute and the
 * day bucket of this key + model. The project_label unique constraint
 * guarantees one key per Google Cloud project, so per-key counters are
 * per-project counters — exactly what Google measures.
 */
export async function recordUsage(
  keyId: string,
  model: string,
  now: Date,
  tokensEst: number,
): Promise<void> {
  const admin = createAdminClient();
  for (const kind of ["minute", "day"] as const) {
    const bucketStart = (
      kind === "minute" ? minuteBucketStart(now) : pacificMidnightUtc(now)
    ).toISOString();
    const { data } = await admin
      .from("ai_usage")
      .select("requests, tokens_est")
      .eq("key_id", keyId)
      .eq("model", model)
      .eq("bucket_start", bucketStart)
      .eq("bucket_kind", kind)
      .maybeSingle();
    const parsed = usageRowSchema.safeParse(data);

    const { error } = await admin.from("ai_usage").upsert(
      {
        key_id: keyId,
        model,
        bucket_start: bucketStart,
        bucket_kind: kind,
        requests: (parsed.success ? parsed.data.requests : 0) + 1,
        tokens_est: (parsed.success ? parsed.data.tokens_est : 0) + tokensEst,
      },
      { onConflict: "key_id,model,bucket_start,bucket_kind" },
    );
    if (error) {
      // Advisory counters must never break a chat turn.
      console.error("ai_usage upsert failed:", error.message);
    }
  }
}

async function readBucket(
  keyId: string,
  model: string,
  bucketStart: string,
  kind: "minute" | "day",
): Promise<{ requests: number; tokens_est: number }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("ai_usage")
    .select("requests, tokens_est")
    .eq("key_id", keyId)
    .eq("model", model)
    .eq("bucket_start", bucketStart)
    .eq("bucket_kind", kind)
    .maybeSingle();
  const parsed = usageRowSchema.safeParse(data);
  return parsed.success ? parsed.data : { requests: 0, tokens_est: 0 };
}

/** The current counters for one key + model, as the router projects them. */
export async function getUsage(
  keyId: string,
  model: string,
  now: Date,
): Promise<UsageSnapshot> {
  const minute = await readBucket(
    keyId,
    model,
    minuteBucketStart(now).toISOString(),
    "minute",
  );
  const day = await readBucket(
    keyId,
    model,
    pacificMidnightUtc(now).toISOString(),
    "day",
  );
  return {
    minuteRequests: minute.requests,
    minuteTokens: minute.tokens_est,
    dayRequests: day.requests,
    dayTokens: day.tokens_est,
  };
}

/**
 * Fair use (spec section 8): the sum of today's requests across all of one
 * leader's keys, compared against the daily allowance in settings. Counting
 * per owner (not per key) stops one person spreading work over several keys.
 */
export async function getOwnerDayRequests(
  ownerId: string,
  now: Date,
): Promise<number> {
  const admin = createAdminClient();
  const { data: keys } = await admin
    .from("ai_keys")
    .select("id")
    .eq("owner_id", ownerId);
  const keyIds = (keys ?? []).map((row) => row.id);
  if (keyIds.length === 0) return 0;

  const dayStart = pacificMidnightUtc(now).toISOString();
  const { data } = await admin
    .from("ai_usage")
    .select("requests")
    .in("key_id", keyIds)
    .eq("bucket_start", dayStart)
    .eq("bucket_kind", "day");
  const parsed = z
    .array(z.object({ requests: z.number().int().nonnegative() }))
    .safeParse(data ?? []);
  if (!parsed.success) return 0;
  return parsed.data.reduce((sum, row) => sum + row.requests, 0);
}
