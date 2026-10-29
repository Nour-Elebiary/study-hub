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
