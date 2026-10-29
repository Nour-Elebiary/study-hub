import { getSession } from "@/lib/dal";
import { addKeySchema, addOwnKey, listOwnKeys } from "@/lib/ai-keys";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * GET /api/ai/keys — the signed-in leader's own keys, masked
 * (spec section 8). The response can never contain a ciphertext: the
 * database column grant omits it and listOwnKeys selects the masked
 * columns only. No session → 401, never a key.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "not signed in" }, { status: 401 });
  }
  const keys = await listOwnKeys(session.userId);
  return Response.json({ keys });
}

/**
 * POST /api/ai/keys — add the leader's own key (spec section 8 "Adding a
 * key"). The key is encrypted at rest before it touches the database and
 * only its last 4 characters are ever echoed back.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "not signed in" }, { status: 401 });
  }

  if (!(await checkRateLimit("ai_key", getClientIp(request.headers)))) {
    return Response.json(
      { error: "Too many attempts. Please try again in an hour." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const parsed = addKeySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Please check the label, project name and key." },
      { status: 400 },
    );
  }

  const result = await addOwnKey(session.userId, parsed.data);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  const keys = await listOwnKeys(session.userId);
  return Response.json({ keys }, { status: 201 });
}
