import {
  SYSTEM_PROMPT,
  buildContents,
  contextTokensEst,
  getAiDailyAllowance,
  taskRequestSchema,
  verifyCourseAccess,
} from "@/lib/ai/chat";
import {
  prepareHandoff,
  renderPacketAsContext,
  type HandoffDeps,
} from "@/lib/ai/handoff";
import { estimateTokens } from "@/lib/ai/gemini";
import { productionDeps, pickCandidate, runChatTurn } from "@/lib/ai/router";
import { getOwnerDayRequests } from "@/lib/ai/usage";
import { getSession } from "@/lib/dal";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * POST /api/ai/task (spec section 8): one-shot AI task — a quick action
 * like "Clean OCR text" or "Make quiz questions". Not streamed: the reply
 * arrives as JSON the panel can show as a suggested edit (a diff the
 * leader accepts or rejects; the AI never saves on its own). Same router,
 * same fair-use gate and same handoff rules as the chat endpoint.
 */

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return errorResponse("not signed in", 401);

  if (!(await checkRateLimit("ai_chat", getClientIp(request.headers)))) {
    return errorResponse("Too many requests. Please wait a moment.", 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("bad request", 400);
  }
  const parsed = taskRequestSchema.safeParse(body);
  if (!parsed.success) return errorResponse("bad request", 400);

  const { course_id, prompt, context } = parsed.data;
  if (
    !(await verifyCourseAccess(
      session.userId,
      session.profile.global_role === "admin",
      course_id,
    ))
  ) {
    return errorResponse("not found", 404);
  }

  const allowance = await getAiDailyAllowance();
  if (allowance === 0) {
    return errorResponse(
      "AI is turned off. Ask the admin to set the daily AI allowance.",
      403,
    );
  }
  const usedToday = await getOwnerDayRequests(session.userId, new Date());
  if (usedToday >= allowance) {
    return errorResponse(
      "You have used today's AI allowance. It resets tomorrow.",
      429,
    );
  }

  const deps: HandoffDeps = {
    ...productionDeps(),
    async recordHandoff() {
      // One-shot tasks have no conversation, so a switch is not recorded —
      // there is no thread to carry over.
    },
  };

  const estTokens =
    contextTokensEst({ context, history: [], packetContext: null }) +
    estimateTokens(prompt);

  let excludeKeyIds: string[] = [];
  let packetContext: string | null = null;
  const first = await pickCandidate(deps, session.userId, estTokens, []);
  if (first?.softExceeded && context) {
    const preparation = await prepareHandoff(deps, {
      ownerId: session.userId,
      softKeyId: first.keyId,
      softKeyApi: first.apiKey,
      softKeyModel: first.model,
      excludeKeyIds: [],
      context: {
        goal: context.goal || prompt.slice(0, 200),
        task_type: context.task_type,
        language: context.language,
        context_ids: {
          course: course_id ?? "",
          area: "",
          node: context.note_id ?? "",
          assets: context.excerpts.map((excerpt) => excerpt.asset_id),
        },
        source_excerpts: context.excerpts.map((excerpt) => ({
          asset_id: excerpt.asset_id,
          text: excerpt.text.slice(0, 4_000),
        })),
      },
      runningSummary: "",
      turns: [{ role: "user", text: prompt }],
      conversationId: "",
    });
    if (preparation.switched) {
      excludeKeyIds = preparation.excludeKeyIds;
      packetContext = renderPacketAsContext(preparation.packet);
    }
  }

  const contents = buildContents({
    context,
    history: [],
    newestUserMessage: prompt,
    packetContext,
  });

  const signal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(290_000),
  ]);

  const outcome = await runChatTurn(deps, {
    ownerId: session.userId,
    systemPrompt: SYSTEM_PROMPT,
    contents,
    estTokens,
    excludeKeyIds,
    signal,
  });

  if (!outcome.ok) {
    return errorResponse(
      outcome.reason === "no_key"
        ? "Add your own Gemini key on the AI key page first."
        : "All your keys are waiting for quota right now. Try again later.",
      503,
    );
  }

  // One-shot tasks store no conversation — usage is already counted per
  // key by the router, and there is no thread to persist.
  return Response.json({
    text: outcome.text,
    switched: outcome.switched,
  });
}
