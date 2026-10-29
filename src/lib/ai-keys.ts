import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { decryptApiKey, encryptApiKey, keyLast4 } from "@/lib/ai-crypto";

/**
 * The leader's own key pool (spec section 8 "Compliance first"). Each key is
 * created in that leader's own Google account and project and is used only
 * for that leader's requests — the router selects candidates by owner_id,
 * and the database enforces it a second time (RLS test 14).
 *
 * The ciphertext never passes through this module's outputs: every returned
 * row uses the masked column list, mirroring the database column grants.
 */

export type AiKey = {
  id: string;
  label: string;
  provider: string;
  key_last4: string;
  project_label: string;
  status: "active" | "cooling" | "disabled";
  cooldown_until: string | null;
  created_at: string;
};

export const addKeySchema = z.object({
  label: z.string().trim().min(1).max(60),
  project_label: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "Use letters, digits, - or _"),
  api_key: z.string().trim().min(20).max(400),
});

export type AddKeyValues = z.infer<typeof addKeySchema>;

/** The masked column list — the only shape any caller may receive. */
const MASKED_COLUMNS =
  "id, label, provider, key_last4, project_label, status, cooldown_until, created_at";

/** The signed-in leader's own keys, masked (spec section 8 endpoints). */
export async function listOwnKeys(userId: string): Promise<AiKey[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_keys")
    .select(MASKED_COLUMNS)
    .eq("owner_id", userId)
    .order("created_at");
  if (error) return [];
  return (data ?? []) as AiKey[];
}

/**
 * Adds a key for the leader. One key per Google Cloud project: a duplicate
 * project_label is refused with a plain-language message (the database
 * unique index is the backstop).
 */
export async function addOwnKey(
  userId: string,
  values: AddKeyValues,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("ai_keys")
    .select("id")
    .eq("project_label", values.project_label)
    .limit(1);
  if (existing && existing.length > 0) {
    return {
      ok: false,
      error:
        "This Google Cloud project already has a key. Google counts limits per project, so one key per project is the correct setup — add a key from a different project instead.",
    };
  }

  const { error } = await admin.from("ai_keys").insert({
    owner_id: userId,
    label: values.label,
    provider: "gemini",
    key_ciphertext: encryptApiKey(values.api_key),
    key_last4: keyLast4(values.api_key),
    project_label: values.project_label,
  });
  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error:
          "This Google Cloud project already has a key. One key per project is the correct setup.",
      };
    }
    return { ok: false, error: "The key could not be saved. Try again." };
  }

  await writeAudit({
    actorId: userId,
    action: "ai_key_added",
    entity: "ai_keys",
    meta: { project_label: values.project_label, provider: "gemini" },
  });
  return { ok: true };
}

/** Deletes the leader's own key and its ciphertext. */
export async function deleteOwnKey(
  userId: string,
  keyId: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("ai_keys")
    .delete()
    .eq("id", keyId)
    .eq("owner_id", userId)
    .select("project_label");
  const removed = (data as Array<{ project_label: string } | null>)?.[0];
  if (!removed) return false;

  await writeAudit({
    actorId: userId,
    action: "ai_key_deleted",
    entity: "ai_keys",
    entityId: keyId,
    meta: { project_label: removed.project_label },
  });
  return true;
}

/**
 * The decrypted key for the Test button — owner-filtered, service-role
 * read, decrypted only in memory on the server. Never returned to any
 * client: the endpoint that uses it only reports success or a friendly
 * error.
 */
export async function getOwnKeySecret(
  userId: string,
  keyId: string,
): Promise<{ apiKey: string; status: string } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("ai_keys")
    .select("key_ciphertext, status")
    .eq("id", keyId)
    .eq("owner_id", userId)
    .maybeSingle();
  const parsed = z
    .object({ key_ciphertext: z.string(), status: z.string() })
    .safeParse(data);
  if (!parsed.success) return null;
  const apiKey = decryptApiKey(parsed.data.key_ciphertext);
  return apiKey ? { apiKey, status: parsed.data.status } : null;
}
