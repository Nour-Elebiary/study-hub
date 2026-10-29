import "server-only";

/**
 * Gemini REST client (spec section 8). Talks to the v1beta API directly —
 * no SDK, so the free-tier footprint stays small. The API key travels in
 * the x-goog-api-key header and is never logged or included in an error
 * message.
 *
 * Errors are classified for the router:
 *   QuotaError        — HTTP 429 / RESOURCE_EXHAUSTED, carries the
 *                       retryDelay Google suggests (RetryInfo detail).
 *   GeminiServerError — 5xx or a broken stream; worth one retry.
 *   GeminiClientError — anything else (bad key, bad request); retrying the
 *                       same key is pointless, the router moves on.
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Model ids come from the admin-edited ai_limits table; keep them inert in URLs. */
const MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{0,80}$/;

export type GeminiTurn = { role: "user" | "model"; text: string };

/** Rough token estimate for the advisory usage counters (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class QuotaError extends Error {
  /** Seconds Google asks us to wait (RetryInfo.retryDelay), or null. */
  readonly retryAfterSeconds: number | null;

  constructor(message: string, retryAfterSeconds: number | null) {
    super(message);
    this.name = "QuotaError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class GeminiServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiServerError";
  }
}

export class GeminiClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiClientError";
  }
}

type GeminiPart = { text?: string };
type GeminiCandidate = { content?: { parts?: GeminiPart[] } };
type GeminiUsageMetadata = { totalTokenCount?: number };
type GeminiErrorDetail = { "@type"?: string; retryDelay?: string };
type GeminiErrorBody = {
  error?: {
    code?: number;
    status?: string;
    message?: string;
    details?: GeminiErrorDetail[];
  };
};

function safeJson(raw: string): GeminiErrorBody | null {
  try {
    return JSON.parse(raw) as GeminiErrorBody;
  } catch {
    return null;
  }
}

/** "25s" (RetryInfo.retryDelay) → 25. */
export function parseRetryDelaySeconds(body: GeminiErrorBody): number | null {
  const detail = body.error?.details?.find((d) =>
    (d["@type"] ?? "").includes("RetryInfo"),
  );
  const match = /^(\d+(?:\.\d+)?)s$/.exec(detail?.retryDelay ?? "");
  return match ? Math.round(Number(match[1])) : null;
}

async function errorFromResponse(res: Response): Promise<Error> {
  const raw = await res.text().catch(() => "");
  const body = safeJson(raw);
  if (res.status === 429 || body?.error?.status === "RESOURCE_EXHAUSTED") {
    return new QuotaError(
      "Gemini quota exhausted for this key",
      parseRetryDelaySeconds(body ?? {}),
    );
  }
  if (res.status >= 500) {
    return new GeminiServerError(`Gemini server error ${res.status}`);
  }
  return new GeminiClientError(
    body?.error?.message ?? `Gemini request failed (${res.status})`,
  );
}

function assertModel(model: string): string {
  if (!MODEL_PATTERN.test(model)) {
    throw new GeminiClientError(`Unknown model name: ${model}`);
  }
  return model;
}

function requestBody(
  systemPrompt: string,
  contents: GeminiTurn[],
): Record<string, unknown> {
  return {
    contents: contents.map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.text }],
    })),
    systemInstruction: { parts: [{ text: systemPrompt }] },
  };
}

function textFromCandidates(candidates: GeminiCandidate[] | undefined): string {
  return (
    candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ??
    ""
  );
}

/**
 * One non-streaming call — used for the wrap-up packet, the Test button and
 * other small jobs where streaming adds nothing.
 */
export async function generateGemini(args: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  contents: GeminiTurn[];
  signal?: AbortSignal;
}): Promise<{ text: string; tokensEst: number }> {
  const model = assertModel(args.model);
  const res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": args.apiKey,
    },
    body: JSON.stringify(requestBody(args.systemPrompt, args.contents)),
    signal: args.signal,
  });
  if (!res.ok) throw await errorFromResponse(res);

  const body = (await res.json()) as {
    candidates?: GeminiCandidate[];
    usageMetadata?: GeminiUsageMetadata;
  };
  const text = textFromCandidates(body.candidates);
  if (!text) throw new GeminiServerError("Gemini returned an empty reply");
  return {
    text,
    tokensEst: body.usageMetadata?.totalTokenCount ?? estimateTokens(text),
  };
}

type GeminiStreamChunk = {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  error?: GeminiErrorBody["error"];
};

/**
 * Streaming call (`alt=sse`): yields text deltas as they arrive. The router
 * accumulates the full text for persistence; the chat endpoint forwards the
 * deltas to the browser.
 */
export async function* streamGemini(args: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  contents: GeminiTurn[];
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const model = assertModel(args.model);
  const res = await fetch(
    `${GEMINI_BASE}/models/${model}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": args.apiKey,
      },
      body: JSON.stringify(requestBody(args.systemPrompt, args.contents)),
      signal: args.signal,
    },
  );
  if (!res.ok) throw await errorFromResponse(res);
  if (!res.body) throw new GeminiServerError("Gemini returned no stream body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        const chunk = safeJson(payload) as GeminiStreamChunk | null;
        if (!chunk) continue;
        if (chunk.error) {
          // A 429 can also arrive mid-stream as an error object.
          if (
            chunk.error.code === 429 ||
            chunk.error.status === "RESOURCE_EXHAUSTED"
          ) {
            throw new QuotaError(
              "Gemini quota exhausted mid-stream",
              parseRetryDelaySeconds({ error: chunk.error }),
            );
          }
          if ((chunk.error.code ?? 0) >= 500) {
            throw new GeminiServerError(
              `Gemini server error ${chunk.error.code}`,
            );
          }
          throw new GeminiClientError(
            chunk.error.message ?? "Gemini stream error",
          );
        }
        const text = textFromCandidates(chunk.candidates);
        if (text) yield text;
      }
    }
  }
}
