import "server-only";
import { createHmac } from "node:crypto";
import { requiredServerEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The shared rate limiter (spec section 11 rule 5): a Postgres table and
 * function, no extra service. Every call goes through
 * public.consume_rate_limit, executed with the service-role client — the
 * function's EXECUTE is revoked from client roles, so the API alone cannot
 * touch it.
 *
 * The key stores a salted hash of the caller's IP, never the address itself
 * (spec section 11 privacy: no personal data). The purpose prefix keeps the
 * counters independent (joining, suggesting and logging in don't share a
 * window).
 */
export type RateLimitPurpose =
  | "join"
  | "suggest"
  | "login"
  | "ai_key"
  | "ai_chat"
  | "canvas_ops"
  | "canvas_create";

// Spec section 10: join 5 per minute, suggestions 3 per hour per IP.
// The login limit is our choice (docs/QUESTIONS.md #11): 5 attempts per
// 15 minutes is enough for typos, tight enough to slow password guessing.
// Adding AI keys is rare and mistakes are cheap to retry later, so 5 per
// hour per IP is plenty (and slows key-stuffing attempts). AI chat gets a
// burst cap per IP; the fair-use daily allowance per leader is the real
// control (spec section 8). Canvas ops (spec section 10, M9): 240 batches
// per minute keeps up with dragging; 20 new maps per hour per IP stops a
// runaway "generate" loop. The login and canvas limits are settings keys
// (constitution rule 8); the defaults here are the chosen spec values.
const LIMITS: Record<RateLimitPurpose, { max: number; windowSeconds: number }> =
  {
    join: { max: 5, windowSeconds: 60 },
    suggest: { max: 3, windowSeconds: 60 * 60 },
    login: { max: 5, windowSeconds: 60 * 15 },
    ai_key: { max: 5, windowSeconds: 60 * 60 },
    ai_chat: { max: 20, windowSeconds: 60 },
    canvas_ops: { max: 240, windowSeconds: 60 },
    canvas_create: { max: 20, windowSeconds: 60 * 60 },
  };

/**
 * Constitution rule 8: limits live in `settings`, not in code. The two
 * canvas purposes read their max from the settings table (defaults and
 * ranges mirror the spec values), so an admin can adjust them without a
 * deploy; every other purpose keeps its spec-mandated constant.
 */
const SETTING_LIMITS: Partial<Record<RateLimitPurpose, string>> = {
  login: "rate_login_per_15_min",
  canvas_create: "rate_canvas_create_per_hour",
  canvas_ops: "rate_canvas_ops_per_minute",
};

/** Every purpose whose max can come from settings. */
type SettingLimitedPurpose = keyof typeof SETTING_LIMITS;

/**
 * Which max applies for one canvas purpose given the raw settings value.
 * Anything unusable (missing, not an integer, below 1 — over-limit values
 * are clamped to the settings range) falls back to the spec default, so a
 * broken row can never turn a limit off. Pure: tests/unit/rate-limit.test.ts.
 */
export function settingMax(
  purpose: SettingLimitedPurpose,
  raw: string | number | null | undefined,
): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1) return null;
  const clamp =
    purpose === "canvas_ops" ? 2000 : purpose === "login" ? 100 : 500;
  return Math.min(n, clamp);
}

/** Cached settings reads: `canvas_ops` fires up to 240 times a minute. */
const SETTING_LIMIT_TTL_MS = 60_000;
let settingLimitCache: {
  at: number;
  values: Map<string, string | number | null>;
} | null = null;

/** One canvas purpose's settings max, or null for "keep the spec default". */
async function readSettingLimit(
  purpose: SettingLimitedPurpose,
): Promise<number | null> {
  const key = SETTING_LIMITS[purpose];
  if (!key) return null;
  if (
    !settingLimitCache ||
    Date.now() - settingLimitCache.at > SETTING_LIMIT_TTL_MS
  ) {
    const keys = Object.values(SETTING_LIMITS) as string[];
    const values = new Map<string, string | number | null>(
      keys.map((k) => [k, null]),
    );
    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("settings")
        .select("key, value")
        .in("key", keys);
      if (!error) {
        for (const row of data ?? []) {
          if (
            values.has(row.key) &&
            (typeof row.value === "number" || typeof row.value === "string")
          ) {
            values.set(row.key, row.value);
          }
        }
      }
    } catch {
      // Leave the defaults — the action itself must still run the limiter.
    }
    settingLimitCache = { at: Date.now(), values };
  }
  return settingMax(purpose, settingLimitCache.values.get(key) ?? null);
}

/** The caller's IP from the proxy headers Vercel sets. */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Consumes one event from the caller's window and returns whether it was
 * allowed. A false return means "show the try-again-later message".
 */
export async function checkRateLimit(
  purpose: RateLimitPurpose,
  ip: string,
): Promise<boolean> {
  const { windowSeconds } = LIMITS[purpose];
  const settingKey = SETTING_LIMITS[purpose];
  const baseMax = LIMITS[purpose].max;
  const max = settingKey
    ? ((await readSettingLimit(purpose as SettingLimitedPurpose)) ?? baseMax)
    : baseMax;
  const key = `${purpose}:${createHmac("sha256", requiredServerEnv("JOIN_COOKIE_SECRET")).update(`${purpose}:${ip}`).digest("hex")}`;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("consume_rate_limit", {
    rate_key: key,
    max_events: max,
    window_seconds: windowSeconds,
  });
  if (error) {
    // Fail closed: a broken limiter must not become an open door.
    return false;
  }
  return data === true;
}
