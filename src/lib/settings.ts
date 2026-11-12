import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type SettingKind = "text" | "number";

export type SettingDef = {
  key: string;
  label: string;
  hint: string;
  kind: SettingKind;
  defaultValue: string | number;
  min?: number;
  max?: number;
};

/**
 * Every setting the app reads, with its plain-language label and default
 * (spec section 9, Settings row: size limits, retention days, feature
 * flags, site name; constitution rule 8: limits live in the settings
 * table, never hard-coded). There are no feature flags in v1 — when one is
 * added it becomes a boolean row here (docs/QUESTIONS.md #21).
 */
export const SETTING_DEFS: SettingDef[] = [
  {
    key: "site_name",
    label: "Site name",
    hint: "Shown on the sign-in page and in messages to leaders.",
    kind: "text",
    defaultValue: "Study Hub",
  },
  {
    key: "max_file_mb",
    label: "Biggest file size (MB)",
    hint: "Uploads larger than this are refused. The storage bucket also has its own hard cap of 10 MB.",
    kind: "number",
    defaultValue: 10,
    min: 1,
    max: 50,
  },
  {
    key: "retention_ai_days",
    label: "Keep AI chats for (days)",
    hint: "Older AI conversations are deleted automatically.",
    kind: "number",
    defaultValue: 90,
    min: 7,
    max: 365,
  },
  {
    key: "retention_audit_days",
    label: "Keep the audit log for (days)",
    hint: "Older audit entries are deleted automatically.",
    kind: "number",
    defaultValue: 365,
    min: 30,
    max: 3650,
  },
  {
    key: "retention_deleted_note_days",
    label: "Keep deleted notes for (days)",
    hint: "A deleted note can be restored during this window, then disappears for good.",
    kind: "number",
    defaultValue: 30,
    min: 1,
    max: 365,
  },
  {
    key: "ai_daily_allowance_per_leader",
    label: "Daily AI allowance per leader",
    hint: "How many AI messages each leader may send per day. 0 turns AI off.",
    kind: "number",
    defaultValue: 0,
    min: 0,
    max: 10_000,
  },
  {
    key: "db_limit_mb",
    label: "Database size limit (MB)",
    hint: "The free-tier database size the health screen measures against. Supabase free gives 500 MB.",
    kind: "number",
    defaultValue: 500,
    min: 100,
    max: 10_000,
  },
  {
    key: "storage_limit_mb",
    label: "Storage size limit (MB)",
    hint: "The free-tier file storage the health screen measures against. Supabase free gives 1 GB.",
    kind: "number",
    defaultValue: 1024,
    min: 100,
    max: 10_000,
  },
  // M9 canvas (spec section 10). The keys for M10-M13 milestones
  // (import, vault export, realtime, events, read counts) are registered
  // now so the Settings screen shows the full picture at once.
  {
    key: "max_canvas_cards",
    label: "Most cards on one map",
    hint: "A map cannot hold more cards than this. Keep it lower on small screens.",
    kind: "number",
    defaultValue: 300,
    min: 20,
    max: 1000,
  },
  {
    key: "rate_canvas_create_per_hour",
    label: "New maps per hour per internet address",
    hint: "Stops a runaway loop that keeps creating maps. Default 20 (spec section 10).",
    kind: "number",
    defaultValue: 20,
    min: 1,
    max: 500,
  },
  {
    key: "rate_canvas_ops_per_minute",
    label: "Map edit batches per minute per internet address",
    hint: "Stops a runaway loop of map edits. Normal editing is far below this. Default 240 (spec section 10).",
    kind: "number",
    defaultValue: 240,
    min: 20,
    max: 2000,
  },
  {
    key: "rate_login_per_15_min",
    label: "Sign-in attempts per 15 minutes per internet address",
    hint: "Slows password guessing. Normal staff sign in far less often. Default 5.",
    kind: "number",
    defaultValue: 5,
    min: 1,
    max: 100,
  },
  {
    key: "max_canvases_per_course",
    label: "Most maps per course",
    hint: "A course cannot have more maps than this.",
    kind: "number",
    defaultValue: 20,
    min: 1,
    max: 100,
  },
  {
    key: "canvas_version_keep_auto",
    label: "Automatic map backups to keep",
    hint: "Older automatic backups (snapshots taken during editing) are deleted automatically. Manual backups are kept forever.",
    kind: "number",
    defaultValue: 30,
    min: 5,
    max: 100,
  },
  {
    key: "canvas_import_max_kb",
    label: "Largest map file you can import (KB)",
    hint: "Imports of .canvas files larger than this are refused.",
    kind: "number",
    defaultValue: 1024,
    min: 64,
    max: 4096,
  },
  {
    key: "vault_export_max_mb",
    label: "Largest Obsidian download (MB)",
    hint: "A vault export bigger than this is refused.",
    kind: "number",
    defaultValue: 200,
    min: 10,
    max: 500,
  },
  {
    key: "realtime_enabled",
    label: "Live editing together (1 = on)",
    hint: "Set to 0 to turn off live co-working on maps.",
    kind: "number",
    defaultValue: 1,
    min: 0,
    max: 1,
  },
  {
    key: "max_live_editors_per_canvas",
    label: "Leaders who can edit one map live",
    hint: "How many leaders may edit the same map at the same moment.",
    kind: "number",
    defaultValue: 5,
    min: 1,
    max: 10,
  },
  {
    key: "max_events_per_course",
    label: "Most calendar entries per course",
    hint: "A course calendar cannot hold more entries than this.",
    kind: "number",
    defaultValue: 200,
    min: 10,
    max: 1000,
  },
  {
    key: "retention_view_counts_days",
    label: "Days to keep note read counts",
    hint: "Older read counts are deleted automatically.",
    kind: "number",
    defaultValue: 365,
    min: 30,
    max: 1095,
  },
];

export type SettingsMap = Record<string, string | number>;

/** The default value of a setting, for readers that miss a row. */
export function settingDefault(key: string): string | number {
  const def = SETTING_DEFS.find((d) => d.key === key);
  return def ? def.defaultValue : "";
}

/**
 * Reads every known setting and fills in defaults for missing rows, so the
 * screen always shows a complete, editable picture.
 */
export async function readSettings(): Promise<SettingsMap> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("settings").select("key, value");
  if (error) {
    throw new Error(`Could not read settings: ${error.message}`);
  }
  const map: SettingsMap = {};
  for (const def of SETTING_DEFS) {
    map[def.key] = def.defaultValue;
  }
  for (const row of data ?? []) {
    if (map[row.key] !== undefined) {
      map[row.key] = row.value as string | number;
    }
  }
  return map;
}

/** Writes one setting row (upsert by primary key). */
export async function writeSetting(
  key: string,
  value: string | number,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("settings").upsert({ key, value });
  if (error) {
    throw new Error(`Could not save ${key}: ${error.message}`);
  }
}
