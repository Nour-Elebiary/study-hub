import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { requiredServerEnv } from "@/lib/env";

/**
 * The student "session" (spec section 10 rule 1): students have no accounts.
 * A valid join code sets an httpOnly signed cookie for 90 days carrying the
 * allowed course scope. The signature is HMAC-SHA256 over the payload; the
 * server re-verifies it on every student page, so a forged cookie grants
 * nothing. The cookie value itself carries no personal data.
 */
export const STUDENT_COOKIE = "sh_student";

const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60;

/**
 * Any 8-4-4-4-12 hex UUID. Deliberately NOT z.uuid(): that also enforces the
 * RFC version and variant nibbles, and the seed data uses readable ids like
 * cccccccc-0000-cccc-0000-000000000001 which Postgres accepts but zod
 * rejects — which silently invalidated every scoped join cookie (the e2e
 * join-flow failure). These ids only ever come from our own join action and
 * are HMAC-protected, so a format check is the right strength here.
 */
const UUID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const payloadSchema = z.object({
  v: z.literal(1),
  iat: z.number().int().positive(), // issued at, unix ms
  scope: z.union([
    z.object({ all: z.literal(true) }),
    z.object({
      all: z.literal(false),
      courseIds: z.array(z.string().regex(UUID_FORMAT)).max(200),
    }),
  ]),
});

export type StudentScope = { all: true } | { all: false; courseIds: string[] };

export type StudentPayload = {
  v: 1;
  iat: number;
  scope: StudentScope;
};

/**
 * The cookie must be sent back only over the kind of connection it was set
 * on. The Secure flag follows the site's own address (APP_URL): real
 * deployments serve https, so their cookie is Secure. Local and CI run over
 * plain http, where Chrome stores a network-set Secure cookie but refuses to
 * send it back — even on 127.0.0.1 — which would break the join flow there.
 */
export function studentCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: requiredServerEnv("APP_URL").startsWith("https://"),
    path: "/",
    maxAge: NINETY_DAYS_SECONDS,
  };
}

function sign(value: string): string {
  return createHmac("sha256", requiredServerEnv("JOIN_COOKIE_SECRET"))
    .update(value)
    .digest("base64url");
}

/** payload.base64url.signature — tamper-evident, readable only server-side. */
export function signStudentCookie(payload: StudentPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

/**
 * Verifies the signature and the 90-day age. Returns null for anything
 * malformed, expired or re-signed — callers treat that as "not joined".
 */
export function verifyStudentCookie(
  value: string | undefined,
): StudentPayload | null {
  if (!value) return null;

  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const signature = value.slice(dot + 1);

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const result = payloadSchema.safeParse(parsed);
  if (!result.success) return null;

  const ageMs = Date.now() - result.data.iat;
  if (ageMs < 0 || ageMs > NINETY_DAYS_SECONDS * 1000) return null;

  return result.data;
}
