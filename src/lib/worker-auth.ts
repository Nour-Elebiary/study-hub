import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Worker authentication (spec section 7 rule 5). The worker holds a raw
 * WORKER_TOKEN on its own PC; the server stores only its SHA-256 hash in
 * the WORKER_TOKEN_HASH environment variable. No Supabase key ever reaches
 * the worker. If the hash is not configured, the worker API is switched
 * off — requests fail closed.
 */
export function verifyWorkerToken(authHeader: string | null): boolean {
  const expected = process.env.WORKER_TOKEN_HASH;
  if (!expected) return false;

  const token =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;
  if (!token) return false;

  const presented = createHash("sha256").update(token).digest();
  let expectedBytes: Buffer;
  try {
    expectedBytes = Buffer.from(expected, "hex");
  } catch {
    return false;
  }
  if (expectedBytes.length !== presented.length) return false;
  return timingSafeEqual(presented, expectedBytes);
}
