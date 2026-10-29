import { z } from "zod";
import { aiLimitsUpdateSchema, updateAiLimits } from "@/lib/ai/admin";
import { checkRecentLogin } from "@/lib/admin-auth";
import { getSession } from "@/lib/dal";

const bodySchema = aiLimitsUpdateSchema.extend({ password: z.string() });

/**
 * PUT /api/admin/ai/limits (spec section 8): the admin edits the per-model
 * quota numbers when Google changes the free tier. Editing limits is a
 * sensitive action, so a login older than 10 minutes needs the admin's
 * password again (spec section 9 rule 1). Admins only; anyone else 404.
 */
export async function PUT(request: Request) {
  const session = await getSession();
  if (!session || session.profile.global_role !== "admin") {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  const login = await checkRecentLogin(parsed.data.password || undefined);
  if (!login.ok) {
    return Response.json(
      { error: "Please confirm your password.", needsPassword: true },
      { status: 401 },
    );
  }

  const result = await updateAiLimits(session.userId, parsed.data.rows);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 500 });
  }
  return Response.json({ ok: true });
}
