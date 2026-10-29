import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Backups" };

/**
 * The Backups screen (spec section 9): the time of the last export, a
 * Download now button, and the restore steps. The weekly GitHub Actions job
 * also calls the same export endpoint with the backup token; this screen is
 * for the monthly "save a copy to Google Drive" routine (section 11 rule 3).
 */
export default async function BackupsPage() {
  await requireAdmin();

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("settings")
    .select("value")
    .eq("key", "last_export_at")
    .maybeSingle();
  const lastExportAt =
    rows && typeof rows.value === "string" ? rows.value : null;

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-bold">Backups</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          A weekly automatic export runs on GitHub Actions and is kept for 90
          days. Once a month, download the latest copy here and save it to
          Google Drive as well.
        </p>
      </div>

      <div className="rounded-md border p-4 text-sm">
        <h2 className="font-semibold">Last export</h2>
        <p className="text-muted-foreground mt-1" data-testid="last-export">
          {lastExportAt
            ? new Date(lastExportAt).toLocaleString()
            : "No export has run yet."}
        </p>
        <form method="post" action="/api/admin/export" className="mt-3">
          <button
            type="submit"
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center rounded-md px-3 text-sm font-medium"
          >
            Download now (ZIP)
          </button>
        </form>
      </div>

      <div className="rounded-md border p-4 text-sm">
        <h2 className="font-semibold">What is inside the export</h2>
        <ul className="text-muted-foreground mt-2 list-disc pl-5">
          <li>
            Every content table as JSON (courses, notes, versions, comments,
            assets, settings)
          </li>
          <li>An Obsidian-compatible Markdown copy of every note</li>
          <li>The list of Google Drive and web links</li>
        </ul>
        <p className="text-muted-foreground mt-2">
          AI keys and join codes are never included — they are secret material.
        </p>
      </div>

      <div className="rounded-md border p-4 text-sm">
        <h2 className="font-semibold">Restore steps</h2>
        <p className="text-muted-foreground mt-2">
          If the site is ever lost, follow{" "}
          <code className="bg-muted rounded px-1">docs/restore.md</code> in the
          project folder: it loads an export into a fresh Supabase project with{" "}
          <code className="bg-muted rounded px-1">
            node scripts/restore.mjs
          </code>
          . Practise the drill once before launch, so nobody reads these steps
          for the first time during an emergency.
        </p>
      </div>
    </div>
  );
}
