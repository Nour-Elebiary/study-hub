import "server-only";
import { createHmac } from "node:crypto";
import { requiredServerEnv } from "@/lib/env";

// Unambiguous characters only (no 0/O, 1/l/I) so a leader can read a code
// aloud to a class without mistakes (same alphabet as temporary passwords).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

/**
 * A new join code, formatted "XXXX-XXXX" (spec section 10 rule 1).
 * Shown once when created; only its hash is stored.
 */
export function generateJoinCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/**
 * Students may type the code with or without the dash and in any case;
 * everything but letters and digits is ignored before hashing.
 */
export function normalizeJoinCode(input: string): string {
  return input.replaceAll(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/**
 * HMAC-SHA256 of the normalized code with the join-cookie secret. The hash
 * (not the code) is what the join_codes table stores — spec section 11
 * privacy: only the hashed join code use count is kept.
 */
export function hashJoinCode(input: string): string {
  return createHmac("sha256", requiredServerEnv("JOIN_COOKIE_SECRET"))
    .update(normalizeJoinCode(input))
    .digest("hex");
}
