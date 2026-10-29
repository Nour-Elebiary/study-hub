"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SettingDef, SettingsMap } from "@/lib/settings";

/**
 * The Settings form (spec section 9). Mirrors the AI limits editor: one
 * save button, and a password prompt appears when the admin's sign-in is
 * older than 10 minutes (spec section 9 rule 1).
 */
export function SettingsEditor({
  defs,
  initialValues,
}: {
  defs: SettingDef[];
  initialValues: SettingsMap;
}) {
  const router = useRouter();
  const [values, setValues] = useState<SettingsMap>(initialValues);
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update(key: string, value: string) {
    const def = defs.find((d) => d.key === key);
    if (!def) return;
    if (def.kind === "number") {
      const number = Number(value);
      setValues((prev) => ({
        ...prev,
        [key]: Number.isFinite(number) ? number : prev[key],
      }));
    } else {
      setValues((prev) => ({ ...prev, [key]: value }));
    }
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const def of defs) {
        payload[def.key] = values[def.key];
      }
      if (password) payload.password = password;
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        error?: string;
        needsPassword?: boolean;
      };
      if (res.status === 401 && data.needsPassword) {
        setNeedsPassword(true);
        setMessage(data.error ?? "Please confirm your password.");
        return;
      }
      if (!res.ok) {
        setMessage(data.error ?? "The settings could not be saved.");
        return;
      }
      setMessage("Settings saved.");
      setPassword("");
      setNeedsPassword(false);
      router.refresh();
    } catch {
      setMessage("Network problem. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4">
      {message && (
        <p
          role={needsPassword ? "alert" : "status"}
          className={needsPassword ? "text-destructive text-sm" : "text-sm"}
        >
          {message}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {defs.map((def) => (
          <div key={def.key} className="grid gap-1.5">
            <Label htmlFor={`setting-${def.key}`}>{def.label}</Label>
            <Input
              id={`setting-${def.key}`}
              value={String(values[def.key] ?? "")}
              onChange={(e) => update(def.key, e.target.value)}
              type={def.kind === "number" ? "number" : "text"}
              min={def.min}
              max={def.max}
              inputMode={def.kind === "number" ? "numeric" : undefined}
            />
            <p className="text-muted-foreground text-xs">{def.hint}</p>
          </div>
        ))}
      </div>
      {needsPassword && (
        <div className="grid gap-1.5">
          <Label htmlFor="settings-password">
            Confirm your password to save
          </Label>
          <Input
            id="settings-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
      )}
      <div>
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
