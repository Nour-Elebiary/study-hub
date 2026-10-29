import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Backup authentication (spec section 11 rule 2). The scheduled GitHub
 * Actions job holds a raw BACKUP_TOKEN as a repository secret; the server
 * stores only its SHA-256 hash in BACKUP_TOKEN_HASH. Same fail-closed rule
 * as the worker token: with no hash configured, machine exports are off and
 * only a signed-in admin can export.
 */
export function verifyBackupToken(authHeader: string | null): boolean {
  const expected = process.env.BACKUP_TOKEN_HASH;
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
