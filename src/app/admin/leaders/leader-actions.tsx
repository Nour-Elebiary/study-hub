"use client";

import { useActionState } from "react";
import {
  resetLeaderPasswordAction,
  setLeaderActiveAction,
  softDeleteLeaderAction,
  type LeaderActionState,
} from "@/app/admin/leaders/actions";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { ConfirmPasswordField } from "@/app/admin/leaders/create-leader-form";

type Leader = {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  isDeleted: boolean;
  isAdmin: boolean;
};

/**
 * Per-leader actions: disable/enable, reset password, soft-delete.
 * Each is a sensitive action, so each may ask for the admin's password.
 */
export function LeaderActions({ leader }: { leader: Leader }) {
  const [activeState, submitActive, pendingActive] = useActionState<
    LeaderActionState,
    FormData
  >(setLeaderActiveAction, null);
  const [resetState, submitReset, pendingReset] = useActionState<
    LeaderActionState,
    FormData
  >(resetLeaderPasswordAction, null);
  const [deleteState, submitDelete, pendingDelete] = useActionState<
    LeaderActionState,
    FormData
  >(softDeleteLeaderAction, null);

  const resetCredentials =
    resetState && "ok" in resetState && resetState.credentials
      ? resetState.credentials
      : null;

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <form action={submitActive}>
          <input type="hidden" name="user_id" value={leader.id} />
          <input
            type="hidden"
            name="make_active"
            value={(!leader.isActive).toString()}
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={pendingActive}
          >
            {leader.isActive ? "Disable" : "Enable"}
          </Button>
        </form>

        <form action={submitReset}>
          <input type="hidden" name="user_id" value={leader.id} />
          <input type="hidden" name="email" value={leader.email} />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={pendingReset}
          >
            Reset password
          </Button>
        </form>

        {!leader.isDeleted && (
          <form action={submitDelete}>
            <input type="hidden" name="user_id" value={leader.id} />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={pendingDelete}
            >
              Delete
            </Button>
          </form>
        )}
      </div>

      {(activeState && "error" in activeState && activeState.error) ||
      (deleteState && "error" in deleteState && deleteState.error) ? (
        <p role="alert" className="text-destructive text-sm">
          {(activeState && "error" in activeState && activeState.error) ||
            (deleteState && "error" in deleteState && deleteState.error)}
        </p>
      ) : null}

      {activeState &&
        "needsPassword" in activeState &&
        activeState.needsPassword && (
          <form action={submitActive} className="grid gap-2">
            <input type="hidden" name="user_id" value={leader.id} />
            <input
              type="hidden"
              name="make_active"
              value={(!leader.isActive).toString()}
            />
            <ConfirmPasswordField />
            <Button type="submit" size="sm" disabled={pendingActive}>
              Confirm and continue
            </Button>
          </form>
        )}

      {deleteState &&
        "needsPassword" in deleteState &&
        deleteState.needsPassword && (
          <form action={submitDelete} className="grid gap-2">
            <input type="hidden" name="user_id" value={leader.id} />
            <ConfirmPasswordField />
            <Button type="submit" size="sm" disabled={pendingDelete}>
              Confirm and delete
            </Button>
          </form>
        )}

      {resetCredentials && (
        <div className="grid gap-2 rounded-md border p-3 text-sm">
          <p className="text-muted-foreground">
            New temporary password for {leader.displayName} — shown once:
          </p>
          <p className="font-mono text-base font-medium break-all">
            {resetCredentials.temporaryPassword}
          </p>
          <CopyButton
            text={[
              `Your Study Hub password was reset.`,
              `Sign in with: ${resetCredentials.email}`,
              `Temporary password: ${resetCredentials.temporaryPassword}`,
              "You will choose a new password at sign-in.",
            ].join("\n")}
            label="Copy message"
          />
        </div>
      )}

      {resetState && "error" in resetState && resetState.error && (
        <p role="alert" className="text-destructive text-sm">
          {resetState.error}
        </p>
      )}
      {resetState &&
        "needsPassword" in resetState &&
        resetState.needsPassword && (
          <form action={submitReset} className="grid gap-2">
            <input type="hidden" name="user_id" value={leader.id} />
            <input type="hidden" name="email" value={leader.email} />
            <ConfirmPasswordField />
            <Button type="submit" size="sm" disabled={pendingReset}>
              Confirm and reset
            </Button>
          </form>
        )}
    </div>
  );
}
