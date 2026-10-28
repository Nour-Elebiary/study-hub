import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Writes one audit row from the server (spec section 9, security rule 3:
 * "Every admin action writes to audit_log from the server").
 * There is deliberately no client-side insert policy on audit_log.
 */
export async function writeAudit(entry: {
  actorId: string;
  action: string;
  entity: string;
  entityId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("audit_log").insert({
    actor_id: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId ?? null,
    meta: entry.meta ?? {},
  });
  if (error) {
    // Audit failures must not be silent, but they also must not crash the
    // user flow with a raw database error — surface a safe message.
    console.error("audit_log insert failed:", error.message);
    throw new Error(
      "Could not record the audit entry. The action was aborted.",
    );
  }
}
