"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The "Add your key" guided form (spec section 8): plain steps in the
 * leader's own Google account, one key per project. The pasted key is sent
 * once to POST /api/ai/keys, encrypted at rest, and never displayed again —
 * the UI shows only the last 4 characters the server returns.
 */
export function AddKeyForm() {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [projectLabel, setProjectLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/ai/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          project_label: projectLabel,
          api_key: apiKey,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "The key could not be saved. Try again.");
        return;
      }
      setLabel("");
      setProjectLabel("");
      setApiKey("");
      router.refresh();
    } catch {
      setError("Network problem. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" aria-label="Add your AI key">
      <ol className="text-muted-foreground grid list-decimal gap-1 pl-5 text-sm">
        <li>
          Open{" "}
          <span className="text-foreground font-medium">
            aistudio.google.com
          </span>{" "}
          in your own Google account and sign in.
        </li>
        <li>
          Choose “Get API key” → “Create API key”, in your own project. One key
          per project — Google counts limits per project, not per key.
        </li>
        <li>Copy the key and paste it below. It is stored encrypted.</li>
      </ol>

      <div className="grid gap-1.5">
        <Label htmlFor="ai-key-label">Name (for you)</Label>
        <Input
          id="ai-key-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="My laptop key"
          required
          maxLength={60}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="ai-key-project">Google Cloud project name</Label>
        <Input
          id="ai-key-project"
          value={projectLabel}
          onChange={(e) => setProjectLabel(e.target.value)}
          placeholder="my-study-hub-project"
          required
          maxLength={120}
          autoComplete="off"
        />
        <p className="text-muted-foreground text-xs">
          One key per project. A second key for the same project is refused.
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="ai-key-value">API key</Label>
        <Input
          id="ai-key-value"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Paste the key from AI Studio"
          required
          minLength={20}
          autoComplete="off"
        />
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save key"}
      </Button>
    </form>
  );
}
