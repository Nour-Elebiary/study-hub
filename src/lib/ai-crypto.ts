import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requiredServerEnv } from "@/lib/env";

/**
 * AES-256-GCM encryption for AI API keys at rest (spec section 5 rule 3).
 * The ciphertext is decrypted only inside the AI router and its test call —
 * never logged, never returned by any endpoint. Storage format:
 * base64( 12-byte IV || 16-byte auth tag || ciphertext ).
 */
function encryptionKey(): Buffer {
  const raw = Buffer.from(requiredServerEnv("ENCRYPTION_KEY"), "base64");
  if (raw.length !== 32) {
    throw new Error(
      "ENCRYPTION_KEY must be 32 base64-decoded bytes. Generate one with: openssl rand -base64 32",
    );
  }
  return raw;
}

export function encryptApiKey(plainKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plainKey, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/** Returns null for a missing, tampered or wrongly-keyed ciphertext. */
export function decryptApiKey(ciphertext: string): string | null {
  try {
    const blob = Buffer.from(ciphertext, "base64");
    if (blob.length < 12 + 16 + 1) return null;
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const encrypted = blob.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** The only part of a key any UI may ever show (spec section 5 rule 3). */
export function keyLast4(plainKey: string): string {
  return plainKey.slice(-4);
}
