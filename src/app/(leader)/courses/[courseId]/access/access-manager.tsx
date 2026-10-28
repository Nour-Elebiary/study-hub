"use client";

import { useActionState } from "react";
import {
  createJoinCodeAction,
  revokeJoinCodeAction,
} from "@/app/(leader)/courses/[courseId]/access/actions";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type JoinCodeRow = {
  id: string;
  label: string;
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  createdAt: string;
};

/**
 * The student-access card on a course (spec section 10 rule 1): create a
 * code, see it once, share it; revoke a leaked one. Plain labels.
 */
export function AccessManager({
  courseId,
  codes,
  canManage,
}: {
  courseId: string;
  codes: JoinCodeRow[];
  canManage: boolean;
}) {
  const [createState, createFormAction, creating] = useActionState(
    createJoinCodeAction,
    null,
  );
  const [revokeState, revokeFormAction, revoking] = useActionState(
    revokeJoinCodeAction,
    null,
  );

  return (
    <div className="grid gap-4">
      {createState && "ok" in createState && (
        <div
          role="status"
          className="bg-muted rounded-md border p-3 text-sm"
          data-testid="new-join-code"
        >
          <p className="font-medium">New code — shown only once:</p>
          <p className="mt-1 flex items-center gap-2">
            <span className="tracking-widest">{createState.code}</span>
            <CopyButton text={createState.code} label="Copy code" />
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Students enter this at the student site. Write it down now — it is
            not stored and cannot be shown again.
          </p>
        </div>
      )}
      {createState && "error" in createState && (
        <p role="alert" className="text-destructive text-sm">
          {createState.error}
        </p>
      )}
      {revokeState && "error" in revokeState && (
        <p role="alert" className="text-destructive text-sm">
          {revokeState.error}
        </p>
      )}

      {canManage && (
        <form action={createFormAction} className="grid gap-3">
          <input type="hidden" name="course_id" value={courseId} />
          <div className="grid gap-1.5">
            <Label htmlFor="label">What is this code for? (optional)</Label>
            <Input
              id="label"
              name="label"
              maxLength={80}
              placeholder="e.g. Section 1, morning class"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="expires_in_days">Expires after (days)</Label>
              <Input
                id="expires_in_days"
                name="expires_in_days"
                type="number"
                min={1}
                max={365}
                inputMode="numeric"
                placeholder="Never"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="max_uses">Use limit</Label>
              <Input
                id="max_uses"
                name="max_uses"
                type="number"
                min={1}
                max={10000}
                inputMode="numeric"
                placeholder="Unlimited"
              />
            </div>
          </div>
          <Button type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create join code"}
          </Button>
        </form>
      )}

      <div className="grid gap-2">
        <h3 className="text-sm font-semibold">Active codes ({codes.length})</h3>
        {codes.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No join codes yet. Create one and share it with your students.
          </p>
        ) : (
          <ul className="grid gap-2" data-testid="join-code-list">
            {codes.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
              >
                <div>
                  <p className="font-medium">{c.label || "Join code"}</p>
                  <p className="text-muted-foreground text-xs">
                    Used {c.uses}
                    {c.maxUses !== null ? ` of ${c.maxUses}` : ""} ·{" "}
                    {c.expiresAt
                      ? `expires ${new Date(c.expiresAt).toLocaleDateString()}`
                      : "no expiry"}
                  </p>
                </div>
                {canManage && (
                  <form action={revokeFormAction}>
                    <input type="hidden" name="course_id" value={courseId} />
                    <input type="hidden" name="code_id" value={c.id} />
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      disabled={revoking}
                    >
                      Revoke
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
