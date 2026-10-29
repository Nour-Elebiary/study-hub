# Restoring Study Hub from an export

This guide is for the moment we all hope never comes: the site is gone or
broken, and the school's notes must come back. Practise these steps **once
before launch** on a throwaway Supabase project, so nobody reads them for the
first time during an emergency.

## Where the backups live

| Copy       | Where                                                     | How often                        | Kept    |
| ---------- | --------------------------------------------------------- | -------------------------------- | ------- |
| Automatic  | GitHub Actions artifacts (run of the **Backup** workflow) | Weekly (Saturday 04:00 UTC)      | 90 days |
| Human copy | Google Drive folder of the admin                          | Monthly, from the Backups screen | Forever |

The Backups screen (`/admin/backups`) shows when the last export ran and has
a **Download now** button.

## What an export contains

- `json/` — every content table (courses, notes, versions, comments, assets,
  tags, settings, AI limits) as JSON.
- `markdown/` — every note as an Obsidian-compatible Markdown file, in a
  folder per course. This doubles as the emergency read-only copy: if
  Supabase and Vercel are both unusable, publish this folder with
  [Quartz](https://quartz.jzhao.xyz/) so students can still read.
- `links.md` — the list of Google Drive and web links.
- `manifest.json` — when it was made and how many rows of each table.

**Never in the export:** AI keys, join codes, passwords, audit history, AI
chat transcripts, and the contents of uploaded files (Supabase Storage). The
export holds each file's metadata and OCR/transcript text, not the file
itself — so re-upload important files after a restore.

## The restore drill, step by step

You need: the export ZIP, a fresh Supabase project, and the project's
service-role key (Settings → API in the Supabase dashboard).

1. **Create the fresh project.** In the Supabase dashboard, make a new
   project in the same organisation. Wait until it is ready.
2. **Create the tables.** In the SQL editor, run every file in
   `supabase/migrations/` in name order (00001 first). Easiest: install the
   Supabase CLI, link the new project, and run `supabase db push`.
3. **Load the export.** From the project folder on your computer:

   ```
   set RESTORE_SUPABASE_URL=https://your-new-project.supabase.co
   set RESTORE_SERVICE_ROLE_KEY=your-new-service-role-key
   node scripts/restore.mjs path\to\study-hub-export.zip
   ```

   The script refuses to run if the project already has courses, recreates
   every leader account, and prints a row count per table.

4. **Compare the counts** with `manifest.json` inside the ZIP. They should
   match (except `auth_users`, which the script adds).
5. **Point the app at the new project.** In Vercel, replace
   `NEXT_PUBLIC_SUPABASE_URL` and the keys with the new project's values,
   then redeploy.
6. **Sign in and check.** Every leader's password was reset for safety: an
   admin uses the Leaders screen to create a temporary password for each
   leader. Then check: courses open, notes open, a comment can be written,
   the student join flow works with a freshly created join code.
7. **Re-upload what the ZIP cannot hold.** Files that lived in Supabase
   Storage must be uploaded again from the leaders' computers. Google Drive
   and web links come back automatically from `links.md`.

## After the drill

- Delete the throwaway project.
- Write the date of the drill in the school's notes, so the next person knows
  the steps still work.
