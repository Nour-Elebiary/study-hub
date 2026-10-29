import { encryptApiKey } from "@/lib/ai-crypto";
import type { RouterDeps, RouterKey } from "@/lib/ai/router";

/**
 * Shared fake router dependencies for the AI unit tests: no network, no
 * database. `behaviour` maps a plaintext api key (so tests can tell keys
 * apart) to what each call does — return text, or throw. The first call to
 * a key is attempt 1, the second attempt 2. The fake listKeys mirrors the
 * production query by returning only the caller's own keys.
 */

export const OWNER = "11111111-1111-4111-8111-111111111111";
export const OTHER = "22222222-2222-4222-8222-222222222222";

export type Usage = {
  minuteRequests: number;
  minuteTokens: number;
  dayRequests: number;
  dayTokens: number;
};

export const EMPTY_USAGE: Usage = {
  minuteRequests: 0,
  minuteTokens: 0,
  dayRequests: 0,
  dayTokens: 0,
};

export function makeKey(id: string, plain: string): RouterKey {
  return {
    id,
    key_ciphertext: encryptApiKey(plain),
    project_label: `project-${id}`,
    status: "active",
    cooldown_until: null,
  };
}

export type RouterTestDeps = RouterDeps & {
  calls: Array<{ apiKey: string; model: string }>;
  cooled: Array<{ keyId: string; until: Date }>;
};

export function makeRouterDeps(args: {
  keys?: Array<{ key: string; plain: string; owner: string }>;
  usage?: Record<string, Usage>;
  behaviour?: (apiKey: string, attempt: number) => { text: string } | Error;
  now?: Date;
}): RouterTestDeps {
  const calls: RouterTestDeps["calls"] = [];
  const cooled: RouterTestDeps["cooled"] = [];
  const attempts = new Map<string, number>();
  const keysById = new Map(
    (args.keys ?? []).map((entry) => [
      entry.key,
      makeKey(entry.key, entry.plain),
    ]),
  );
  const ownerByKey = new Map(
    (args.keys ?? []).map((entry) => [entry.key, entry.owner]),
  );

  const deps: RouterTestDeps = {
    calls,
    cooled,
    async listKeys(ownerId) {
      return [...keysById.entries()]
        .filter(([id]) => ownerByKey.get(id) === ownerId)
        .map(([, key]) => key);
    },
    async getLimits() {
      return [
        {
          model: "gemini-2.5-flash-lite",
          rpm: 10,
          tpm: 200_000,
          rpd: 200,
          soft_pct: 80,
        },
      ];
    },
    async getUsage(keyId, model) {
      return args.usage?.[`${keyId}:${model}`] ?? EMPTY_USAGE;
    },
    async recordUsage() {},
    async coolKey(keyId, until) {
      cooled.push({ keyId, until });
      // Mutate the fake state, like the real database update would.
      const key = keysById.get(keyId);
      if (key) {
        key.status = "cooling";
        key.cooldown_until = until.toISOString();
      }
    },
    async call(callArgs) {
      calls.push({ apiKey: callArgs.apiKey, model: callArgs.model });
      const attempt = (attempts.get(callArgs.apiKey) ?? 0) + 1;
      attempts.set(callArgs.apiKey, attempt);
      const outcome = args.behaviour?.(callArgs.apiKey, attempt) ?? {
        text: "reply",
      };
      if (outcome instanceof Error) throw outcome;
      return { text: outcome.text, tokensEst: 10 };
    },
    now: () => args.now ?? new Date("2026-06-15T10:00:00Z"),
  };
  return deps;
}
