import "server-only";
import { z } from "zod";
import { decryptApiKey } from "@/lib/ai-crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  GeminiClientError,
  GeminiServerError,
  QuotaError,
  estimateTokens,
  generateGemini,
  streamGemini,
  type GeminiTurn,
} from "./gemini";
import { getUsage, pacificMidnightUtc, recordUsage } from "./usage";

/**
 * The key-pool router (spec section 8). Candidates are the caller's own
 * active keys crossed with the models in ai_limits, ordered cheapest first.
 * For each candidate the router projects this call against the minute and
 * day counters and picks the candidate whose worst projected ratio is
 * lowest. The counters are advisory: a real 429 cools the key down and the
 * router retries on the next candidate.
 *
 * Every dependency is injected (RouterDeps) so unit tests can simulate 429s
 * and count switches without touching the network or the database.
 */

/** Cheapest first (spec section 8 model preference). Admin-editable in ai_limits. */
export const MODEL_PREFERENCE = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
] as const;

export type RouterKey = {
  id: string;
  key_ciphertext: string;
  project_label: string;
  status: string;
  cooldown_until: string | null;
};

const routerKeySchema = z.object({
  id: z.string(),
  key_ciphertext: z.string(),
  project_label: z.string(),
  status: z.string(),
  cooldown_until: z.string().nullable(),
});

export type RouterLimits = {
  model: string;
  rpm: number;
  tpm: number;
  rpd: number;
  soft_pct: number;
};

const routerLimitsSchema = z.object({
  model: z.string(),
  rpm: z.number().int().positive(),
  tpm: z.number().int().positive(),
  rpd: z.number().int().positive(),
  soft_pct: z.number().int().min(1).max(100),
});

export type RouterCallArgs = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  contents: GeminiTurn[];
  /** When set, the call streams and forwards deltas while it runs. */
  onChunk?: (delta: string) => void;
  signal?: AbortSignal;
};

export type RouterCallResult = { text: string; tokensEst: number };

export type RouterDeps = {
  listKeys(ownerId: string): Promise<RouterKey[]>;
  getLimits(): Promise<RouterLimits[]>;
  getUsage(
    keyId: string,
    model: string,
    now: Date,
  ): Promise<{
    minuteRequests: number;
    minuteTokens: number;
    dayRequests: number;
    dayTokens: number;
  }>;
  recordUsage(
    keyId: string,
    model: string,
    now: Date,
    tokensEst: number,
  ): Promise<void>;
  coolKey(keyId: string, until: Date): Promise<void>;
  call(args: RouterCallArgs): Promise<RouterCallResult>;
  now(): Date;
};

/** Real deps: service-role database access and the Gemini REST client. */
export function productionDeps(): RouterDeps {
  return {
    async listKeys(ownerId) {
      const admin = createAdminClient();
      const { data } = await admin
        .from("ai_keys")
        .select("id, key_ciphertext, project_label, status, cooldown_until")
        .eq("owner_id", ownerId);
      const parsed = z.array(routerKeySchema).safeParse(data ?? []);
      return parsed.success ? parsed.data : [];
    },
    async getLimits() {
      const admin = createAdminClient();
      const { data } = await admin.from("ai_limits").select("*");
      const parsed = z.array(routerLimitsSchema).safeParse(data ?? []);
      return parsed.success ? parsed.data : [];
    },
    getUsage,
    recordUsage,
    async coolKey(keyId, until) {
      const admin = createAdminClient();
      await admin
        .from("ai_keys")
        .update({ status: "cooling", cooldown_until: until.toISOString() })
        .eq("id", keyId);
    },
    async call(args) {
      if (args.onChunk) {
        let text = "";
        for await (const delta of streamGemini({
          apiKey: args.apiKey,
          model: args.model,
          systemPrompt: args.systemPrompt,
          contents: args.contents,
          signal: args.signal,
        })) {
          text += delta;
          args.onChunk(delta);
        }
        return { text, tokensEst: estimateTokens(text) };
      }
      return generateGemini({
        apiKey: args.apiKey,
        model: args.model,
        systemPrompt: args.systemPrompt,
        contents: args.contents,
        signal: args.signal,
      });
    },
    now: () => new Date(),
  };
}

export type RouterChoice = {
  keyId: string;
  apiKey: string;
  model: string;
  /** True when this call would push the key past its soft threshold. */
  softExceeded: boolean;
};

function preferenceRank(model: string): number {
  const index = (MODEL_PREFERENCE as readonly string[]).indexOf(model);
  return index === -1 ? MODEL_PREFERENCE.length : index;
}

/**
 * Picks the candidate with the lowest worst-case projected ratio. Keys that
 * would cross their soft threshold are only used when nothing else remains
 * (and the caller then prepares a handoff packet — spec section 8).
 */
export async function pickCandidate(
  deps: RouterDeps,
  ownerId: string,
  estTokens: number,
  excludeKeyIds: string[] = [],
): Promise<RouterChoice | null> {
  const now = deps.now();
  const [keys, limits] = await Promise.all([
    deps.listKeys(ownerId),
    deps.getLimits(),
  ]);
  const excluded = new Set(excludeKeyIds);

  const active = keys
    .filter(
      (key) =>
        !excluded.has(key.id) &&
        key.status === "active" &&
        (!key.cooldown_until || new Date(key.cooldown_until) <= now),
    )
    .sort((a, b) => a.project_label.localeCompare(b.project_label));

  const models = [...limits]
    .filter((limit) => limit.model.length > 0)
    .sort((a, b) => preferenceRank(a.model) - preferenceRank(b.model));
  if (active.length === 0 || models.length === 0) return null;

  let best: RouterChoice | null = null;
  let bestRatio = Number.POSITIVE_INFINITY;
  let bestSoft = true;

  for (const key of active) {
    const apiKey = decryptApiKey(key.key_ciphertext);
    if (!apiKey) continue; // undecryptable (e.g. rotated ENCRYPTION_KEY): skip
    for (const limit of models) {
      const usage = await deps.getUsage(key.id, limit.model, now);
      const minuteRequestRatio = (usage.minuteRequests + 1) / limit.rpm;
      const minuteTokenRatio = (usage.minuteTokens + estTokens) / limit.tpm;
      const dayRequestRatio = (usage.dayRequests + 1) / limit.rpd;
      const worst = Math.max(
        minuteRequestRatio,
        minuteTokenRatio,
        dayRequestRatio,
      );
      const soft = worst > limit.soft_pct / 100;
      if (
        best === null ||
        (!soft && bestSoft) ||
        (soft === bestSoft && worst < bestRatio)
      ) {
        best = {
          keyId: key.id,
          apiKey,
          model: limit.model,
          softExceeded: soft,
        };
        bestRatio = worst;
        bestSoft = soft;
      }
    }
  }
  return best;
}

/**
 * Cooldown after a 429 (spec section 8). A small retryDelay (a per-minute
 * limit) cools the key for that long; a large one or a missing delay means
 * the daily allowance is gone, so the key rests until midnight Pacific.
 * The cooldown never ends before Google's own retryDelay says so.
 */
export function cooldownUntilFrom429(
  now: Date,
  retryAfterSeconds: number | null,
): Date {
  const waitUntil = (seconds: number) =>
    new Date(now.getTime() + (seconds + 5) * 1000);
  if (retryAfterSeconds === null || retryAfterSeconds > 300) {
    const midnight = pacificMidnightUtc(now);
    // Just before midnight, resting until "today's" midnight would end
    // immediately — rest into the next day instead.
    return retryAfterSeconds === null
      ? midnight <= now
        ? waitUntil(24 * 3600)
        : midnight
      : midnight > waitUntil(retryAfterSeconds)
        ? midnight
        : waitUntil(retryAfterSeconds);
  }
  return waitUntil(retryAfterSeconds);
}

export type ChatTurnOutcome =
  | {
      ok: true;
      text: string;
      keyId: string;
      model: string;
      tokensEst: number;
      /** True when this turn ran on a different key than the first choice. */
      switched: boolean;
    }
  | { ok: false; reason: "no_key" | "waiting_quota" };

export type ChatTurnOptions = {
  ownerId: string;
  systemPrompt: string;
  /** The full turn list, newest user message last. */
  contents: GeminiTurn[];
  estTokens: number;
  /** Keys already handed off away from earlier in this request. */
  excludeKeyIds?: string[];
  onChunk?: (delta: string) => void;
  signal?: AbortSignal;
};

/**
 * Runs one chat turn across the key pool: pick → call → on a 429 cool the
 * key and retry the next candidate; on a server error retry the same key
 * once, then move on; on a client error (bad key) move on without cooling.
 * If the stream already emitted text, an error propagates — retrying would
 * duplicate what the user already saw.
 */
export async function runChatTurn(
  deps: RouterDeps,
  options: ChatTurnOptions,
): Promise<ChatTurnOutcome> {
  const exclude = [...(options.excludeKeyIds ?? [])];

  while (true) {
    const choice = await pickCandidate(
      deps,
      options.ownerId,
      options.estTokens,
      exclude,
    );
    if (!choice) {
      return {
        ok: false,
        reason: exclude.length > 0 ? "waiting_quota" : "no_key",
      };
    }

    let emitted = false;
    const callArgs: RouterCallArgs = {
      apiKey: choice.apiKey,
      model: choice.model,
      systemPrompt: options.systemPrompt,
      contents: options.contents,
      signal: options.signal,
      onChunk: options.onChunk
        ? (delta) => {
            emitted = true;
            options.onChunk?.(delta);
          }
        : undefined,
    };

    try {
      const result = await deps.call(callArgs);
      await deps.recordUsage(
        choice.keyId,
        choice.model,
        deps.now(),
        result.tokensEst,
      );
      return {
        ok: true,
        text: result.text,
        keyId: choice.keyId,
        model: choice.model,
        tokensEst: result.tokensEst,
        switched: exclude.length > 0,
      };
    } catch (error) {
      if (emitted) throw error;
      if (error instanceof QuotaError) {
        await deps.coolKey(
          choice.keyId,
          cooldownUntilFrom429(deps.now(), error.retryAfterSeconds),
        );
        exclude.push(choice.keyId);
        continue;
      }
      if (error instanceof GeminiServerError) {
        // One retry on the same key, then give up on it.
        let emittedRetry = false;
        try {
          const result = await deps.call({
            ...callArgs,
            onChunk: callArgs.onChunk
              ? (delta) => {
                  emittedRetry = true;
                  callArgs.onChunk?.(delta);
                }
              : undefined,
          });
          await deps.recordUsage(
            choice.keyId,
            choice.model,
            deps.now(),
            result.tokensEst,
          );
          return {
            ok: true,
            text: result.text,
            keyId: choice.keyId,
            model: choice.model,
            tokensEst: result.tokensEst,
            switched: exclude.length > 0,
          };
        } catch (retryError) {
          if (emittedRetry) throw retryError;
          exclude.push(choice.keyId);
          continue;
        }
      }
      if (error instanceof GeminiClientError) {
        // Bad key or bad request: cooling down will not help. Move on.
        exclude.push(choice.keyId);
        continue;
      }
      throw error;
    }
  }
}
