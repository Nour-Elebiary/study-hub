import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { GeminiTurn } from "@/lib/ai/gemini";
import {
  buildPacketFallback,
  buildPacketWithAi,
  prepareHandoff,
  renderPacketAsContext,
  shouldRefreshSummary,
  type HandoffContext,
} from "@/lib/ai/handoff";
import type { RouterDeps } from "@/lib/ai/router";
import { resolveExcerpts } from "@/lib/ai/chat";
import { OWNER, makeRouterDeps } from "./helpers/router-deps";

// A throwaway key for the test run only — generated, never stored.
beforeAll(() => {
  process.env.ENCRYPTION_KEY = Buffer.from(randomBytes(32)).toString("base64");
});

/** The golden 12-turn conversation: six user/model pairs. */
function goldenTurns(): GeminiTurn[] {
  const turns: GeminiTurn[] = [];
  for (let i = 1; i <= 6; i++) {
    turns.push({ role: "user", text: `user turn ${i}` });
    turns.push({ role: "model", text: `assistant turn ${i}` });
  }
  return turns;
}

const CONTEXT: HandoffContext = {
  goal: "Clean the scanned worksheet",
  task_type: "clean_ocr",
  language: "en",
  context_ids: {
    course: "cccccccc-0000-4000-8000-000000000001",
    area: "reading",
    node: "nnnnnnnn-0000-4000-8000-000000000001",
    assets: ["aaaaaaaa-0000-4000-8000-000000000001"],
  },
  source_excerpts: [
    { asset_id: "aaaaaaaa-0000-4000-8000-000000000001", text: "OCR text…" },
  ],
};

/** A packet the model might reply with — including one hallucinated id. */
const MODEL_PACKET = {
  schema_version: 1,
  goal: "Clean the scanned worksheet",
  task_type: "clean_ocr",
  language: "en",
  context_ids: {
    course: "HALLUCINATED-COURSE-ID",
    area: "HALLUCINATED",
    node: "HALLUCINATED",
    assets: ["HALLUCINATED-ASSET"],
  },
  decisions: ["Keep the original wording"],
  user_facts_and_preferences: ["Leader prefers British spelling"],
  work_so_far: [
    { label: "Cleaned draft", draft_text: "# Worksheet\n\nCleaned text" },
  ],
  open_questions: ["Should the header stay uppercase?"],
  source_excerpts: [],
  next_step: "Review the cleaned draft with the leader",
  last_turns: [{ role: "assistant" as const, content: "HALLUCINATED" }],
};

function packetJsonDeps(): RouterDeps {
  return makeRouterDeps({
    behaviour: () => ({
      text: "Here is the packet:\n" + JSON.stringify(MODEL_PACKET),
    }),
  });
}

describe("buildPacketWithAi (preferred path)", () => {
  it("overlays trusted fields so hallucinated ids cannot enter", async () => {
    const deps = packetJsonDeps();
    const packet = await buildPacketWithAi(deps, {
      apiKey: "key-soft",
      model: "gemini-2.5-flash-lite",
      context: CONTEXT,
      runningSummary: "",
      turns: goldenTurns(),
    });

    // Trusted fields come from the app, never from the model.
    expect(packet.schema_version).toBe(1);
    expect(packet.context_ids).toEqual(CONTEXT.context_ids);
    // The stored last turns win, mapped model → assistant, newest last.
    expect(packet.last_turns).toHaveLength(6);
    expect(packet.last_turns[0]).toEqual({
      role: "user",
      content: "user turn 4",
    });
    expect(packet.last_turns[5]).toEqual({
      role: "assistant",
      content: "assistant turn 6",
    });
    // The model's genuine contributions survive.
    expect(packet.decisions).toEqual(["Keep the original wording"]);
    expect(packet.work_so_far).toEqual(MODEL_PACKET.work_so_far);
    expect(packet.next_step).toBe("Review the cleaned draft with the leader");
  });

  it("falls back to the database packet when the model call fails", async () => {
    const deps = makeRouterDeps({
      behaviour: () => new Error("quota gone mid-call"),
    });
    const packet = await buildPacketWithAi(deps, {
      apiKey: "key-soft",
      model: "gemini-2.5-flash-lite",
      context: CONTEXT,
      runningSummary: "We agreed to clean the OCR and started.",
      turns: goldenTurns(),
    });

    expect(packet.schema_version).toBe(1);
    expect(packet.context_ids).toEqual(CONTEXT.context_ids);
    expect(packet.work_so_far).toEqual([
      {
        label: "Summary so far",
        draft_text: "We agreed to clean the OCR and started.",
      },
    ]);
    // The fallback keeps the last 4 turns.
    expect(packet.last_turns).toHaveLength(4);
    expect(packet.last_turns[3]).toEqual({
      role: "assistant",
      content: "assistant turn 6",
    });
  });

  it("falls back when the model reply is not valid packet JSON", async () => {
    const deps = makeRouterDeps({
      behaviour: () => ({ text: "I cannot do that, sorry." }),
    });
    const packet = await buildPacketWithAi(deps, {
      apiKey: "key-soft",
      model: "gemini-2.5-flash-lite",
      context: CONTEXT,
      runningSummary: "",
      turns: goldenTurns(),
    });
    expect(packet.context_ids).toEqual(CONTEXT.context_ids);
    expect(packet.last_turns).toHaveLength(4);
  });
});

describe("buildPacketFallback", () => {
  it("carries the summary, the last 4 turns and the excerpts", () => {
    const packet = buildPacketFallback(
      CONTEXT,
      "Running summary text",
      goldenTurns(),
    );
    expect(packet.schema_version).toBe(1);
    expect(packet.task_type).toBe("clean_ocr");
    expect(packet.work_so_far).toEqual([
      { label: "Summary so far", draft_text: "Running summary text" },
    ]);
    expect(packet.last_turns).toHaveLength(4);
    expect(packet.source_excerpts).toEqual(CONTEXT.source_excerpts);
  });
});

describe("prepareHandoff (forced switch, golden 12-turn conversation)", () => {
  const SOFT_KEY_ID = "k1-soft";
  const NEXT_KEY_ID = "k2-next";

  function handoffDeps(
    behaviour: (apiKey: string) => { text: string } | Error,
  ) {
    const handoffs: Array<{
      conversationId: string;
      fromKeyId: string;
      toKeyId: string;
      reason: string;
    }> = [];
    const deps = {
      ...makeRouterDeps({
        keys: [
          { key: SOFT_KEY_ID, plain: "key-soft", owner: OWNER },
          { key: NEXT_KEY_ID, plain: "key-next", owner: OWNER },
        ],
        behaviour,
      }),
      async recordHandoff(entry: {
        conversationId: string;
        fromKeyId: string;
        toKeyId: string;
        reason: string;
        packet: unknown;
      }) {
        handoffs.push({
          conversationId: entry.conversationId,
          fromKeyId: entry.fromKeyId,
          toKeyId: entry.toKeyId,
          reason: entry.reason,
        });
      },
    };
    return { deps, handoffs };
  }

  it("preferred path: builds the packet on the soft key and excludes it", async () => {
    const { deps, handoffs } = handoffDeps((apiKey) =>
      apiKey === "key-soft"
        ? { text: JSON.stringify(MODEL_PACKET) }
        : { text: "unused here" },
    );
    const preparation = await prepareHandoff(deps, {
      ownerId: OWNER,
      softKeyId: SOFT_KEY_ID,
      softKeyApi: "key-soft",
      softKeyModel: "gemini-2.5-flash-lite",
      excludeKeyIds: [],
      context: CONTEXT,
      runningSummary: "",
      turns: goldenTurns(),
      conversationId: "conv-1",
    });

    expect(preparation.switched).toBe(true);
    if (preparation.switched) {
      expect(preparation.excludeKeyIds).toEqual([SOFT_KEY_ID]);
      expect(preparation.packet.context_ids).toEqual(CONTEXT.context_ids);
      expect(preparation.packet.last_turns).toHaveLength(6);
    }
    expect(handoffs).toEqual([
      {
        conversationId: "conv-1",
        fromKeyId: SOFT_KEY_ID,
        toKeyId: NEXT_KEY_ID,
        reason: "soft quota threshold reached",
      },
    ]);
    // The wrap-up call ran on the soft key only.
    expect(deps.calls.map((c) => c.apiKey)).toEqual(["key-soft"]);
  });

  it("fallback path: the packet is built without AI when the call fails", async () => {
    const { deps, handoffs } = handoffDeps(() => new Error("429 mid-call"));
    const preparation = await prepareHandoff(deps, {
      ownerId: OWNER,
      softKeyId: SOFT_KEY_ID,
      softKeyApi: "key-soft",
      softKeyModel: "gemini-2.5-flash-lite",
      excludeKeyIds: [],
      context: CONTEXT,
      runningSummary: "Summary from the database",
      turns: goldenTurns(),
      conversationId: "conv-1",
    });

    expect(preparation.switched).toBe(true);
    if (preparation.switched) {
      expect(preparation.packet.work_so_far).toEqual([
        { label: "Summary so far", draft_text: "Summary from the database" },
      ]);
      expect(preparation.packet.last_turns).toHaveLength(4);
    }
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0].toKeyId).toBe(NEXT_KEY_ID);
  });

  it("uses the soft key when no other candidate exists", async () => {
    const only = {
      ...makeRouterDeps({
        keys: [{ key: SOFT_KEY_ID, plain: "key-soft", owner: OWNER }],
        behaviour: () => ({ text: JSON.stringify(MODEL_PACKET) }),
      }),
      async recordHandoff() {},
    };
    const preparation = await prepareHandoff(only, {
      ownerId: OWNER,
      softKeyId: SOFT_KEY_ID,
      softKeyApi: "key-soft",
      softKeyModel: "gemini-2.5-flash-lite",
      excludeKeyIds: [],
      context: CONTEXT,
      runningSummary: "",
      turns: goldenTurns(),
      conversationId: "conv-1",
    });
    expect(preparation).toEqual({ switched: false });
  });
});

describe("renderPacketAsContext", () => {
  it("renders the Context-so-far message", () => {
    const packet = buildPacketFallback(CONTEXT, "Summary", goldenTurns());
    const text = renderPacketAsContext(packet);
    expect(text).toContain("Context so far");
    expect(text).toContain("Clean the scanned worksheet");
    expect(text).toContain("user turn 5");
  });
});

describe("shouldRefreshSummary", () => {
  it("refreshes every 6 turns or about 6000 tokens", () => {
    expect(shouldRefreshSummary(6, 0)).toBe(true);
    expect(shouldRefreshSummary(0, 6_000)).toBe(true);
    expect(shouldRefreshSummary(2, 1_000)).toBe(false);
  });
});

describe("resolveExcerpts (the ai_allowed gate)", () => {
  const loadAsset = async (assetId: string) => {
    if (assetId === "aaaaaaaa-0000-4000-8000-000000000001") {
      return {
        course_id: "cccccccc-0000-4000-8000-000000000001",
        ai_allowed: true,
        title: "Scanned worksheet",
        ocr_text: "Server-side OCR text",
        transcript_text: null,
      };
    }
    if (assetId === "bbbbbbbb-0000-4000-8000-000000000002") {
      return {
        course_id: "cccccccc-0000-4000-8000-000000000001",
        ai_allowed: false,
        title: "Private file",
        ocr_text: "secret",
        transcript_text: null,
      };
    }
    if (assetId === "cccccccc-0000-4000-8000-000000000003") {
      return {
        course_id: "dddddddd-0000-4000-8000-000000000009",
        ai_allowed: true,
        title: "Other course file",
        ocr_text: "foreign",
        transcript_text: null,
      };
    }
    return null;
  };

  it("re-reads allowed assets server-side, preferring OCR text", async () => {
    const result = await resolveExcerpts(
      "cccccccc-0000-4000-8000-000000000001",
      [
        {
          asset_id: "aaaaaaaa-0000-4000-8000-000000000001",
          title: "Client title",
          text: "Client text",
        },
      ],
      loadAsset,
    );
    expect(result).toEqual({
      ok: true,
      excerpts: [
        {
          asset_id: "aaaaaaaa-0000-4000-8000-000000000001",
          title: "Scanned worksheet",
          text: "Server-side OCR text",
        },
      ],
    });
  });

  it("refuses the whole request when an asset is not ai_allowed", async () => {
    const result = await resolveExcerpts(
      "cccccccc-0000-4000-8000-000000000001",
      [
        {
          asset_id: "bbbbbbbb-0000-4000-8000-000000000002",
          title: "x",
          text: "y",
        },
      ],
      loadAsset,
    );
    expect(result).toEqual({ ok: false });
  });

  it("refuses assets from another course", async () => {
    const result = await resolveExcerpts(
      "cccccccc-0000-4000-8000-000000000001",
      [
        {
          asset_id: "cccccccc-0000-4000-8000-000000000003",
          title: "x",
          text: "y",
        },
      ],
      loadAsset,
    );
    expect(result).toEqual({ ok: false });
  });

  it("refuses assets that do not exist", async () => {
    const result = await resolveExcerpts(
      "cccccccc-0000-4000-8000-000000000001",
      [
        {
          asset_id: "eeeeeeee-0000-4000-8000-000000000004",
          title: "x",
          text: "y",
        },
      ],
      loadAsset,
    );
    expect(result).toEqual({ ok: false });
  });

  it("passes pasted text without an asset id through capped", async () => {
    const result = await resolveExcerpts(
      "cccccccc-0000-4000-8000-000000000001",
      [{ asset_id: "", title: "Pasted", text: "leader's own text" }],
      loadAsset,
    );
    expect(result).toEqual({
      ok: true,
      excerpts: [{ asset_id: "", title: "Pasted", text: "leader's own text" }],
    });
  });
});
