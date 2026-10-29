import { z } from "zod";
import { getSession } from "@/lib/dal";
import { deleteOwnKey, listOwnKeys } from "@/lib/ai-keys";

const keyIdSchema = z.uuid();

/**
 * DELETE /api/ai/keys/[keyId] — removes the leader's own key and its
 * ciphertext (spec section 8). Another leader's key id is simply not found:
 * the delete is filtered by owner_id and audited only when a row goes.
 */
export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/ai/keys/[keyId]">,
) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "not signed in" }, { status: 401 });
  }

  const { keyId } = await ctx.params;
  if (!keyIdSchema.safeParse(keyId).success) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  const ok = await deleteOwnKey(session.userId, keyId);
  if (!ok) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const keys = await listOwnKeys(session.userId);
  return Response.json({ keys });
}
