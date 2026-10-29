import { setAllowanceAction } from "@/app/admin/ai/actions";
import { LimitsEditor } from "@/components/ai/limits-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { applyAiRetention, getAiUsageOverview } from "@/lib/ai/admin";
import { requireAdmin } from "@/lib/admin-auth";

export const metadata = { title: "AI usage — Study Hub admin" };

/**
 * The admin AI screen (spec section 8): each key's usage bars and cooldown,
 * the editable ai_limits rows, and the fair-use allowance. Opening this
 * page also runs the retention cleanup (docs/QUESTIONS.md #20).
 */
export default async function AdminAiPage() {
  await requireAdmin();
  const deleted = await applyAiRetention();
  const overview = await getAiUsageOverview();

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold">AI usage</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Every leader uses their own Gemini key. The bars show what the app
          counted per key; a real 429 from Google is the final truth and cools
          the key until midnight Pacific time.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Overview</CardTitle>
          <CardDescription>
            {overview.totals.conversations} conversations ·{" "}
            {overview.totals.messages} messages
            {deleted > 0 && ` · ${deleted} old messages deleted just now`}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          <form
            action={setAllowanceAction}
            className="flex flex-wrap items-end gap-2"
          >
            <div>
              <label
                htmlFor="ai-allowance"
                className="text-muted-foreground block text-xs"
              >
                Fair-use daily allowance per leader (0 = AI off)
              </label>
              <Input
                id="ai-allowance"
                name="allowance"
                type="number"
                min={0}
                max={10000}
                defaultValue={overview.allowance}
                className="mt-1 w-28"
              />
            </div>
            <Button type="submit" variant="outline" size="sm">
              Save allowance
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Keys and usage bars</CardTitle>
          <CardDescription>
            Today = since midnight US Pacific (Google&apos;s daily reset).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {overview.keys.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No keys added yet. Leaders add their own on the AI key page.
            </p>
          )}
          {overview.keys.map((key) => {
            const limit = overview.limits.find(
              (l) => l.model === "gemini-2.5-flash-lite",
            );
            const dayRequests = Object.values(key.day).reduce(
              (sum, usage) => sum + usage.requests,
              0,
            );
            const dayTokens = Object.values(key.day).reduce(
              (sum, usage) => sum + usage.tokens,
              0,
            );
            const rpd = limit?.rpd ?? 1;
            const pct = Math.min(100, Math.round((dayRequests / rpd) * 100));
            return (
              <div key={key.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {key.label} — {key.owner_name}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      Project: {key.project_label} · key ends {key.key_last4}
                    </p>
                  </div>
                  <Badge
                    variant={
                      key.status === "active"
                        ? "default"
                        : key.status === "cooling"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {key.status === "cooling"
                      ? `Cooling until ${key.cooldown_until?.slice(11, 16) ?? ""} UTC`
                      : key.status === "disabled"
                        ? "Disabled"
                        : "Active"}
                  </Badge>
                </div>
                <div
                  className="bg-muted mt-2 h-2 w-full overflow-hidden rounded-full"
                  role="img"
                  aria-label={`Today's requests: ${dayRequests} of about ${rpd}`}
                >
                  <div
                    className={
                      pct > 80 ? "h-full bg-red-500" : "bg-primary h-full"
                    }
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  {dayRequests} requests · ~{dayTokens.toLocaleString()} tokens
                  today
                </p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Model limits</CardTitle>
          <CardDescription>
            The numbers the router plans with. Verify them against Google&apos;s
            rate-limits page before changing — a real 429 always wins.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LimitsEditor initialRows={overview.limits} />
        </CardContent>
      </Card>
    </div>
  );
}
