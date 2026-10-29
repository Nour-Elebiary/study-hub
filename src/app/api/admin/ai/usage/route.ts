import { getAiUsageOverview } from "@/lib/ai/admin";
import { getSession } from "@/lib/dal";

/**
 * GET /api/admin/ai/usage (spec section 8): every key's usage bars and
 * cooldown, the ai_limits rows and the fair-use allowance. Admins only —
 * anyone else gets 404, the same convention as the admin pages.
 */
export async function GET() {
  const session = await getSession();
  if (!session || session.profile.global_role !== "admin") {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const overview = await getAiUsageOverview();
  return Response.json(overview);
}
