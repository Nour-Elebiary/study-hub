import { z } from "zod";
import {
  GeminiClientError,
  GeminiServerError,
  QuotaError,
  generateGemini,
} from "@/lib/ai/gemini";
import { getOwnKeySecret } from "@/lib/ai-keys";
import { getSession } from "@/lib/dal";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const keyIdSchema = z.uuid();

/**
 * POST /api/ai/keys/[keyId]/test (spec section 8): a tiny "does this key
 * work" call — one request for the single word OK on the cheapest model.
 * The key stays on the server; the reply is only success or a plain-language
 * reason. Rate-limited like a chat call so the button cannot be spammed.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/ai/keys/[keyId]">,
) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "not signed in" }, { status: 401 });
  }

  if (!(await checkRateLimit("ai_chat", getClientIp(request.headers)))) {
    return Response.json(
      { error: "Too many checks. Please wait a minute." },
      { status: 429 },
    );
  }

  const { keyId } = await ctx.params;
  if (!keyIdSchema.safeParse(keyId).success) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  const secret = await getOwnKeySecret(session.userId, keyId);
  if (!secret) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  if (secret.status === "disabled") {
    return Response.json({
      ok: false,
      error: "This key is disabled. Enable it first (delete and re-add it).",
    });
  }

  try {
    await generateGemini({
      apiKey: secret.apiKey,
      model: "gemini-2.5-flash-lite",
      systemPrompt: "You are a connectivity test.",
      contents: [{ role: "user", text: "Reply with the single word OK." }],
    });
    return Response.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof QuotaError
        ? "The key works, but this Google project is out of free quota right now. Try again later."
        : error instanceof GeminiClientError
          ? "Google rejected this key. Check that the API key is correct and the Generative Language API is enabled for the project."
          : error instanceof GeminiServerError
            ? "Google had a temporary problem. Try again in a moment."
            : "The test could not reach Google. Check the internet connection and try again.";
    return Response.json({ ok: false, error: message });
  }
}
