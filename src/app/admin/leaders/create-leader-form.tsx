"use client";

import { useActionState } from "react";
import {
  createLeaderAction,
  type LeaderActionState,
} from "@/app/admin/leaders/actions";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Create-a-leader flow (spec section 9): name + email, then the temporary
 * password is shown once with a ready-to-send message.
 */
export function CreateLeaderForm() {
  const [state, action, pending] = useActionState<LeaderActionState, FormData>(
    createLeaderAction,
    null,
  );

  if (state && "ok" in state && state.credentials) {
    const { email, temporaryPassword } = state.credentials;
    const message = [
      `Welcome to Study Hub: ${typeof window !== "undefined" ? window.location.origin : ""}`,
      `Sign in with: ${email}`,
      `Temporary password: ${temporaryPassword}`,
      "You will choose your own password at first sign-in.",
    ].join("\n");

    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account created</CardTitle>
          <CardDescription>
            Show the password once now — it is not stored where you can see it
            again. The leader must choose a new password at first sign-in.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="font-medium break-all">{email}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Temporary password</dt>
              <dd className="font-mono text-base font-medium break-all">
                {temporaryPassword}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={message} label="Copy message" />
          </div>
          <p className="text-muted-foreground text-xs whitespace-pre-line">
            {message}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New leader</CardTitle>
        <CardDescription>
          The leader signs in with the email and a temporary password you share.
          No email is sent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="display_name">Name</Label>
            <Input
              id="display_name"
              name="display_name"
              autoComplete="off"
              required
              minLength={2}
              maxLength={80}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="off"
              inputMode="email"
              required
            />
          </div>
          {state && "error" in state && state.error && (
            <p role="alert" className="text-destructive text-sm">
              {state.error}
            </p>
          )}
          {state && "needsPassword" in state && state.needsPassword && (
            <ConfirmPasswordField />
          )}
          <Button type="submit" disabled={pending} className="mt-2">
            {pending ? "Creating…" : "Create leader"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Shown when the admin has been signed in for more than 10 minutes: a
 * sensitive action needs the admin's password again (spec section 9 rule 1).
 */
export function ConfirmPasswordField() {
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <Label htmlFor="confirm_password">
        Confirm your password to continue
      </Label>
      <Input
        id="confirm_password"
        name="confirm_password"
        type="password"
        autoComplete="current-password"
        required
      />
    </div>
  );
}
