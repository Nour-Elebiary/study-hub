"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

const allowanceSchema = z.object({
  allowance: z.coerce.number().int().min(0).max(10_000),
});

/**
 * Sets the fair-use daily AI allowance per leader (spec section 8).
 * 0 turns AI off entirely. Admin-only; audited like every admin change.
 */
export async function setAllowanceAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const parsed = allowanceSchema.safeParse({
    allowance: formData.get("allowance"),
  });
  if (!parsed.success) return;

  const { error } = await createAdminClient()
    .from("settings")
    .update({ value: parsed.data.allowance })
    .eq("key", "ai_daily_allowance_per_leader");
  if (error) return;

  await writeAudit({
    actorId: session.userId,
    action: "ai_allowance_updated",
    entity: "settings",
    entityId: "ai_daily_allowance_per_leader",
    meta: { allowance: parsed.data.allowance },
  });
  revalidatePath("/admin/ai");
}
