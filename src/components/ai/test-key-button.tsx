"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * The Test button (spec section 8): one tiny call on the leader's own key
 * to prove it works before it is relied on. The key never leaves the
 * server; the button only shows success or a plain-language reason.
 */
export function TestKeyButton({ keyId }: { keyId: string }) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "ok" }
    | { kind: "fail"; message: string }
  >({ kind: "idle" });

  async function test() {
    setState({ kind: "busy" });
    try {
      const res = await fetch(`/api/ai/keys/${keyId}/test`, {
        method: "POST",
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setState({ kind: "ok" });
        return;
      }
      setState({
        kind: "fail",
        message: data.error ?? "The test could not run. Try again.",
      });
    } catch {
      setState({
        kind: "fail",
        message: "Network problem. Check your connection and try again.",
      });
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={test}
        disabled={state.kind === "busy"}
      >
        {state.kind === "busy" ? "Testing…" : "Test"}
      </Button>
      {state.kind === "ok" && (
        <p className="text-xs text-green-700 dark:text-green-400" role="status">
          Key works.
        </p>
      )}
      {state.kind === "fail" && (
        <p
          className="text-destructive max-w-56 text-right text-xs"
          role="alert"
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
