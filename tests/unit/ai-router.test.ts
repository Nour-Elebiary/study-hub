import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  GeminiClientError,
  GeminiServerError,
  QuotaError,
} from "@/lib/ai/gemini";
import {
  cooldownUntilFrom429,
  pickCandidate,
  runChatTurn,
} from "@/lib/ai/router";
import {
  EMPTY_USAGE,
  OWNER,
  OTHER,
  makeRouterDeps,
  type Usage,
} from "./helpers/router-deps";

// A throwaway key for the test run only — generated, never stored.
beforeAll(() => {
  process.env.ENCRYPTION_KEY = Buffer.from(randomBytes(32)).toString("base64");
});

const CONTENTS = [{ role: "user" as const, text: "hello" }];

describe("runChatTurn", () => {
  it("returns no_key when the owner has no keys", async () => {
    const deps = makeRouterDeps({ keys: [] });
    const outcome = await runChatTurn(deps, {
      ownerId: OWNER,
      systemPrompt: "s",
      contents: CONTENTS,
      estTokens: 10,
    });
    expect(outcome).toEqual({ ok: false, reason: "no_key" });
  });

  it("never uses another leader's key", async () => {
    const deps = makeRouterDeps({
      keys: [{ key: "k9-other", plain: "foreign-key", owner: OTHER }],
    });
    const outcome = await runChatTurn(deps, {
      ownerId: OWNER,
      systemPrompt: "s",
      contents: CONTENTS,
      estTokens: 10,
    });
    expect(outcome).toEqual({ ok: false, reason: "no_key" });
    expect(deps.calls).toHaveLength(0);
  });

  it("cools a 429 key and switches to the next candidate", async () => {
    const deps = makeRouterDeps({
      keys: [
        { key: "k1-a", plain: "key-one", owner: OWNER },
        { key: "k2-b", plain: "key-two", owner: OWNER },
      ],
      behaviour: (apiKey) =>
        apiKey === "key-one"
          ? new QuotaError("quota", 25)
          : { text: "from key two" },
    });
    const outcome = await runChatTurn(deps, {
      ownerId: OWNER,
      systemPrompt: "s",
      contents: CONTENTS,
      estTokens: 10,
    });
    expect(outcome).toEqual({
      ok: true,
      text: "from key two",
      keyId: "k2-b",
      model: "gemini-2.5-flash-lite",
      tokensEst: 10,
      switched: true,
    });
    expect(deps.cooled).toEqual([
      { keyId: "k1-a", until: new Date("2026-06-15T10:00:30Z") },
    ]);
    expect(deps.calls.map((c) => c.apiKey)).toEqual(["key-one", "key-two"]);
  });

  it("reports waiting_quota when every key was excluded after failures", async () => {
    const deps = makeRouterDeps({
      keys: [{ key: "k1-a", plain: "key-one", owner: OWNER }],
      behaviour: () => new QuotaError("quota", 25),
    });
    const outcome = await runChatTurn(deps, {
      ownerId: OWNER,
      systemPrompt: "s",
      contents: CONTENTS,
      estTokens: 10,
    });
    expect(outcome).toEqual({ ok: false, reason: "waiting_quota" });
    expect(deps.cooled).toHaveLength(1);
  });

  it("retries a server error once on the same key, then moves on", async () => {
    const deps = makeRouterDeps({
      keys: [
        { key: "k1-a", plain: "key-one", owner: OWNER },
        { key: "k2-b", plain: "key-two", owner: OWNER },
      ],
      behaviour: (apiKey, attempt) =>
        apiKey === "key-one" && attempt <= 2
          ? new GeminiServerError("boom")
          : { text: `reply from ${apiKey}` },
    });
    const outcome = await runChatTurn(deps, {
      ownerId: OWNER,
      systemPrompt: "s",
      contents: CONTENTS,
      estTokens: 10,
    });
    expect(outcome).toEqual({
      ok: true,
      text: "reply from key-two",
      keyId: "k2-b",
      model: "gemini-2.5-flash-lite",
      tokensEst: 10,
      switched: true,
    });
    // key-one was called twice (the same-key retry), key-two once.
    expect(deps.calls.map((c) => c.apiKey)).toEqual([
      "key-one",
      "key-one",
      "key-two",
    ]);
    // A server error never cools the key.
    expect(deps.cooled).toHaveLength(0);
  });

  it("moves on after a client error without cooling the key", async () => {
    const deps = makeRouterDeps({
      keys: [
        { key: "k1-a", plain: "key-one", owner: OWNER },
        { key: "k2-b", plain: "key-two", owner: OWNER },
      ],
      behaviour: (apiKey) =>
        apiKey === "key-one"
          ? new GeminiClientError("API key not valid")
          : { text: "fine" },
    });
    const outcome = await runChatTurn(deps, {
      ownerId: OWNER,
      systemPrompt: "s",
      contents: CONTENTS,
      estTokens: 10,
    });
    expect(outcome).toEqual({
      ok: true,
      text: "fine",
      keyId: "k2-b",
      model: "gemini-2.5-flash-lite",
      tokensEst: 10,
      switched: true,
    });
    expect(deps.calls.map((c) => c.apiKey)).toEqual(["key-one", "key-two"]);
    expect(deps.cooled).toHaveLength(0);
  });
});

describe("pickCandidate soft thresholds", () => {
  it("prefers a key below its soft threshold over a closer-ratio soft key", async () => {
    const usage: Record<string, Usage> = {
      // "k2-soft" is at 190/200 day requests (95% > 80% soft). "k1-near"
      // has a worse minute ratio but stays under its soft threshold.
      "k2-soft:gemini-2.5-flash-lite": {
        minuteRequests: 0,
        minuteTokens: 0,
        dayRequests: 190,
        dayTokens: 0,
      },
      "k1-near:gemini-2.5-flash-lite": {
        minuteRequests: 5,
        minuteTokens: 0,
        dayRequests: 0,
        dayTokens: 0,
      },
    };
    const deps = makeRouterDeps({
      keys: [
        { key: "k2-soft", plain: "key-soft", owner: OWNER },
        { key: "k1-near", plain: "key-near", owner: OWNER },
      ],
      usage,
    });
    const choice = await pickCandidate(deps, OWNER, 10, []);
    expect(choice?.keyId).toBe("k1-near");
    expect(choice?.softExceeded).toBe(false);
  });

  it("falls back to a soft key when nothing else remains", async () => {
    const usage: Record<string, Usage> = {
      "k1-only:gemini-2.5-flash-lite": {
        ...EMPTY_USAGE,
        dayRequests: 190,
      },
    };
    const deps = makeRouterDeps({
      keys: [{ key: "k1-only", plain: "key-only", owner: OWNER }],
      usage,
    });
    const choice = await pickCandidate(deps, OWNER, 10, []);
    expect(choice?.keyId).toBe("k1-only");
    expect(choice?.softExceeded).toBe(true);
  });

  it("skips keys whose cooldown has not ended", async () => {
    const deps = makeRouterDeps({
      keys: [{ key: "k1-cool", plain: "key-cooling", owner: OWNER }],
      behaviour: () => new QuotaError("quota", 25),
    });
    // The 429 cools the key in the fake state (like the real database
    // update), until 10:00:30Z — after `now` (10:00:00Z).
    await runChatTurn(deps, {
      ownerId: OWNER,
      systemPrompt: "s",
      contents: CONTENTS,
      estTokens: 10,
    });
    expect(deps.cooled).toHaveLength(1);
    const choice = await pickCandidate(deps, OWNER, 10, []);
    expect(choice).toBeNull();
  });
});

describe("cooldownUntilFrom429", () => {
  // 10:00 UTC = 3 a.m. Pacific daylight time (UTC-7): today's midnight
  // Pacific was 07:00 UTC, three hours ago.
  const now = new Date("2026-06-15T10:00:00Z");

  it("waits retryDelay plus 5 seconds for a small per-minute limit", () => {
    expect(cooldownUntilFrom429(now, 25)).toEqual(
      new Date("2026-06-15T10:00:30Z"),
    );
  });

  it("rests until the next midnight Pacific when the delay is missing", () => {
    expect(cooldownUntilFrom429(now, null)).toEqual(
      new Date("2026-06-16T07:00:00Z"),
    );
  });

  it("rests until the next midnight Pacific when the delay is large", () => {
    expect(cooldownUntilFrom429(now, 4_000)).toEqual(
      new Date("2026-06-16T07:00:00Z"),
    );
  });

  it("respects a large retryDelay that reaches past midnight", () => {
    // 30 hours from 04:00 UTC is past tomorrow's midnight — the explicit
    // delay wins.
    const later = new Date("2026-06-15T04:00:00Z");
    expect(cooldownUntilFrom429(later, 30 * 3600)).toEqual(
      new Date("2026-06-16T10:00:05Z"),
    );
  });

  it("rests into the next day when midnight has just passed", () => {
    const atMidnight = new Date("2026-06-15T07:00:00Z");
    expect(cooldownUntilFrom429(atMidnight, null)).toEqual(
      new Date("2026-06-16T07:00:00Z"),
    );
  });
});
