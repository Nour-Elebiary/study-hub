"use client";

import { useActionState } from "react";
import { joinAction } from "@/app/s/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function JoinForm() {
  const [state, formAction, pending] = useActionState(joinAction, null);

  return (
    <form action={formAction} className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="code">Join code</Label>
        <Input
          id="code"
          name="code"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          placeholder="ABCD-EFGH"
          required
          className="h-12 text-center text-lg tracking-widest uppercase"
        />
      </div>
      {state?.error && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Checking…" : "Open my courses"}
      </Button>
    </form>
  );
}
