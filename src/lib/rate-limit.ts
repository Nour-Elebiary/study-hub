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
export type RateLimitPurpose = "join" | "suggest" | "login" | "ai_key";

// Spec section 10: join 5 per minute, suggestions 3 per hour per IP.
// The login limit is our choice (docs/QUESTIONS.md #11): 5 attempts per
// 15 minutes is enough for typos, tight enough to slow password guessing.
// Adding AI keys is rare and mistakes are cheap to retry later, so 5 per
// hour per IP is plenty (and slows key-stuffing attempts).
const LIMITS: Record<RateLimitPurpose, { max: number; windowSeconds: number }> =
  {
    join: { max: 5, windowSeconds: 60 },
    suggest: { max: 3, windowSeconds: 60 * 60 },
    login: { max: 5, windowSeconds: 60 * 15 },
    ai_key: { max: 5, windowSeconds: 60 * 60 },
  };

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
  const { max, windowSeconds } = LIMITS[purpose];
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
