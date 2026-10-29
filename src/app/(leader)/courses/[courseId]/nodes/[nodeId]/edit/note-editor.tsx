"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { Markdown } from "@tiptap/markdown";
import {
  saveDraftAction,
  saveVersionAction,
} from "@/app/(leader)/courses/[courseId]/nodes/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dictation, dictationLocale } from "@/lib/browser-jobs/dictation";
import { OCR_LANGUAGE_LABELS, type OcrLanguage } from "@/lib/jobs";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const AUTOSAVE_MS = 5_000; // draft every 5 seconds (spec section 6)
const VERSION_AFTER_MS = 60_000; // a version after 60 s of changes
const LOCK_RENEW_MS = 30_000; // renew the lock every 30 seconds
const LOCK_TTL_MS = 2 * 60_000; // the lock expires after 2 minutes

type LockState =
  | { state: "checking" }
  | { state: "mine" }
  | { state: "free" }
  | { state: "other"; holderName: string; canBreak: boolean };

function formDataOf(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

/**
 * The note editor (spec section 6): TipTap with a big touch-friendly
 * toolbar, storing Markdown. Autosaves a draft every 5 seconds and writes
 * a version on Save or after 60 seconds of changes. Holds the soft lock
 * while open: renewed every 30 s, expires after 2 minutes without activity.
 */
export function NoteEditor({
  nodeId,
  courseId,
  initialBody,
  canWrite,
  canBreakLock,
  currentUserId,
}: {
  nodeId: string;
  courseId: string;
  initialBody: string;
  canWrite: boolean;
  canBreakLock: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [lock, setLock] = useState<LockState>(
    canWrite ? { state: "checking" } : { state: "free" },
  );
  const [saveState, setSaveState] = useState<
    "idle" | "saving-draft" | "saved" | "saving-version" | "error"
  >("idle");
  const [changeNote, setChangeNote] = useState("");
  const lastSavedRef = useRef(initialBody);
  const lastVersionRef = useRef(0); // baseline set on the first autosave tick
  const dirtyRef = useRef(false);

  // --- live dictation (spec section 7, Web Speech API) -----------------------
  const dictationRef = useRef<Dictation | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [dictationError, setDictationError] = useState("");
  const [dictationLang, setDictationLang] = useState<OcrLanguage>("eng");

  // Stop the microphone when the editor goes away.
  useEffect(() => {
    return () => {
      dictationRef.current?.stop();
    };
  }, []);

  function toggleDictation() {
    if (!dictationRef.current) dictationRef.current = new Dictation();
    const dictation = dictationRef.current;
    if (dictation.active) {
      dictation.stop();
      setListening(false);
      setInterim("");
      return;
    }
    setDictationError("");
    dictation.start(dictationLocale(dictationLang), {
      onFinal: (text) => {
        if (!text) return;
        editor?.chain().focus().insertContent(`${text} `).run();
      },
      onInterim: (text) => setInterim(text),
      onError: (message) => {
        setDictationError(message);
        setListening(false);
        setInterim("");
      },
      onEnd: () => {
        setListening(false);
        setInterim("");
      },
    });
    setListening(true);
  }

  const editor = useEditor({
    extensions: [
      StarterKit,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown,
    ],
    content: initialBody,
    editable: canWrite,
    editorProps: {
      attributes: {
        dir: "auto", // Arabic (right-to-left) text works per paragraph
        class: "prose prose-sm sm:prose-base max-w-none min-h-64 outline-none",
      },
    },
  });

  const currentMarkdown = useCallback((): string => {
    if (!editor) return initialBody;
    return editor.getMarkdown();
  }, [editor, initialBody]);

  // --- soft lock -------------------------------------------------------------
  const acquireLock = useCallback(async (): Promise<boolean> => {
    const supabase = createBrowserSupabase();
    const { data: existing } = await supabase
      .from("locks")
      .select("user_id, expires_at")
      .eq("node_id", nodeId)
      .maybeSingle();

    const live =
      existing && new Date(existing.expires_at).getTime() > Date.now();

    if (existing && live && existing.user_id !== currentUserId) {
      const { data: holder } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", existing.user_id)
        .single();
      setLock({
        state: "other",
        holderName: holder?.display_name ?? "Someone else",
        canBreak: canBreakLock,
      });
      return false;
    }

    if (existing && existing.user_id === currentUserId) {
      const { error } = await supabase
        .from("locks")
        .update({
          expires_at: new Date(Date.now() + LOCK_TTL_MS).toISOString(),
        })
        .eq("node_id", nodeId);
      if (!error) {
        setLock({ state: "mine" });
        return true;
      }
    }

    const { error } = await supabase.from("locks").insert({
      node_id: nodeId,
      user_id: currentUserId,
      expires_at: new Date(Date.now() + LOCK_TTL_MS).toISOString(),
    });
    if (error) {
      // Someone else took the lock between the check and the insert.
      setLock({
        state: "other",
        holderName: "Someone else",
        canBreak: canBreakLock,
      });
      return false;
    }
    setLock({ state: "mine" });
    return true;
  }, [nodeId, currentUserId, canBreakLock]);

  useEffect(() => {
    if (!canWrite) return; // lock starts as "free" for read-only viewers
    let released = false;
    let renew: number | undefined;

    // Acquire after mount, outside the synchronous effect body (React
    // compiler rule: no setState directly in an effect).
    const start = window.setTimeout(() => {
      if (released) return;
      void acquireLock().then((ok) => {
        if (!ok) released = true;
      });
      renew = window.setInterval(() => {
        if (released) return;
        const supabase = createBrowserSupabase();
        void supabase
          .from("locks")
          .update({
            expires_at: new Date(Date.now() + LOCK_TTL_MS).toISOString(),
          })
          .eq("node_id", nodeId)
          .eq("user_id", currentUserId);
      }, LOCK_RENEW_MS);
    }, 0);

    return () => {
      released = true;
      window.clearTimeout(start);
      if (renew !== undefined) window.clearInterval(renew);
      const supabase = createBrowserSupabase();
      void supabase
        .from("locks")
        .delete()
        .eq("node_id", nodeId)
        .eq("user_id", currentUserId);
    };
  }, [acquireLock, canWrite, nodeId, currentUserId]);

  async function breakLock() {
    const supabase = createBrowserSupabase();
    await supabase.from("locks").delete().eq("node_id", nodeId);
    const ok = await acquireLock();
    if (ok) setSaveState("idle");
  }

  // --- autosave and versioning ------------------------------------------------
  useEffect(() => {
    if (!editor || !canWrite || lock.state === "other") return;

    const tick = setInterval(async () => {
      const body = currentMarkdown();
      if (body === lastSavedRef.current) return;

      // 1. draft every 5 seconds
      setSaveState("saving-draft");
      const result = await saveDraftAction(
        null,
        formDataOf({ node_id: nodeId, body_md: body }),
      );
      if (result && "error" in result && result.error) {
        setSaveState("error");
        return;
      }
      lastSavedRef.current = body;
      setSaveState("saved");

      // 2. a version after 60 seconds of unsaved changes (the baseline is
      // set on the first tick with changes, inside the interval callback)
      const baseline = lastVersionRef.current || Date.now();
      if (dirtyRef.current && Date.now() - baseline > VERSION_AFTER_MS) {
        setSaveState("saving-version");
        const versionResult = await saveVersionAction(
          null,
          formDataOf({
            node_id: nodeId,
            body_md: body,
            change_note: "Autosaved after 60 seconds of changes",
          }),
        );
        if (versionResult && "error" in versionResult && versionResult.error) {
          setSaveState("error");
          return;
        }
        lastVersionRef.current = Date.now();
        dirtyRef.current = false;
        setSaveState("saved");
      }
    }, AUTOSAVE_MS);

    return () => clearInterval(tick);
  }, [editor, canWrite, lock.state, currentMarkdown, nodeId]);

  // Track changes for the 60-second version rule.
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      dirtyRef.current = true;
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor]);

  async function saveNow() {
    if (!editor) return;
    const body = currentMarkdown();
    setSaveState("saving-version");
    const result = await saveVersionAction(
      null,
      formDataOf({ node_id: nodeId, body_md: body, change_note: changeNote }),
    );
    if (result && "error" in result && result.error) {
      setSaveState("error");
      return;
    }
    lastSavedRef.current = body;
    lastVersionRef.current = Date.now();
    dirtyRef.current = false;
    setChangeNote("");
    setSaveState("saved");
    router.refresh();
  }

  if (lock.state === "other") {
    return (
      <div className="grid gap-4">
        <div
          role="status"
          className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <strong>{lock.holderName}</strong> is editing this note right now. You
          can read it, but not change it, until they finish (the lock frees
          itself after 2 minutes of no activity).
          {lock.canBreak && (
            <div className="mt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={breakLock}
              >
                Take over the edit
              </Button>
            </div>
          )}
        </div>
        <ReadonlyPreview body={currentMarkdown()} />
      </div>
    );
  }

  if (lock.state === "checking") {
    return <p className="text-muted-foreground text-sm">Opening the note…</p>;
  }

  return (
    <div className="grid gap-3">
      {saveState === "error" && (
        <p role="alert" className="text-destructive text-sm">
          The last save did not go through. Press Save to try again.
        </p>
      )}
      {saveState === "saved" && (
        <p role="status" className="text-muted-foreground text-sm">
          Saved.
        </p>
      )}
      {saveState === "saving-draft" && (
        <p role="status" className="text-muted-foreground text-sm">
          Saving draft…
        </p>
      )}
      {saveState === "saving-version" && (
        <p role="status" className="text-muted-foreground text-sm">
          Writing version…
        </p>
      )}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
          <Button
            type="button"
            variant={listening ? "secondary" : "outline"}
            size="sm"
            className="h-10 px-3"
            onClick={toggleDictation}
            aria-pressed={listening}
          >
            {listening ? "⏹ Stop dictation" : "🎤 Dictate"}
          </Button>
          <select
            aria-label="Dictation language"
            value={dictationLang}
            onChange={(e) => setDictationLang(e.target.value as OcrLanguage)}
            disabled={listening}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            <option value="eng">{OCR_LANGUAGE_LABELS.eng}</option>
            <option value="ara">{OCR_LANGUAGE_LABELS.ara}</option>
          </select>
          {listening && interim && (
            <span className="text-muted-foreground text-sm italic" dir="auto">
              {interim}
            </span>
          )}
          {dictationError && (
            <p role="alert" className="text-destructive text-sm">
              {dictationError}
            </p>
          )}
        </div>
      )}

      <div
        className="flex flex-wrap gap-1 rounded-md border p-2"
        role="toolbar"
        aria-label="Formatting"
      >
        <ToolbarButton
          label="Bold"
          active={editor?.isActive("bold") ?? false}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={editor?.isActive("italic") ?? false}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton
          label="Heading"
          active={editor?.isActive("heading", { level: 2 }) ?? false}
          onClick={() =>
            editor?.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          H2
        </ToolbarButton>
        <ToolbarButton
          label="Small heading"
          active={editor?.isActive("heading", { level: 3 }) ?? false}
          onClick={() =>
            editor?.chain().focus().toggleHeading({ level: 3 }).run()
          }
        >
          H3
        </ToolbarButton>
        <ToolbarButton
          label="Bullet list"
          active={editor?.isActive("bulletList") ?? false}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          •≈
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={editor?.isActive("orderedList") ?? false}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          1.
        </ToolbarButton>
        <ToolbarButton
          label="Quote"
          active={editor?.isActive("blockquote") ?? false}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          ❝
        </ToolbarButton>
        <ToolbarButton
          label="Code"
          active={editor?.isActive("codeBlock") ?? false}
          onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
        >
          {"</>"}
        </ToolbarButton>
        <ToolbarButton
          label="Link"
          active={editor?.isActive("link") ?? false}
          onClick={() => {
            const url = window.prompt("Link address (URL)");
            if (url === null) return;
            if (url === "") {
              editor?.chain().focus().unsetLink().run();
              return;
            }
            editor?.chain().focus().setLink({ href: url }).run();
          }}
        >
          🔗
        </ToolbarButton>
        <ToolbarButton
          label="Table"
          active={editor?.isActive("table") ?? false}
          onClick={() =>
            editor
              ?.chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        >
          ⊞
        </ToolbarButton>
      </div>

      <div className="rounded-md border p-3" dir="auto">
        <EditorContent editor={editor} />
      </div>

      {canWrite && (
        <div className="grid gap-2 rounded-md border p-3">
          <Label htmlFor="change_note">What did you change? (optional)</Label>
          <Input
            id="change_note"
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
            maxLength={300}
            placeholder="For example: added the second example"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={saveNow}>
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                router.push(`/courses/${courseId}/nodes/${nodeId}`)
              }
            >
              Done
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Your work is saved as a draft every few seconds. Press Save to keep
            a version in the history.
          </p>
        </div>
      )}
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="sm"
      className="h-10 min-w-10 px-3"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
    >
      {children}
    </Button>
  );
}

/** Shown while someone else holds the lock. */
function ReadonlyPreview({ body }: { body: string }) {
  return (
    <div
      className="rounded-md border p-3 text-sm whitespace-pre-wrap"
      dir="auto"
    >
      {body}
    </div>
  );
}
