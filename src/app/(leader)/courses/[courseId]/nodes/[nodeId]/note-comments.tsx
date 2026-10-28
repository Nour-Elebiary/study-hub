"use client";

import { useState } from "react";
import {
  addCommentAction,
  resolveCommentAction,
} from "@/app/(leader)/courses/[courseId]/nodes/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type CommentItem = {
  id: string;
  parentId: string | null;
  authorName: string;
  authorId: string;
  body: string;
  resolved: boolean;
  createdAt: string;
};

/**
 * Review comments on a note (spec section 6): every course member can
 * comment and reply; the author of a comment, the course owner or an admin
 * can mark a thread resolved.
 */
export function NoteComments({
  nodeId,
  comments,
  currentUserId,
  canModerate,
}: {
  nodeId: string;
  comments: CommentItem[];
  currentUserId: string;
  canModerate: boolean;
}) {
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(body: string, parentId: string | null) {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("node_id", nodeId);
    if (parentId) fd.set("parent_id", parentId);
    fd.set("body", body);
    const result = await addCommentAction(null, fd);
    setBusy(false);
    if (result && "error" in result && result.error) {
      setError(result.error);
      return false;
    }
    return true;
  }

  async function toggleResolved(comment: CommentItem) {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("comment_id", comment.id);
    fd.set("resolved", comment.resolved ? "false" : "true");
    const result = await resolveCommentAction(null, fd);
    setBusy(false);
    if (result && "error" in result && result.error) {
      setError(result.error);
    }
  }

  const roots = comments.filter((c) => c.parentId === null);
  const repliesOf = (id: string) => comments.filter((c) => c.parentId === id);

  return (
    <section className="grid gap-3" aria-label="Comments">
      <h2 className="text-lg font-semibold">
        Comments{" "}
        <span className="text-muted-foreground font-normal">
          ({comments.filter((c) => !c.resolved).length} open)
        </span>
      </h2>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {roots.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No comments yet. Reviewers leave their feedback here.
        </p>
      )}

      <ul className="grid gap-3">
        {roots.map((comment) => (
          <li key={comment.id} className="grid gap-2">
            <CommentBubble
              comment={comment}
              currentUserId={currentUserId}
              canModerate={canModerate}
              busy={busy}
              onResolve={() => toggleResolved(comment)}
              onReply={() =>
                setReplyTo(replyTo === comment.id ? null : comment.id)
              }
            />
            {repliesOf(comment.id).length > 0 && (
              <ul className="grid gap-2 border-l-2 pl-3">
                {repliesOf(comment.id).map((reply) => (
                  <li key={reply.id}>
                    <CommentBubble
                      comment={reply}
                      currentUserId={currentUserId}
                      canModerate={canModerate}
                      busy={busy}
                      onResolve={() => toggleResolved(reply)}
                      onReply={() =>
                        setReplyTo(replyTo === reply.id ? null : reply.id)
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
            {replyTo === comment.id && (
              <CommentForm
                label="Write your reply"
                disabled={busy}
                onSubmit={async (body) => {
                  const ok = await post(body, comment.id);
                  if (ok) setReplyTo(null);
                  return ok;
                }}
              />
            )}
          </li>
        ))}
      </ul>

      <CommentForm
        label="Write a comment"
        disabled={busy}
        onSubmit={(body) => post(body, null)}
      />
    </section>
  );
}

function CommentBubble({
  comment,
  currentUserId,
  canModerate,
  busy,
  onResolve,
  onReply,
}: {
  comment: CommentItem;
  currentUserId: string;
  canModerate: boolean;
  busy: boolean;
  onResolve: () => void;
  onReply: () => void;
}) {
  const mayResolve = canModerate || comment.authorId === currentUserId;
  return (
    <div
      className={`rounded-md border p-3 text-sm ${
        comment.resolved ? "text-muted-foreground opacity-70" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{comment.authorName}</span>
        <time
          dateTime={comment.createdAt}
          className="text-muted-foreground text-xs"
        >
          {new Date(comment.createdAt).toLocaleString()}
        </time>
        {comment.resolved && <Badge variant="secondary">Resolved</Badge>}
      </div>
      <p className="mt-1 whitespace-pre-wrap" dir="auto">
        {comment.body}
      </p>
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={onReply}
        >
          Reply
        </Button>
        {mayResolve && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            disabled={busy}
            onClick={onResolve}
          >
            {comment.resolved ? "Reopen" : "Mark resolved"}
          </Button>
        )}
      </div>
    </div>
  );
}

function CommentForm({
  label,
  disabled,
  onSubmit,
}: {
  label: string;
  disabled: boolean;
  onSubmit: (body: string) => Promise<boolean>;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (body.trim().length === 0) {
          setError("Write your comment.");
          return;
        }
        setError(null);
        const ok = await onSubmit(body.trim());
        if (ok) setBody("");
      }}
    >
      <Label htmlFor={`comment-${label}`} className="sr-only">
        {label}
      </Label>
      <Textarea
        id={`comment-${label}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={label}
        rows={2}
        maxLength={4000}
        dir="auto"
      />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={disabled} className="w-fit">
        Post comment
      </Button>
    </form>
  );
}
