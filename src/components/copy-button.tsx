"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Copies text to the clipboard with a plain-word label. Falls back to a
 * select-all prompt when the clipboard API is unavailable (older phones).
 */
export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this text:", text);
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={copy}>
      {copied ? copiedLabel : label}
    </Button>
  );
}
