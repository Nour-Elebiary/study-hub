import "server-only";
import { z } from "zod";
import type { RouterDeps } from "./router";
import { pickCandidate, runChatTurn } from "./router";
import type { GeminiTurn } from "./gemini";
import { estimateTokens } from "./gemini";

/**
 * The handoff packet (spec section 8). The AI API is stateless, so when the
 * router must switch keys mid-conversation the context is carried over in a
 * zod-validated JSON packet, built one of two ways:
 *
 *  - Preferred: the current key still works but passed its soft threshold —
 *    spend one small call on it to produce the packet.
 *  - Fallback: the key already returned a 429 — build the packet without AI
 *    from the stored running summary, the last 4 turns and the references.
 *
 * Either way the packet has the same shape, so the next key receives the
 * same "Context so far" message and the thread continues.
 */

export const handoffPacketSchema = z.object({
  schema_version: z.literal(1),
  goal: z.string().max(500),
  task_type: z.enum([
    "summarise",
    "clean_ocr",
    "quiz",
    "glossary",
    "edit",
    "other",
  ]),
  language: z.enum(["en", "ar", "mixed"]),
  context_ids: z.object({
    course: z.string().max(100),
    area: z.string().max(100),
    node: z.string().max(100),
    assets: z.array(z.string().max(100)).max(20),
  }),
  decisions: z.array(z.string().max(300)).max(20),
  user_facts_and_preferences: z.array(z.string().max(300)).max(20),
  work_so_far: z
    .array(
      z.object({
        label: z.string().max(200),
        draft_text: z.string().max(20_000),
      }),
    )
    .max(10),
  open_questions: z.array(z.string().max(300)).max(20),
  source_excerpts: z
    .array(
      z.object({
        asset_id: z.string().max(100),
        text: z.string().max(4_000),
      }),
    )
    .max(10),
  next_step: z.string().max(500),
  last_turns: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4_000),
      }),
    )
    .max(12),
});

export type HandoffPacket = z.infer<typeof handoffPacketSchema>;

/** What the endpoint knows about the page the chat is attached to. */
export type HandoffContext = {
  goal: string;
  task_type: HandoffPacket["task_type"];
  language: HandoffPacket["language"];
  context_ids: HandoffPacket["context_ids"];
  source_excerpts: HandoffPacket["source_excerpts"];
};

export const WRAP_UP_PROMPT =
  "You are about to be replaced mid-task by another assistant. " +
  "Produce only the JSON handoff packet for this conversation, in the " +
  "given schema, so the next assistant can continue without asking the " +
  "user to repeat anything. Include unfinished drafts in full. Do not add " +
  "facts that are not in the conversation. Reply with the JSON object " +
  "only, no commentary.";

export const SUMMARY_PROMPT =
  "Summarise this conversation so far for another assistant continuing " +
  "the same task. In at most 150 words state the goal, what has been " +
  "decided, what has been done, and what remains. Output only the " +
  "summary text.";

/** The running summary refreshes every 6 turns or about 6,000 tokens. */
export const SUMMARY_REFRESH_TURNS = 6;
export const SUMMARY_REFRESH_TOKENS = 6_000;

export function shouldRefreshSummary(
  turnsSinceSummary: number,
  contextTokensEst: number,
): boolean {
  return (
    turnsSinceSummary >= SUMMARY_REFRESH_TURNS ||
    contextTokensEst >= SUMMARY_REFRESH_TOKENS
  );
}

function lastTurns(
  turns: GeminiTurn[],
  count: number,
): HandoffPacket["last_turns"] {
  return turns.slice(-count).map((turn) => ({
    // Gemini calls the assistant side "model"; the packet schema (and the
    // stored ai_messages rows) call it "assistant".
    role: turn.role === "model" ? "assistant" : turn.role,
    content: turn.text.slice(0, 4_000),
  }));
}

/** The fallback packet: no AI call, just what the database already holds. */
export function buildPacketFallback(
  context: HandoffContext,
  runningSummary: string,
  turns: GeminiTurn[],
): HandoffPacket {
  return {
    schema_version: 1,
    goal: context.goal.slice(0, 500),
    task_type: context.task_type,
    language: context.language,
    context_ids: context.context_ids,
    decisions: [],
    user_facts_and_preferences: [],
    work_so_far: runningSummary
      ? [
          {
            label: "Summary so far",
            draft_text: runningSummary.slice(0, 20_000),
          },
        ]
      : [],
    open_questions: [],
    source_excerpts: context.source_excerpts.map((excerpt) => ({
      asset_id: excerpt.asset_id.slice(0, 100),
      text: excerpt.text.slice(0, 4_000),
    })),
    next_step: "Continue the task from the recent turns below.",
    last_turns: lastTurns(turns, 4),
  };
}

/** Pulls the first JSON object out of a model reply (fences allowed). */
function extractJson(reply: string): unknown {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * The preferred packet: one small call on the current key. The model fills
 * in the task state; we overlay the fields we know are true (schema
 * version, page context, the last turns) so hallucinated ids can never
 * enter the packet. Any failure — API error, bad JSON, schema mismatch —
 * falls back to the database-built packet.
 */
export async function buildPacketWithAi(
  deps: RouterDeps,
  args: {
    apiKey: string;
    model: string;
    context: HandoffContext;
    runningSummary: string;
    turns: GeminiTurn[];
  },
): Promise<HandoffPacket> {
  const fallback = buildPacketFallback(
    args.context,
    args.runningSummary,
    args.turns,
  );
  try {
    const transcript = args.turns
      .map((turn) => `${turn.role}: ${turn.text}`)
      .join("\n")
      .slice(-12_000);
    const schemaHint =
      'The packet schema: {"schema_version":1,"goal":string,' +
      '"task_type":"summarise|clean_ocr|quiz|glossary|edit|other",' +
      '"language":"en|ar|mixed","context_ids":{"course":string,' +
      '"area":string,"node":string,"assets":string[]},' +
      '"decisions":string[],"user_facts_and_preferences":string[],' +
      '"work_so_far":[{"label":string,"draft_text":string}],' +
      '"open_questions":string[],"source_excerpts":' +
      '[{"asset_id":string,"text":string}],"next_step":string,' +
      '"last_turns":[{"role":"user|assistant","content":string}]}';
    const result = await deps.call({
      apiKey: args.apiKey,
      model: args.model,
      systemPrompt: `${WRAP_UP_PROMPT}\n\n${schemaHint}`,
      contents: [
        {
          role: "user",
          text: args.runningSummary
            ? `Summary so far: ${args.runningSummary}\n\nConversation:\n${transcript}`
            : `Conversation:\n${transcript}`,
        },
      ],
    });
    const parsed = handoffPacketSchema.safeParse(extractJson(result.text));
    if (!parsed.success) return fallback;
    return {
      ...parsed.data,
      schema_version: 1,
      context_ids: args.context.context_ids,
      last_turns: lastTurns(args.turns, 6),
    };
  } catch {
    return fallback;
  }
}

/** Renders the packet as the "Context so far" message the next key gets. */
export function renderPacketAsContext(packet: HandoffPacket): string {
  const lines: string[] = [
    "Context so far (carried over from the previous assistant):",
    `Goal: ${packet.goal}`,
    `Task type: ${packet.task_type}`,
    `Language: ${packet.language}`,
  ];
  if (packet.decisions.length > 0) {
    lines.push("Decisions already agreed:");
    for (const decision of packet.decisions) lines.push(`- ${decision}`);
  }
  if (packet.user_facts_and_preferences.length > 0) {
    lines.push("User facts and preferences:");
    for (const fact of packet.user_facts_and_preferences) {
      lines.push(`- ${fact}`);
    }
  }
  for (const work of packet.work_so_far) {
    lines.push(`Work so far — ${work.label}:`, work.draft_text);
  }
  if (packet.open_questions.length > 0) {
    lines.push("Open questions:");
    for (const question of packet.open_questions) {
      lines.push(`- ${question}`);
    }
  }
  lines.push(`Next step: ${packet.next_step}`);
  if (packet.last_turns.length > 0) {
    lines.push("Recent turns:");
    for (const turn of packet.last_turns) {
      lines.push(`${turn.role}: ${turn.content}`);
    }
  }
  return lines.join("\n");
}

export type HandoffDeps = RouterDeps & {
  recordHandoff(entry: {
    conversationId: string;
    fromKeyId: string;
    toKeyId: string;
    reason: string;
    packet: HandoffPacket;
  }): Promise<void>;
};

export type HandoffPreparation =
  | { switched: false }
  | { switched: true; excludeKeyIds: string[]; packet: HandoffPacket };

/**
 * When the chosen key has passed its soft threshold, prepare the switch:
 * build the packet on that key (preferred path; the fallback builds itself
 * on any error), find the next candidate, record the ai_handoffs row and
 * hand back the exclusion list for the real turn. If no other candidate
 * exists, the soft key is simply used — better a soft-threshold call than
 * a failed one.
 */
export async function prepareHandoff(
  deps: HandoffDeps,
  args: {
    ownerId: string;
    softKeyId: string;
    softKeyApi: string;
    softKeyModel: string;
    excludeKeyIds: string[];
    context: HandoffContext;
    runningSummary: string;
    turns: GeminiTurn[];
    conversationId: string;
  },
): Promise<HandoffPreparation> {
  const packet = await buildPacketWithAi(deps, {
    apiKey: args.softKeyApi,
    model: args.softKeyModel,
    context: args.context,
    runningSummary: args.runningSummary,
    turns: args.turns,
  });

  const next = await pickCandidate(
    deps,
    args.ownerId,
    estimateTokens(args.turns.map((turn) => turn.text).join(" ")),
    [...args.excludeKeyIds, args.softKeyId],
  );
  if (!next) return { switched: false };

  await deps.recordHandoff({
    conversationId: args.conversationId,
    fromKeyId: args.softKeyId,
    toKeyId: next.keyId,
    reason: "soft quota threshold reached",
    packet,
  });
  return {
    switched: true,
    excludeKeyIds: [...args.excludeKeyIds, args.softKeyId],
    packet,
  };
}

/**
 * The running summary refresh (spec section 8): a small call, cheapest
 * model first, through the normal router so a 429 during the refresh is
 * handled like any other call. Returns null when no key is available —
 * the summary is advisory and the conversation continues without it.
 */
export async function refreshRunningSummary(
  deps: RouterDeps,
  args: {
    ownerId: string;
    turns: GeminiTurn[];
    previousSummary: string;
  },
): Promise<string | null> {
  const contents: GeminiTurn[] = [
    ...(args.previousSummary
      ? [
          {
            role: "user" as const,
            text: `Previous summary: ${args.previousSummary}`,
          },
          { role: "model" as const, text: "Understood." },
        ]
      : []),
    {
      role: "user" as const,
      text: args.turns
        .map((turn) => `${turn.role}: ${turn.text}`)
        .join("\n")
        .slice(-12_000),
    },
  ];
  const outcome = await runChatTurn(deps, {
    ownerId: args.ownerId,
    systemPrompt: SUMMARY_PROMPT,
    contents,
    estTokens: estimateTokens(contents.map((turn) => turn.text).join(" ")),
  });
  return outcome.ok ? outcome.text : null;
}
