"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { saveDraftAction } from "@/app/(leader)/courses/[courseId]/nodes/actions";
import { Button } from "@/components/ui/button";
import { diffLines } from "@/lib/diff";

/**
 * The AI side panel (spec section 8): a side panel on desktop, a bottom
 * sheet on phones. It opens with the current note (or transcript) already
 * loaded as quoted reference data. Quick actions run one-shot tasks; the
 * "Clean OCR text" result arrives as a suggested edit — a diff the leader
 * accepts or rejects. The AI never saves on its own: accept goes through
 * the same server action as a normal draft save, so RLS has the final word.
 */

export type AiSidePanelProps = {
  courseId?: string;
  noteId?: string;
  noteTitle?: string;
  noteBody?: string;
};

type PanelMessage = { role: "user" | "assistant"; content: string };

const QUICK_ACTIONS = [
  {
    label: "Clean OCR text",
    prompt:
      "Clean the OCR text in the reference data: fix recognition errors and spacing, keep the original wording and structure. Output only the cleaned Markdown text.",
    replacesNote: true,
  },
  {
    label: "Summarise",
    prompt: "Summarise the reference data as concise study notes in Markdown.",
    replacesNote: false,
  },
  {
    label: "Make glossary",
    prompt:
      "From the reference data, make a glossary of key terms with short definitions, as a Markdown list.",
    replacesNote: false,
  },
  {
    label: "Make quiz questions",
    prompt:
      "From the reference data, write 8 quiz questions with their answers, in Markdown.",
    replacesNote: false,
  },
  {
    label: "Translate to Arabic",
    prompt:
      "Translate the reference data into Arabic. Keep the Markdown structure.",
    replacesNote: false,
  },
  {
    label: "Explain this section",
    prompt: "Explain the reference data in simple words a student can follow.",
    replacesNote: false,
  },
  {
    label: "Draft notes from a transcript",
    prompt:
      "The reference data is a lecture transcript. Turn it into organised study notes in Markdown.",
    replacesNote: false,
  },
] as const;

const NOTICE_KEY = "ai-notice-v1";

export function AiSidePanel(props: AiSidePanelProps) {
  const [open, setOpen] = useState(false);
  const [noticeAck, setNoticeAck] = useState(true);
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chip, setChip] = useState<string | null>(null);
  const [taskResult, setTaskResult] = useState<{
    text: string;
    replacesNote: boolean;
  } | null>(null);
  const [taskBusy, setTaskBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages, streaming]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    setOpen(false);
  }, []);

  function openPanel() {
    // Read the acknowledgement when the panel opens (an event, not an
    // effect) — localStorage is not available during server rendering.
    setNoticeAck(window.localStorage.getItem(NOTICE_KEY) === "seen");
    setOpen(true);
  }

  const hasNoteContext = Boolean(props.noteBody || props.noteTitle);

  function buildContext() {
    return {
      goal: props.noteTitle
        ? `Help with "${props.noteTitle}"`
        : "Answer the leader's question",
      task_type: "other" as const,
      language: "en" as const,
      note_id: props.noteId ?? null,
      note_title: props.noteTitle ?? "",
      note_body: props.noteBody ?? "",
      excerpts: [],
    };
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setError(null);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let assistantText = "";
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId ?? undefined,
          course_id: props.courseId ?? null,
          message: trimmed,
          context: buildContext(),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "The assistant could not answer.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let firstDelta = true;
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
            const parsed = JSON.parse(payload) as {
              type: string;
              text?: string;
              message?: string;
              conversation_id?: string;
            };
            if (parsed.type === "start" && parsed.conversation_id) {
              setConversationId(parsed.conversation_id);
            } else if (parsed.type === "delta" && parsed.text) {
              assistantText += parsed.text;
              setMessages((prev) => {
                const next = [...prev];
                if (firstDelta || next[next.length - 1]?.role !== "assistant") {
                  next.push({ role: "assistant", content: assistantText });
                  firstDelta = false;
                } else {
                  next[next.length - 1] = {
                    role: "assistant",
                    content: assistantText,
                  };
                }
                return next;
              });
            } else if (parsed.type === "status" && parsed.text) {
              setChip(parsed.text);
            } else if (parsed.type === "error") {
              throw new Error(
                parsed.message ?? "The assistant could not answer.",
              );
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  async function runQuickAction(action: (typeof QUICK_ACTIONS)[number]) {
    if (taskBusy) return;
    setTaskBusy(action.label);
    setError(null);
    try {
      const res = await fetch("/api/ai/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_id: props.courseId ?? null,
          prompt: action.prompt,
          context: {
            ...buildContext(),
            task_type: action.replacesNote ? "clean_ocr" : "other",
          },
        }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || !data.text) {
        throw new Error(data.error ?? "The task could not be completed.");
      }
      setTaskResult({ text: data.text, replacesNote: action.replacesNote });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTaskBusy(null);
    }
  }

  async function acceptSuggestedEdit(newBody: string) {
    if (!props.noteId) return;
    const formData = new FormData();
    formData.set("node_id", props.noteId);
    formData.set("body_md", newBody);
    const result = await saveDraftAction(null, formData);
    if (result && "error" in result) {
      setError(result.error);
      return;
    }
    setTaskResult(null);
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: "The suggested edit was applied to the draft.",
      },
    ]);
  }

  if (!open) {
    return (
      <Button
        className="fixed right-4 bottom-4 z-40 rounded-full shadow-lg"
        onClick={openPanel}
        aria-label="Open AI assistant"
      >
        AI
      </Button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="AI assistant"
      className="bg-background fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-xl border shadow-2xl md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-96 md:rounded-none md:border-l"
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <p className="text-sm font-semibold">AI assistant</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={close}
          aria-label="Close AI assistant"
        >
          Close
        </Button>
      </div>

      {!noticeAck && (
        <div className="bg-muted/50 border-b px-4 py-3 text-xs">
          <p className="font-medium">Before you use the AI</p>
          <p className="text-muted-foreground mt-1">
            On the free tier, what you send may be used by the AI provider to
            improve its services. Never paste student personal data (names,
            grades, private notes about a person) — study material only.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => {
              window.localStorage.setItem(NOTICE_KEY, "seen");
              setNoticeAck(true);
            }}
          >
            Got it
          </Button>
        </div>
      )}

      {hasNoteContext && (
        <div className="flex flex-wrap gap-2 border-b px-4 py-2">
          {QUICK_ACTIONS.map((action) => (
            <Button
              key={action.label}
              variant="outline"
              size="sm"
              disabled={taskBusy !== null || streaming}
              onClick={() => runQuickAction(action)}
            >
              {taskBusy === action.label ? "Working…" : action.label}
            </Button>
          ))}
        </div>
      )}

      <div ref={logRef} className="flex-1 overflow-y-auto px-4 py-3">
        {chip && (
          <p className="bg-secondary text-secondary-foreground mb-2 inline-block rounded-full px-3 py-1 text-xs">
            {chip}
          </p>
        )}
        {messages.length === 0 && !streaming && (
          <p className="text-muted-foreground text-sm">
            {hasNoteContext
              ? "Ask about this note, or use a quick action above."
              : "Ask anything about your course work."}
          </p>
        )}
        <div className="grid gap-3">
          {messages.map((message, index) =>
            message.role === "user" ? (
              <div
                key={index}
                className="bg-primary text-primary-foreground ml-8 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap"
              >
                {message.content}
              </div>
            ) : (
              // The assistant replies in Markdown; react-markdown escapes
              // raw HTML, so injected tags render as harmless text (spec
              // section 8, prompt-injection defence).
              <div
                key={index}
                className="prose prose-sm bg-muted mr-4 max-w-none rounded-lg px-3 py-2"
                dir="auto"
              >
                <Markdown>{message.content}</Markdown>
              </div>
            ),
          )}
        </div>

        {taskResult && (
          <div className="mt-3 rounded-lg border p-3">
            <p className="text-sm font-medium">
              {taskResult.replacesNote ? "Suggested edit" : "Result"}
            </p>
            {taskResult.replacesNote && props.noteBody ? (
              <DiffPreview oldText={props.noteBody} newText={taskResult.text} />
            ) : (
              <div
                className="prose prose-sm text-muted-foreground mt-2 max-w-none"
                dir="auto"
              >
                <Markdown>{taskResult.text}</Markdown>
              </div>
            )}
            <div className="mt-3 flex gap-2">
              {taskResult.replacesNote ? (
                <>
                  <Button
                    size="sm"
                    onClick={() => acceptSuggestedEdit(taskResult.text)}
                  >
                    Accept edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTaskResult(null)}
                  >
                    Reject
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(taskResult.text);
                  }}
                >
                  Copy
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-destructive px-4 pb-2 text-sm">
          {error}
        </p>
      )}

      <form
        className="flex gap-2 border-t px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <input
          className="border-input bg-background flex-1 rounded-md border px-3 py-2 text-sm"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask the assistant…"
          aria-label="Message for the AI assistant"
          maxLength={8000}
          disabled={streaming}
        />
        <Button type="submit" disabled={streaming || !input.trim()}>
          {streaming ? "…" : "Send"}
        </Button>
      </form>
    </div>
  );
}

function DiffPreview({
  oldText,
  newText,
}: {
  oldText: string;
  newText: string;
}) {
  const lines = diffLines(oldText, newText).filter(
    (line) => line.kind !== "same",
  );
  return (
    <div className="mt-2 max-h-48 overflow-y-auto rounded border font-mono text-xs">
      {lines.slice(0, 200).map((line, index) => (
        <div
          key={index}
          className={
            line.kind === "added"
              ? "bg-green-500/10 text-green-700 dark:text-green-400"
              : "bg-red-500/10 text-red-700 dark:text-red-400"
          }
        >
          {line.kind === "added" ? "+ " : "- "}
          {line.text}
        </div>
      ))}
      {lines.length > 200 && (
        <div className="text-muted-foreground px-2 py-1">
          …and {lines.length - 200} more changed lines
        </div>
      )}
    </div>
  );
}
