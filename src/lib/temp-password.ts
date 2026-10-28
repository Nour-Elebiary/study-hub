import "server-only";
import { randomInt } from "node:crypto";

// Unambiguous characters only (no 0/O, 1/l/I) so the admin can read the
// temporary password aloud or copy it without mistakes.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

/**
 * Generates a temporary password for a new or reset leader account
 * (spec section 9). At least 10 characters per spec section 11.1; shown once
 * in the admin UI, never stored in plain text.
 */
export function generateTemporaryPassword(length = 14): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  // Guarantee at least one digit and one letter for password rules.
  chars[0] = ALPHABET[randomInt(ALPHABET.length - 10) + 10];
  return chars.join("");
}
