import {
  SYSTEM_PROMPT,
  buildContents,
  contextTokensEst,
  countMessages,
  getAiDailyAllowance,
  getOrCreateConversation,
  insertMessage,
  loadRecentTurns,
  resolveExcerpts,
  saveRunningSummary,
  toGeminiTurns,
  verifyCourseAccess,
  chatRequestSchema,
} from "@/lib/ai/chat";
import {
  prepareHandoff,
  refreshRunningSummary,
  renderPacketAsContext,
  shouldRefreshSummary,
  type HandoffDeps,
} from "@/lib/ai/handoff";
import { estimateTokens } from "@/lib/ai/gemini";
import { productionDeps, pickCandidate, runChatTurn } from "@/lib/ai/router";
import { getOwnerDayRequests } from "@/lib/ai/usage";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/dal";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * POST /api/ai/chat (spec section 8): streams the assistant's reply as
 * server-sent events and handles client abort. The whole turn must finish
 * inside Vercel's 300-second function limit, so the call is aborted just
 * before that. The router picks the leader's own key; a forced switch
 * streams a status event ("Switched assistant, context carried over") and
 * records the ai_handoffs row.
 */

const FUNCTION_BUDGET_MS = 290_000;

function sseChunk(event: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return errorResponse("not signed in", 401);

  if (!(await checkRateLimit("ai_chat", getClientIp(request.headers)))) {
    return errorResponse("Too many messages. Please wait a moment.", 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("bad request", 400);
  }
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) return errorResponse("bad request", 400);

  const { conversation_id, course_id, message, context } = parsed.data;
  if (
    !(await verifyCourseAccess(
      session.userId,
      session.profile.global_role === "admin",
      course_id,
    ))
  ) {
    return errorResponse("not found", 404);
  }

  // The ai_allowed gate (spec section 8): a request that attaches an asset
  // not marked for AI use is refused outright.
  const resolved = await resolveExcerpts(course_id, context?.excerpts ?? []);
  if (!resolved.ok) {
    return errorResponse(
      "This file is not marked for AI use. Change the file's AI setting first.",
      403,
    );
  }
  const effectiveContext = context
    ? { ...context, excerpts: resolved.excerpts }
    : undefined;

  // Fair use (spec section 8): the daily allowance lives in settings and
  // 0 means AI is off. Counted across all of the leader's keys.
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

  const conversation = await getOrCreateConversation(
    session.userId,
    conversation_id,
    effectiveContext?.note_id ?? null,
  );
  if (!conversation) {
    return errorResponse("The conversation could not be started.", 500);
  }

  const history = await loadRecentTurns(conversation.id);
  await insertMessage({
    conversation_id: conversation.id,
    role: "user",
    content: message,
  });

  const deps: HandoffDeps = {
    ...productionDeps(),
    async recordHandoff(entry) {
      await createAdminClient().from("ai_handoffs").insert({
        conversation_id: entry.conversationId,
        from_key_id: entry.fromKeyId,
        to_key_id: entry.toKeyId,
        reason: entry.reason,
        packet: entry.packet,
      });
    },
  };

  const estTokens =
    contextTokensEst({
      context: effectiveContext,
      history: toGeminiTurns(history),
      packetContext: null,
    }) + estimateTokens(message);

  // Handoff preparation (spec section 8): when the best candidate has
  // passed its soft threshold, carry the context over before the real call.
  let excludeKeyIds: string[] = [];
  let packetContext: string | null = null;
  const first = await pickCandidate(deps, session.userId, estTokens, []);
  if (first?.softExceeded && effectiveContext) {
    const preparation = await prepareHandoff(deps, {
      ownerId: session.userId,
      softKeyId: first.keyId,
      softKeyApi: first.apiKey,
      softKeyModel: first.model,
      excludeKeyIds: [],
      context: {
        goal:
          effectiveContext.goal ||
          `Help with "${effectiveContext.note_title || "this note"}"`,
        task_type: effectiveContext.task_type,
        language: effectiveContext.language,
        context_ids: {
          course: course_id ?? "",
          area: "",
          node: effectiveContext.note_id ?? "",
          assets: effectiveContext.excerpts.map((excerpt) => excerpt.asset_id),
        },
        source_excerpts: effectiveContext.excerpts.map((excerpt) => ({
          asset_id: excerpt.asset_id,
          text: excerpt.text.slice(0, 4_000),
        })),
      },
      runningSummary: conversation.running_summary,
      turns: [...toGeminiTurns(history), { role: "user", text: message }],
      conversationId: conversation.id,
    });
    if (preparation.switched) {
      excludeKeyIds = preparation.excludeKeyIds;
      packetContext = renderPacketAsContext(preparation.packet);
    }
  }

  const contents = buildContents({
    context: effectiveContext,
    history: toGeminiTurns(history),
    newestUserMessage: message,
    packetContext,
  });

  const signal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(FUNCTION_BUDGET_MS),
  ]);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(sseChunk(event));
      try {
        send({
          type: "start",
          conversation_id: conversation.id,
          switched: packetContext !== null,
        });

        const outcome = await runChatTurn(deps, {
          ownerId: session.userId,
          systemPrompt: SYSTEM_PROMPT,
          contents,
          estTokens,
          excludeKeyIds,
          signal,
          onChunk: (delta) => send({ type: "delta", text: delta }),
        });

        if (!outcome.ok) {
          send({
            type: "error",
            message:
              outcome.reason === "no_key"
                ? "Add your own Gemini key on the AI key page first."
                : "All your keys are waiting for quota right now. Try again later.",
          });
          controller.close();
          return;
        }

        const messageId = await insertMessage({
          conversation_id: conversation.id,
          role: "assistant",
          content: outcome.text,
          key_id: outcome.keyId,
          model: outcome.model,
          tokens_est: outcome.tokensEst,
        });

        // Running summary refresh (spec section 8): every 6 turns or about
        // 6,000 tokens, cheapest model, through the normal router.
        const totalTurns = await countMessages(conversation.id);
        if (
          shouldRefreshSummary(
            totalTurns - conversation.summary_upto_msg,
            estTokens + outcome.tokensEst,
          )
        ) {
          const summary = await refreshRunningSummary(deps, {
            ownerId: session.userId,
            turns: [...contents, { role: "model", text: outcome.text }],
            previousSummary: conversation.running_summary,
          });
          if (summary) {
            await saveRunningSummary(conversation.id, summary, totalTurns);
          }
        }

        send({
          type: "done",
          conversation_id: conversation.id,
          message_id: messageId,
          switched: outcome.switched,
        });
      } catch (error) {
        if (request.signal.aborted) {
          // The leader closed the panel or navigated away — stop quietly.
        } else {
          console.error(
            "ai chat failed:",
            error instanceof Error ? error.message : error,
          );
          send({
            type: "error",
            message: "The assistant could not answer. Please try again.",
          });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
