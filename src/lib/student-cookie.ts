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

const payloadSchema = z.object({
  v: z.literal(1),
  iat: z.number().int().positive(), // issued at, unix ms
  scope: z.union([
    z.object({ all: z.literal(true) }),
    z.object({
      all: z.literal(false),
      courseIds: z.array(z.uuid()).max(200),
    }),
  ]),
});

export type StudentScope = { all: true } | { all: false; courseIds: string[] };

export type StudentPayload = {
  v: 1;
  iat: number;
  scope: StudentScope;
};

export const studentCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: NINETY_DAYS_SECONDS,
};

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
