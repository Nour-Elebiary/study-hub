"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Edits the ai_limits rows (spec section 8): the numbers the router
 * projects against. Editing needs a recent login — if the admin signed in
 * more than 10 minutes ago, the endpoint asks for the password again.
 */
export function LimitsEditor({
  initialRows,
}: {
  initialRows: Array<{
    model: string;
    rpm: number;
    tpm: number;
    rpd: number;
    soft_pct: number;
  }>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update(
    index: number,
    field: "rpm" | "tpm" | "rpd" | "soft_pct",
    value: string,
  ) {
    const number = Number(value);
    setRows((prev) =>
      prev.map((row, i) =>
        i === index
          ? { ...row, [field]: Number.isFinite(number) ? number : row[field] }
          : row,
      ),
    );
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/ai/limits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows,
          password: password || undefined,
        }),
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
        setMessage(data.error ?? "The limits could not be saved.");
        return;
      }
      setMessage("Limits saved.");
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
    <div className="grid gap-3">
      <table className="w-full text-sm">
        <caption className="sr-only">AI model limits</caption>
        <thead>
          <tr className="text-muted-foreground text-left text-xs">
            <th scope="col" className="py-1 pr-2">
              Model
            </th>
            <th scope="col" className="py-1 pr-2">
              Req/min
            </th>
            <th scope="col" className="py-1 pr-2">
              Tokens/min
            </th>
            <th scope="col" className="py-1 pr-2">
              Req/day
            </th>
            <th scope="col" className="py-1">
              Soft %
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.model}>
              <th scope="row" className="py-1 pr-2 text-left font-normal">
                {row.model}
              </th>
              {(["rpm", "tpm", "rpd", "soft_pct"] as const).map((field) => (
                <td key={field} className="py-1">
                  <Input
                    aria-label={`${row.model} ${field}`}
                    className="w-20 px-2 py-1 text-sm"
                    type="number"
                    min={1}
                    value={row[field]}
                    onChange={(event) =>
                      update(index, field, event.target.value)
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {needsPassword && (
        <div className="grid gap-1.5">
          <Label htmlFor="ai-limits-password">Confirm your password</Label>
          <Input
            id="ai-limits-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </div>
      )}

      {message && <p className="text-sm">{message}</p>}

      <Button onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save limits"}
      </Button>
    </div>
  );
}
