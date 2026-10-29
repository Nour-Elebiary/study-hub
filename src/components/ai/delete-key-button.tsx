"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Removes one of the leader's own keys. The ciphertext is deleted with the
 * row (DELETE /api/ai/keys/[keyId]); the UI only ever held the masked form.
 */
export function DeleteKeyButton({
  keyId,
  label,
}: {
  keyId: string;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (
      !window.confirm(
        `Delete the key "${label}"? AI requests will stop using it until you add another.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/ai/keys/${keyId}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={remove} disabled={busy}>
      {busy ? "Deleting…" : "Delete"}
    </Button>
  );
}
