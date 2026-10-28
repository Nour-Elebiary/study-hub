"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  assignNodeAction,
  setNodeTagsAction,
  softDeleteNodeAction,
  transitionNodeStatusAction,
} from "@/app/(leader)/courses/[courseId]/nodes/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * The action bar on a note (spec section 6, plain labels): Edit, Send for
 * review, Publish, Send back with a comment, Assign, Tags, Delete. Which
 * buttons appear was decided on the server from the permission matrix.
 */
export function NoteActions({
  nodeId,
  courseId,
  status,
  tags,
  canWrite,
  canReview,
  canAssign,
  canDelete,
  members,
  assignedTo,
  dueDate,
  hasVersions,
}: {
  nodeId: string;
  courseId: string;
  status: "draft" | "in_review" | "published";
  tags: string[];
  canWrite: boolean;
  canReview: boolean;
  canAssign: boolean;
  canDelete: boolean;
  members: { id: string; name: string }[];
  assignedTo: string | null;
  dueDate: string | null;
  hasVersions: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [showSendBack, setShowSendBack] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [tagText, setTagText] = useState(tags.join(", "));
  const [busy, setBusy] = useState(false);

  async function transition(
    status: "in_review" | "published" | "draft",
    comment?: string,
  ) {
    setBusy(true);
    setMessage(null);
    const fd = new FormData();
    fd.set("node_id", nodeId);
    fd.set("status", status);
    if (comment) fd.set("send_back_comment", comment);
    const result = await transitionNodeStatusAction(null, fd);
    setBusy(false);
    if (result && "error" in result && result.error) {
      setMessage(result.error);
      return;
    }
    setShowSendBack(false);
    router.refresh();
  }

  async function remove() {
    if (
      !window.confirm(
        "Delete this note? It is hidden for 30 days, then removed.",
      )
    ) {
      return;
    }
    setBusy(true);
    const fd = new FormData();
    fd.set("node_id", nodeId);
    const result = await softDeleteNodeAction(null, fd);
    setBusy(false);
    if (result && "error" in result && result.error) {
      setMessage(result.error);
      return;
    }
    router.push(`/courses/${courseId}`);
  }

  async function saveTags() {
    setBusy(true);
    setMessage(null);
    const fd = new FormData();
    fd.set("node_id", nodeId);
    for (const tag of tagText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)) {
      fd.append("tags", tag);
    }
    const result = await setNodeTagsAction(null, fd);
    setBusy(false);
    if (result && "error" in result && result.error) {
      setMessage(result.error);
      return;
    }
    setShowTags(false);
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      {message && (
        <p role="alert" className="text-destructive text-sm">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {canWrite && (
          <Button asChild>
            <Link href={`/courses/${courseId}/nodes/${nodeId}/edit`}>Edit</Link>
          </Button>
        )}

        {canWrite && status === "draft" && (
          <Button
            type="button"
            variant="outline"
            disabled={busy || !hasVersions}
            onClick={() => transition("in_review")}
          >
            Send for review
          </Button>
        )}
        {canWrite && status === "draft" && !hasVersions && (
          <p className="text-muted-foreground w-full text-xs">
            Save the note at least once before sending it to review.
          </p>
        )}

        {canReview && status === "in_review" && (
          <>
            <Button
              type="button"
              disabled={busy}
              onClick={() => transition("published")}
            >
              Publish
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setShowSendBack((s) => !s)}
            >
              Send back
            </Button>
          </>
        )}

        {canDelete && (
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={remove}
          >
            Delete
          </Button>
        )}
      </div>

      {showSendBack && (
        <SendBackForm
          disabled={busy}
          onSubmit={async (comment) => {
            await transition("draft", comment);
          }}
        />
      )}

      {canAssign && (
        <AssignForm
          nodeId={nodeId}
          members={members}
          assignedTo={assignedTo}
          dueDate={dueDate}
          onDone={() => router.refresh()}
          onError={(error) => setMessage(error)}
        />
      )}

      {canWrite && (
        <div className="grid gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={() => setShowTags((s) => !s)}
          >
            {showTags ? "Hide tags" : "Edit tags"}
          </Button>
          {showTags && (
            <div className="grid gap-2 rounded-md border p-3">
              <Label htmlFor="tag_text">
                Tags (separate with commas — quizzes and exams are tags, not
                folders)
              </Label>
              <Input
                id="tag_text"
                value={tagText}
                onChange={(e) => setTagText(e.target.value)}
                placeholder="quiz1, final"
              />
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={saveTags}
              >
                Save tags
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Sending back needs a written reason (spec section 6). */
function SendBackForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (comment: string) => Promise<void>;
}) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="grid gap-2 rounded-md border p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (comment.trim().length === 0) {
          setError("Write what needs to change before sending it back.");
          return;
        }
        setError(null);
        await onSubmit(comment.trim());
      }}
    >
      <Label htmlFor="send_back_comment">What needs to change?</Label>
      <Textarea
        id="send_back_comment"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={2000}
        rows={3}
        required
      />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" variant="outline" size="sm" disabled={disabled}>
        Send back with this comment
      </Button>
    </form>
  );
}

/** Assign a leader and an optional due date (spec rule 2). */
function AssignForm({
  nodeId,
  members,
  assignedTo,
  dueDate,
  onDone,
  onError,
}: {
  nodeId: string;
  members: { id: string; name: string }[];
  assignedTo: string | null;
  dueDate: string | null;
  onDone: () => void;
  onError: (error: string) => void;
}) {
  const [value, setValue] = useState(assignedTo ?? "none");
  const [date, setDate] = useState(dueDate ?? "");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const fd = new FormData();
    fd.set("node_id", nodeId);
    fd.set("assigned_to", value === "none" ? "" : value);
    fd.set("due_date", date);
    const result = await assignNodeAction(null, fd);
    setBusy(false);
    if (result && "error" in result && result.error) {
      onError(result.error);
      return;
    }
    onDone();
  }

  return (
    <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
      <div className="grid gap-1">
        <Label htmlFor="assigned_to">Assigned to</Label>
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger id="assigned_to" className="w-full">
            <SelectValue placeholder="Nobody" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Nobody</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="due_date">Due date</Label>
        <Input
          id="due_date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <Button type="button" size="sm" disabled={busy} onClick={submit}>
        {busy ? "Saving…" : "Assign"}
      </Button>
    </div>
  );
}
