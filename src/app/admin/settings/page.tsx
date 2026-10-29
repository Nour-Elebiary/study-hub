import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { readSettings, SETTING_DEFS } from "@/lib/settings";
import { SettingsEditor } from "@/app/admin/settings/settings-editor";

export const metadata: Metadata = { title: "Settings" };

/**
 * The Settings screen (spec section 9): size limits, retention days, the AI
 * allowance, the site name, and the free-tier limits the health screen
 * measures against. Every value lives in the settings table — never in code
 * (constitution rule 8).
 */
export default async function SettingsPage() {
  await requireAdmin();
  const values = await readSettings();

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Limits and names the whole site uses. Saving needs a recent sign-in:
          if you signed in more than 10 minutes ago, you will be asked for your
          password again.
        </p>
      </div>
      <SettingsEditor defs={SETTING_DEFS} initialValues={values} />
    </div>
  );
}
