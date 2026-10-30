# Study Hub — The Complete Project Guide

*Everything in one file: what the product is, how every screen looks and behaves, how
every piece connects to every other piece, and what software, technologies and
platforms make it run.*

This document is written in two registers on purpose: the story sections (1, 2, 7, 9)
are plain language for non-technical leaders, and the reference sections (3–6, 8, 10–17)
are technical detail for anyone maintaining the code. All facts come from the actual
source code in this repository as of October 2026.

---

## Table of contents

1. What the product is
2. Who uses it (the three audiences)
3. The big picture — how every piece connects
4. Platforms and technologies
5. Every dependency and its purpose
6. The data model
7. The user experience, screen by screen
8. Authentication and identity
9. The content lifecycle (how a note travels through the app)
10. The jobs system (browser tier vs Home Worker tier)
11. The AI subsystem (M7)
12. Rate limits and abuse controls
13. Settings (limits live in the database, not in code)
14. Server-side surface: server actions and API routes
15. The Home Worker (Python)
16. Backups, keep-alive, restore, and CI/CD
17. Testing and quality gates
18. Seed data and the hosted project's current state
19. Repository map
20. The documentation set

---

## 1. What the product is

Study Hub is a shared notes platform for a study group. Leaders (admins) create
**courses**, fill them with **notes** (rich-text documents about specific topics),
attach **files** (photos, PDFs, audio, video, Word documents), give each note
**tags**, and publish them. Students join each course with a **join code** — no
accounts, no passwords, no email — and read the notes on their phones.

The notes can include processed material: a photo of a whiteboard run through
OCR, a lecture recording turned into a transcript, a Word document converted
to Markdown, a video compressed or converted. Heavy processing is done either
in the leader's own browser or by an optional **Home Worker** — a small Python
program run on the leader's own PC — so the platform itself stays inside the
free tiers of its services.

There is also an **AI side panel**: leaders can bring their own Google AI
(Gemini) API keys, created in their own Google account, and use AI to answer
questions about the notes, draft content, and improve their writing. The AI is
quarantined per key so one leader's key never serves another leader's traffic.

Everything is mobile-first (tested at 360 px width), works offline once
installed as a PWA, and is governed by a explicit role model with
Postgres-enforced access control.

## 2. Who uses it (the three audiences)

| Audience | Account? | Signs in how | What they can do |
|---|---|---|---|
| **Admin** | Yes (email + password in Supabase GoTrue) | `/login` | Everything: manage team members, courses and their contents, roles, settings, AI limits, backups, audit log, health dashboard |
| **Leader** | Yes | `/login` | The everyday creator: courses they own, note writing in TipTap, file uploads, jobs, tags, comments, the map, AI panel, own AI keys |
| **Student** | **No account at all** | Opens a join link / types join code at `/s/join` | Read-only view of the courses they joined, in a simplified interface — tracked by a signed browser cookie |

A screening password gate applies to chosen accounts: an admin flips
`must_change_password` on a team member, and that person must set a new password
at `/reset-password` before they can reach any app screen. Students never touch
this — they have no passwords.

## 3. The big picture — how every piece connects

```
                    ┌────────────────────────────────────────────┐
                    │                 STUDENTS                   │
                    │     join code → signed cookie → /s/*       │
                    └────────────────────┬───────────────────────┘
                                         │ read-only
┌──────────────┐   HTTPS    ┌────────────▼────────────────────────┐
│   Leaders &  │───────────▶│        Next.js app (Vercel)         │
│    Admins    │            │  31 pages · 12 API routes ·         │
└──────────────┘            │  server actions · proxy session     │
                            └──┬─────────────┬───────────┬────────┘
                               │             │           │
             Supabase-js (anon │             │           │ Supabase Storage
             or service-role)  │             │           │ (private "assets" bucket)
                               ▼             ▼           ▼
                    ┌─────────────────────────────────────────────┐
                    │        Supabase hosted project              │
                    │  Postgres + RLS (22 public tables)          │
                    │  GoTrue auth  ·  Storage  ·  rate_limits    │
                    └────────────▲───────────────▲────────────────┘
                                 │               │
            ┌────────────────────┘               └───────────────────┐
            │ claim / complete (bearer worker token)                 │ Gemini REST API
            │                                                        │ (per-leader keys)
   ┌────────┴─────────┐                                    ┌──────────┴──────────┐
   │   Home Worker    │                                    │      AI router      │
   │  (leader's PC)   │        leader's own browser        │ /api/ai/task · chat │
   │ Python + ffmpeg  │        runs light jobs itself:     │ round-robin over    │
   │ OCR·convert·     │        tesseract.js, pdf-lib,      │ OWN keys, projected │
   │ audio, video,    │        mammoth+turndown, xlsx,    │ quota maths, 429 →  │
   │ transcribe       │        Whisper (transformers.js)   │ cooldown, next key  │
   └──────────────────┘                                    └─────────────────────┘

   GitHub Actions:  ci.yml (quality · RLS · e2e)   backup.yml (weekly export ZIP)
                    keepalive.yml (daily /api/health ping so Supabase Free never sleeps)
```

The glue points, one sentence each:

- **Every screen → a server action or API route → validated input (zod) → the Data
  Access Layer (`dal.ts`) → Supabase → Postgres, where Row Level Security has the
  final say no matter what the app code did.**
- **Students bypass accounts entirely** — `student-cookie.ts` mints a signed cookie
  holding their memberships; `student-access.ts` turns that cookie into the same
  course-profiles the RLS function `can_access_course` uses.
- **Files go browser → Storage directly** (never through the Next server); the
  storage bucket's own policies check the `{course_id}/…` path prefix.
- **Heavy jobs** are queued as rows in `public.jobs`; a shared pure module
  (`jobs.ts`) decides the runner (browser / worker / ai), the browser runners
  finish light ones in-page, the Python Home Worker polls `claim`/`complete` for
  heavy ones.
- **AI requests** never go browser→Google directly; the server decrypts the
  caller's own key, projects quota usage against `ai_limits`, and streams Gemini's
  answer back as server-sent events.
- **CI** runs on every push: lint + typecheck + Prettier + unit tests, RLS tests
  against a local Supabase, and Playwright e2e (accessibility-inclusive) against a
  seeded local Supabase.

## 4. Platforms and technologies

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16.4.3** (App Router, Turbopack, `tsx` via `next typegen`) | Server components for fast reads, server actions for writes, API routes for the worker/AI protocols |
| UI runtime | **React 19.3** | The current stable concurrent runtime |
| Language | **TypeScript, strict, no `any`** (constitution rule 3) | Mistakes surface at compile time, not in class |
| Styling | **Tailwind CSS 4** | Utility-first, small stylesheet, dark-mode-aware classes |
| Database | **Supabase (hosted, Postgres 15+)** project ref `mgabdxvrlnctbgvipvvf` (eu-north-1) | Free tier, managed auth + storage + Postgres with RLS |
| Auth | **GoTrue** (Supabase Auth) | Email+password for team members only |
| Storage | **Supabase Storage**, one private bucket `assets` | RLS-checked assets, direct browser upload |
| Deployment | **Vercel**-style hosting (code reads Vercel's `x-forwarded-for` proxies) | The `APP_URL` secret points at the live deployment |
| Local jobs (browser) | **tesseract.js**, pdf-lib, mammoth + turndown, xlsx (vendored), Whisper via @huggingface/transformers | Runs on the learner's/leader's own device — zero server cost |
| Heavy jobs | **Python 3 worker** with ffmpeg + tesseract CLI (`worker/`) | A leader's own PC does the heavy lifting free |
| AI | **Google Gemini API** via per-leader keys | Bring-your-own-key with admin-enforced per-key quotas |
| CI/CD, backups | **GitHub Actions** (`ci.yml`, `backup.yml`, `keepalive.yml`) | Free runner minutes, loud failures by email |
| Tests | **Vitest 5** (unit), **Playwright 1.64.1** (e2e + axe-core a11y), **pg**-based RLS tests | Three independent nets |
| PWA | Manifest + `public/sw.js` service worker | Installed app, offline shell |

## 5. Every dependency and its purpose

**Runtime dependencies** (`package.json` `dependencies`):

| Package | Purpose |
|---|---|
| `next` 16.4.3 / `react` / `react-dom` 19.3 | Framework and UI |
| `@supabase/ssr` ^0.12.7 | Cookie-based Supabase clients for Next (server, middleware, browser) |
| `@supabase/supabase-js` ^2.118.0 | The actual Supabase http/db/storage client |
| `@tiptap/*` 3.32.0 | The rich-text note editor: `@tiptap/react` + `@tiptap/core`, `@tiptap/starter-kit` (headings, bold/italic, lists…), `@tiptap/pm` (ProseMirror), table extensions (`-table`, `-table-cell`, `-table-header`, `-table-row`), and `@tiptap/markdown` for Markdown serialisation |
| `@xyflow/react` | The course **mind map** (drag/pan/zoom React Flow canvas) |
| `zod` 4 | Validate every input at the boundary (server actions, API routes, job params) |
| `tesseract.js` | OCR in the browser for photos (job runner `browser`) |
| `pdfjs-dist` | Reading PDF text/pages in the browser (PDF tools + PDF-scan OCR preflight) |
| `pdf-lib` | Merge / split PDFs in the browser |
| `mammoth` + `turndown` | Word (.docx) → HTML → Markdown in the browser |
| `jszip` | ZIP assembly for the admin export (`/api/admin/export`) and merge inputs |
| `xlsx` (pinned `file:vendor/xlsx-0.20.3.tgz`) | Excel → CSV in the browser; pinned locally for npm audit reasons |
| `qrcode` | Join-code QR codes shown to leaders |
| `@huggingface/transformers` 4.3.2 | **Whisper** running in the leader's browser (the `browser` transcription fallback, audio ≤ 10 min) |
| `next-intl` | i18n plumbing; `en` shipped (`src/messages/en.json`) |

**Dev dependencies**: `playwright` (+ `axe-core` injected for accessibility checks),
`vitest` 5, `tailwindcss` 4 + PostCSS, `@types/*` and `typescript`,
`prettier` (format gate in CI), `eslint` 9 with Next preset, `pg` (runs
`scripts/test-rls.mjs` against local Supabase), `@next/eslint-plugin-next`.

**Worker side** (`worker/requirements.txt`): `python-dotenv`, `requests`, plus
ffmpeg/tesseract binaries installed by `worker/install.ps1`.

## 6. The data model

**22 public tables + 1 private schema table**, created and evolved across **17
migrations** (`supabase/migrations/00001` … `00017`). Every table has RLS
**enabled and forced**; users own nothing the database itself doesn't confirm
(46+ policies).

| Migration | Milestone | Creates / changes |
|---|---|---|
| `00001_foundation_schema` | M0 | `profiles`, `courses`, `course_members`, `settings`, `audit_log` |
| `00002_m1_admin` | M1 | admin check function, admin-guard, audit triggers, settings reader RPC |
| `00003_m1_roles` | (same area) | role enums/refinements |
| `00004_m1_admin` | M1 | invites + admin flows |
| `00005_m2_content` | M2 | `nodes`, `node_versions` (immutable), `tags`, `node_tags`, `comments`, `locks` |
| `00006_m3_assets` | M3 | `assets` + the private storage bucket + `can_access_storage_path` |
| `00007_m4_student` | M4 | `join_codes` (hashed), `suggestions`, `private.rate_limits` |
| `00008_m5_jobs` | M5 | `jobs` |
| `00009_m6_worker` | M6 | `worker_heartbeats`, worker bookings, double-claim protection |
| `00010_m7_ai` | M7 | `ai_keys`, `ai_limits`, `ai_usage`, `ai_conversations`, `ai_messages`, `ai_handoffs` |
| `00011_m7_ai_limits_defaults` | M7 | default model-limit rows |
| `00012_m8_health` | M8 | health-check function, audit-log/db usage RPCs |
| `00013_node_versions_immutable` | hardening | no UPDATE/DELETE on versions except owner-editor |
| `00014_rate_limit_execute` | hardening | `EXECUTE` revoked from client roles |
| `00015_jobs_created_by_default` | hardening | RLS insert fix for `jobs` |
| `00016_touch_updated_at_search_path` | hardening | `search_path=''` on `set_updated_at` |
| `00017_drop_password_trigger` | bug fix #1 | removed the GoTrue `on_user_password_changed` trigger that disarmed the password gate |

**The tables, by domain:**

- **Team & settings** — `profiles` (per-user: role `admin`/`leader`, display
  name, password gate flag `must_change_password`, onboarding flag
  `tour_done`), `settings` (run-time limits/labels), `audit_log` (who did what
  to what, when).
- **Content** — `courses` (id, name, join policy), `course_members`
  (role in the course: `owner`, `editor`, `contributor`, `reviewer`),
  `nodes` (a note: course, area, title, slug, published version pointer),
  `node_versions` (**immutable** snapshots of the note body — the published
  one is pointed at from `nodes.published_version_id`), `tags` +
  `node_tags` (many-to-many), `comments`, `locks` (who's editing what right now).
- **Assets** — one row per file: course, optional node, storage path, kind
  (image/pdf/audio/video/document), bytes, `ai_allowed` flag (flipped
  server-side only).
- **Students** — `join_codes` (hash of the code, not the code itself),
  `suggestions` (student-suggested content awaiting a leader).
- **Jobs** — `jobs` (`type` ∈ ocr/convert/transcribe/ai_task, `params` JSONB
  discriminated union, `runner`, `status` ∈ queued/running/done/failed/waiting_quota,
  attempts + retry timestamps), `worker_heartbeats`.
- **AI** — `ai_keys` (owner's key, *ciphertext*, project label, status,
  cooldown), `ai_limits` (admin-editable per-model rpm/tpm/rpd + soft %), `ai_usage`
  (minute-bucket + day-bucket counters, Pacific-midnight days), `ai_conversations`
  / `ai_messages` / `ai_handoffs` (chat threads shared into a note).
- **Private** — `private.rate_limits` (`key` = HMAC-SHA-256 of IP per purpose,
  event count, window start); written exclusively through the
  `consume_rate_limit` RPC with the service-role client.

**Access control spine:** a `security definer` SQL function,
`public.can_access_course(course_id, …)`, is the single definition of "may this
session see this course" and is reused by table policies, storage policies, and
the app layer. Students check through the same function after their cookie
mints a temporary RLS role path.

## 7. The user experience, screen by screen

*Layout skeleton (verified by measurement at 360 / 768 / 1024 / 1280 px):*
- **< 768 px**: bottom navigation bar (`/courses`, `/search`, `/jobs`, Home…),
  no sidebar. Top bar with the course/site name.
- **≥ 768 px**: sidebar appears (at 768 it is 784 px content; 1024+ the sidebar
  is fully open and content widens).
- Everything is built mobile-first at **360 px** with plain-language labels,
  44-px touch targets, visible focus rings, and axe-core-checked markup
  (constitution rule 6).

### Shared screens

- **`/login`** — sign in. Rate-limited to 5 attempts / IP / 15 min. Generic
  failure text only (no "wrong password vs no user" hint). After sign in: if
  `must_change_password` → `/reset-password`; if first login and tour not done →
  the guided onboarding tour; otherwise Home.
- **`/reset-password`** — sets a new password when the gate is armed. Screen
  explains the rule, enforces the password policy, errors when GoTrue rejects
  (e.g. re-using the same password). Bug fix #1 lives here app-side: after a
  *real* change the server clears the flag with the service-role client.

### Leader app (`(leader)` route group — the main app for signed-in users)

- **`/`** — Home. Pinned courses, recent activity, quick actions; opens the
  onboarding tour the first time.
- **`/courses`** — course cards; click → course home.
- **`/courses/[courseId]`** — the course hub: note outline (sections and
  published notes — unpublished ones are hidden, and version-less sections are
  plain headings, never fake links — bug fix #2), tags, comments, members.
- **`/courses/[courseId]/map`** — the mind map of the course built with React
  Flow (`@xyflow/react`): a "core" centre node, the course home, 📁 section
  nodes and 📝 note nodes; pan/zoom/minimap.
- **`/courses/[courseId]/access`** — join codes, their QR code (rendered with
  `qrcode`), validity, and the member list with per-member roles.
- **`/courses/[courseId]/nodes/[nodeId]`** — read view of a published version;
  comments underneath; edit button for writers.
- **`/courses/[courseId]/nodes/[nodeId]/edit`** — **TipTap** rich text editor:
  headings, bold/italic, lists, tables (extensions included), Markdown paste;
  live editing lock so two writers can't clobber each other; save → new
  immutable `node_version`, flip `published_version_id`.
- **`/courses/[courseId]/nodes/[nodeId]/versions`** — version history with a
  **word-level diff view** (`lib/diff.ts`: same / added / removed lines), and
  "restore"/"publish" actions.
- **`/search`** — searches note bodies/titles (Postgres full-text) with tag
  filters.
- **`/tags`**, **`/tags/[tag]`** — tag directory and tag pages.
- **`/jobs`** — the jobs screen: start a job (pick type, file, languages /
  parameters), watch the queue (queued → running → done/failed), download
  results; failed jobs retry up to 3 times at 5 s / 15 s / 45 s backoff.
- **`/ai-keys`** — bring-your-own-key manager: add a Gemini key (it is
  **encrypted server-side** before storage), give it a project label you
  recognise, test it (`Test` button → `/api/ai/keys/[keyId]/test`), see
  cooldowns and usage. Rate limit: 5 adds / IP / hour.

### Student app (`/s/*` — no login, cookie only)

- **`/s/join`** — student entry: the join code (e.g. `SEED-2026`) lands here,
  checks against the hashed `join_codes` table (rate limited 5/min/IP),
  mints the signed cookie, and lands the student in their new course.
- **`/s`** — student home: cards for each joined course.
- **`/s/courses/[courseId]`** — simplified course page: only published notes
  with a published version are listed; version-less section headings render as
  plain text (never dead links).
- **`/s/notes/[nodeId]`** — the note reading view; large text, no editing.
- **`/s/map/[courseId]`** — the same mind map, read-only.
- **`/s/search`** — student-scoped search (they only ever see what they can access).
- **`/s/tags`**, **`/s/tags/[tag]`** — student tag browsing.

### Admin app (`/admin/*`)

- **`/admin`** — dashboard: counts by role, course list, recent audit lines.
- **`/admin/leaders`** — the team: invite, roles, **arm the password gate**
  (`must_change_password`), retire accounts.
- **`/admin/team`** and **`/admin/team/[courseId]`** — org + course membership
  views.
- **`/admin/courses`** — create courses, hand over owners.
- **`/admin/settings`** — the `settings` table editor (site name, max file MB,
  retention days, AI allowance, db/storage ceilings — see §13).
- **`/admin/ai`** — AI oversight: per-key usage from `ai_usage`, model-limit
  editor writing to `ai_limits` (`/api/admin/ai/usage`, `/api/admin/ai/limits`).
- **`/admin/backups`** — shows the backup token status and backup artifacts.
- **`/admin/audit`** — the audit log, filterable.
- **`/admin/health`** — the M8 health dashboard: DB/storage usage vs the
  configured limits, rate-limit health, worker heartbeats, newest audit
  activity, AI usage.

**Shared UX patterns across the app:** the AI side panel (floating panel on
note/course pages, streams events: `start` → `delta`s → `status`/`error`,
shows a chat with "share into note" → `ai_handoffs`), the PWA install prompt
(`install-prompt.tsx`, shown on a sensible delay, not page 1), toast-style
inline errors, and every destructive action wired through server actions that
re-validate on the server.

## 8. Authentication and identity

- **Team members (admin/leader)**: Supabase GoTrue email+password. The Next
  **proxy** (`src/proxy.ts`, Next 16's middleware) runs `updateSession`
  (`lib/supabase/middleware.ts`) on every request: it refreshes the session
  cookies via `supabase.auth.getUser()` — *`getUser()`, never `getSession()`*:
  the JWT is re-verified against the auth server, so a tampered cookie can't
  impersonate anyone.
- **Role resolution**: `admin-auth.ts` / `profiles.role` gives admin;
  `course-access.ts` resolves the per-course role through `course_members` +
  course ownership.
- **First-login password gate**: an admin sets
  `profiles.must_change_password = true`. The Next proxy redirects that user to
  `/reset-password` until the flag is cleared. Bug fix #1: originally a Postgres
  trigger fired on GoTrue-form `$2a$`→`$2b$` hash rewrites during sign-in and
  disarmed the gate falsely — removed by migration `00017`; the app now clears
  the flag itself, only after a genuinely new password was accepted by GoTrue.
- **Students** are authenticated by a **signed cookie** (HMAC with
  `JOIN_COOKIE_SECRET`) listing their join-code memberships; `student-cookie.ts`
  signs/verifies, `student-access.ts` derives the memberships for screens and for
  RLS-matching checks. No email, no accounts, no passwords, no student PII.
- **Worker token**: the Home Worker authenticates with a `WORKER_TOKEN`
  (`Authorization: Bearer`) checked server-side (`worker-auth.ts` hash check).
  It accesses the server through the `/api/worker/*` routes only.
- **Backup token**: `BACKUP_TOKEN` → the server stores only its SHA-256
  (`BACKUP_TOKEN_HASH`, `backup-auth.ts`); used by `/api/admin/export`.

## 9. The content lifecycle (how a note travels through the app)

1. A leader (or admin) creates a **node** inside a course — a title, an area,
   a draft body (empty version 1).
2. Writing happens in **TipTap** at `…/nodes/[nodeId]/edit` under an editing
   **lock** (`locks` table) so nobody edits simultaneously.
3. Saving writes a new **`node_versions`** row (immutable) and moves the node's
   `published_version_id` — unstated = draft (invisible to students).
4. **Tags** connect nodes across courses; **comments** attach to nodes;
   **assets** (files) attach to a node or the course.
5. Assets can be *enhanced* by jobs: OCR the photo → text is saved as the
   asset's result; converting a Word file → Markdown is proposed as note body
   material (the leader chooses what to paste in).
6. Students eventually read the **published** version at `/s/notes/[id]` — the
   student pages filter only nodes with a `published_version_id`, never raw
   draft rows.
7. Deletion is soft: `retention_deleted_note_days` (default 30 days) as a
   restore window, then permanent cleanup.

## 10. The jobs system (browser tier vs Home Worker tier)

**The queue** is the `jobs` table. A shared, secret-free module
(`src/lib/jobs.ts`) defines the types, statuses, runner derivation, retry
policy and param schemas; both server and client import it so nothing can
diverge.

| Job type | Where it runs | Tooling |
|---|---|---|
| `ocr` from an **image** | `browser` | tesseract.js (leader picks English and/or Arabic — never auto-detect) |
| `ocr` from a **scanned PDF** | `worker` | Home Worker tesseract over the rasterised pages |
| `convert.word_to_markdown` | `browser` | mammoth → turndown |
| `convert.excel_to_csv` | `browser` | xlsx (vendored) |
| `convert.pdf_merge` / `pdf_split` | `browser` | pdf-lib |
| `convert.office_to_pdf` | `worker` | LibreOffice on the leader's PC |
| `convert.video_to_audio` | `worker` | ffmpeg (MP3 extraction) |
| `convert.compress_video` | `worker` | ffmpeg (quality ladder) |
| `transcribe` (browser flag, audio ≤ 10 min) | `browser` | Whisper via `@huggingface/transformers` |
| `transcribe` (default for anything else) | `worker` | Whisper on the leader's PC |
| `ai_task` | `ai` runner | routed to the AI subsystem (§11) |

- Retry: up to **3 attempts** with **5 s → 15 s → 45 s** backoff; real failures
  record the error text on the job row.
- **Browser-finishing jobs** write their result through a server action which
  re-validates the same schema (spec section 7 rule 2).
- **Worker jobs** are *claimed* by exactly one worker (sleep/ICS-like claim row
  in `jobs`, and `worker_heartbeats` for liveness); the claim response carries a
  signed **download URL** and **upload path/URL** so the worker speaks to
  Storage directly for the big bytes, then reports through `complete`.
- A `waiting_quota` status exists for AI jobs that pause until the caller's
  allowance resets.

## 11. The AI subsystem (M7)

**Principled design (spec section 8):** every key is created **in its owner's
own Google account/project**, stored **encrypted** (`lib/ai-crypto.ts`; only
ciphertext in the DB) and used *only* by that owner. No code hides which project
a request comes from, rotates accounts, or evades quota control — those are the
constitution's red lines (rule 9).

**The flow:**
1. The leader's browser opens the **AI side panel** and posts to
   `/api/ai/task` (one-shot) or `/api/ai/chat` (conversation, SSE).
2. The server checks the leader's **daily allowance**
   (`settings.ai_daily_allowance_per_leader`; `0` turns AI off for everyone)
   and the **per-IP chat burst** rate limit (20/min).
3. `lib/ai/router.ts` builds candidates — *the caller's own active keys × the
   models listed in `ai_limits`, preference order
   `gemini-2.5-flash-lite` → `gemini-2.5-flash` (cheapest first)* — and for each
   candidate **projects** this call against the minute and day usage buckets,
   picking the candidate whose **worst projected ratio is lowest**.
4. The call goes to Gemini with the assembled context (chosen by the leader:
   the note and/or `ai_allowed` assets; assets the leader explicitly flipped).
   A **real 429** from Google cools that key down (`cooldown_until`) and the
   router retries on the next candidate.
5. Every request records usage in `ai_usage` at two granularities — a rolling
   **minute bucket** and a calendar-**day bucket that rolls over at Pacific
   midnight** — so reporting aligns with Google's own quota windows.
6. Streaming chat: server-sent events (`start` with a `conversation_id`, then
   `delta`s, `status` notes, `error`). The conversation is persisted in
   `ai_conversations`/`ai_messages` (auto-deleted after
   `retention_ai_days`, default 90).
7. **Handoffs**: a chat can be attached into a node as a comment/draft block
   (`ai_handoffs`) so AI output is never silently lost.

**Admin controls:** `/admin/ai` shows per-key usage; `/api/admin/ai/limits`
edits the `ai_limits` rows (rpm/tpm/rpd plus the soft %, at which the router
stops preferring that key); `/api/admin/ai/usage` provides reporting data.
Key testing lives at `/api/ai/keys/[keyId]/test`, add/list at `/api/ai/keys[...]`.

## 12. Rate limits and abuse controls

All rate limiting uses **one Postgres table (`private.rate_limits`) + one
function (`consume_rate_limit`)** executed by the service-role client — no
extra service, and the function's `EXECUTE` is revoked from client roles
(migration `00014`). Keys are **HMAC-SHA-256 hashes of the caller's IP +
purpose prefix** — the app never stores a raw IP (privacy rule).

| Purpose | Limit | Window |
|---|---|---|
| `join` (join-code check) | 5 | per minute |
| `suggest` (student suggestions) | 3 | per hour |
| `login` | 5 | per 15 minutes |
| `ai_key` (adding keys) | 5 | per hour |
| `ai_chat` | 20 | per minute (the *daily allowance* in `settings` is the real control) |

A broken limiter **fails closed** (`checkRateLimit` returns false on error) —
an outage can't become an open door. Join codes themselves are stored
hashed (never plaintext) with per-code validity owned by leaders.

## 13. Settings (limits live in the database, not in code)

`lib/settings.ts` defines every setting with its plain-language label,
default, min and max; `/admin/settings` edits them; all readers go through
`readSettings()` which back-fills defaults for missing rows.

| Key | Default | Meaning |
|---|---|---|
| `site_name` | "Study Hub" | Shown on sign-in and in leader messages |
| `max_file_mb` | 10 | Upload ceiling shown in UI; storage bucket hard-caps at 10 MB too |
| `retention_ai_days` | 90 | AI conversation lifetime |
| `retention_audit_days` | 365 | Audit log lifetime |
| `retention_deleted_note_days` | 30 | Restore window for deleted notes |
| `ai_daily_allowance_per_leader` | 0 (AI off) | Daily AI messages per leader |
| `db_limit_mb` | 500 | Free-tier DB ceiling the health screen measures against |
| `storage_limit_mb` | 1024 | Free-tier storage ceiling ditto |

## 14. Server-side surface: server actions and API routes

**Server actions** (in page/route colocation `actions.ts` files) perform every
mutating flow — auth (sign in, password change), courses CRUD, nodes + versions,
tags, comments, uploads (post-upload row insert), student join, suggestions,
admin operations (invite, role change, gate arming, settings writes). Each one:
zod-validate → DAL **with the admin client for privileged ops and the user's own
client for self-scope ops** → audit-log the admin-level actions
(`lib/audit.ts`, guarded by `admin-actions-guard.ts`).

**API routes** (the `app/api/**/route.ts` set, 12 routes):

| Route | Purpose |
|---|---|
| `GET /api/health` | Health check + keep-alive ping (one trivial DB query) |
| `POST /api/worker/claim` | Home Worker: authenticate (worker token), heartbeat, atomically claim one queued job → job + signed download/upload URLs |
| `POST /api/worker/complete` | Home Worker: report job result (`ok`, `error`, product fields); validates against the same schema as browser jobs |
| `POST /api/ai/task` | one-shot AI generation (router + Gemini) |
| `POST /api/ai/chat` | streaming AI conversation (SSE) |
| `GET/POST /api/ai/keys` + `[keyId]` + `[keyId]/test` | BYO-key list/add/remove/test (encrypted at rest) |
| `GET /api/admin/export` | full content-table export ZIP (backup token; no key material, no join-code hashes) |
| `GET/POST /api/admin/settings` | settings read/write for admins |
| `GET /api/admin/ai/usage` | AI usage reporting |
| `GET/POST /api/admin/ai/limits` | edit `ai_limits` |

## 15. The Home Worker (Python)

`worker/worker.py` is a ~280-line, dependency-light Python service a leader
runs on their own Windows PC (`install.ps1` sets up Python deps, ffmpeg and
tesseract, writes `worker/.env` with `WORKER_URL`, `WORKER_TOKEN`,
`WORKER_NAME`).

Its loop: `POST /api/worker/claim` → sleep on a heartbeat if the queue is empty
→ on a job, `run_job(job, download_url, upload_path, upload_url)` performs the
type-specific pipeline:

| Capability | Command chain |
|---|---|
| `ocr_pdf_scan` | rasterise pages → tesseract CLI with the leader-chosen `languages` (eng/ara) |
| `office_to_pdf` | LibreOffice headless conversion |
| `video_to_audio` | ffmpeg → MP3 |
| `compress_video` | ffmpeg ladder (resolution/CRF) |
| `transcribe` | Whisper transcription → timestamped text (`fmt_ts`) |

Results upload straight to Storage at the given path, then
`POST /api/worker/complete` reports success or typed error. The loop itself
**never dies** (catch-all + sleep), reports a 401 token problem loudly, and
shuts down cleanly on Ctrl-C.

## 16. Backups, keep-alive, restore, and CI/CD

- **`backup.yml`** — every **Saturday 04:00 UTC** (+ manual dispatch):
  `curl --fail` on `GET $APP_URL/api/admin/export` with the backup token → ZIP
  workflow **artifact kept 90 days**. Export excludes AI key material and
  join-code hashes. Fails loudly rather than saving an error page.
- **`keepalive.yml`** — daily 05:00 UTC ping of `GET /api/health` so the
  Supabase Free project never pauses after its 7 idle-day limit; a dead app or
  database emails via a failing (red) run.
- **Restore** — `scripts/restore.mjs` + `docs/restore.md` walk through
  rebuilding from a backup ZIP; `db:reset` + Supabase CLI revives a local
  environment.
- **`ci.yml`** — on every push to `main` and every PR:
  1. **quality**: `npm ci` (with `ONNXRUNTIME_NODE_INSTALL=skip` — drops a
     200 MB dead GPU download), copy `.env.example → .env.local`, then
     `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`.
  2. **rls**: local Supabase up (CLI 2.122.0) → `npm run test:rls`
     (`scripts/test-rls.mjs`, driven by `pg`).
  3. **e2e**: local Supabase up + `db reset` + real local keys written into
     `.env.local`, `E2E_PROD=1` forces a **production build** (`next start`)
     because the service worker only registers in production →
     `npm run test:e2e` (Playwright with axe-core).
- Secrets used: `APP_URL`, `BACKUP_TOKEN` (Actions); every Supabase/Google
  value lives in `.env.local` / `.env.example` — never in code, tests, logs or
  commits (constitution rule 4).

## 17. Testing and quality gates

- **Unit (Vitest)**: pure modules (`diff`, `jobs` derivation, rate limit maths,
  router projections with injected deps, student cookie sign/verify, mind-map
  tree builder, file allowlist…). `npm test`.
- **RLS test suite**: literally every table-policy from migrations is exercised
  by `scripts/test-rls.mjs` against local Supabase — the constitution forbids
  disabling RLS or a test to make something work.
- **Playwright e2e**: 31-page walkthrough coverage, mobile 360 px viewports,
  keyboard and axe accessibility checks, offline PWA test (against a
  production build), join-code and password-gate journeys.
- **Pre-deploy scripts**: `scripts/load-test.mjs` (traffic soak),
  `scripts/check-lighthouse.mjs` (performance), `scripts/generate-icons.mjs`
  (PWA icons), `scripts/copy-pdf-worker.mjs` (ensures pdf.js worker asset
  ships in `next dev`/`build`), `scripts/test-rls.mjs`, `scripts/restore.mjs`.
- **Local element of trust**: commits go through
  `npm run lint && npm run typecheck && npm test` before every commit
  (constitution rule 10) — CI repeats it on green machines.

## 18. Seed data and the hosted project's current state

**Hosted Supabase project**: `mgabdxvrlnctbgvipvvf` (eu-north-1), URL
`https://mgabdxvrlnctbgvipvvf.supabase.co` — all **17 migrations applied**.

**Seed users** (UUID prefixes in the seed files):
- `aaaaaaaa-…` — primary admin ("Study Hub admin").
- `bbbbbbbb-…` — admin2, "Backup admin" (`admin2@studyhub.local`): in the hosted
  copy the password was changed to `Blue-Otter-42x` (the seed default
  `ChangeMe-Admin-02` no longer works), `tour_done = true`,
  `must_change_password = false`.
  ⚠️ The seed passwords `ChangeMe-Admin-01/02` are **no longer valid** on the
  hosted project after the walkthrough changed admin2's password. There are no
  other seeded auth users — leader accounts used in tests were created live.

**Seed content**: two courses (`cccccccc-…01/02`, codes `COURSE-A` and
`COURSE-B`), three nodes (`eeeeeeee-…01/02/03`) — the first is a published
"Week 1" node with an intentional seed quirk: it has **no**
`published_version_id` — the app already filters it out (bug fix #2) — tags
(`f0f0f0f0-…01/02`), and the join code **`SEED-2026`** (stored as an HMAC-SHA256
hash), which works live on the hosted project.

**Known hosted-state notes**:
- the `private.rate_limits` row may exist for this machine's IP (`login:`
  purpose) from testing, clearable by SQL if a login round should be retried;
- GoTrue won't accept re-setting the same password (shows the generic error
  "Could not set your new password") — documented in `docs/QUESTIONS.md` #29;
- `pgcrypto` cannot verify `$2b$` bcrypt on this host, so SQL-side password
  equality with `crypt()` is never used.

**CI status**: green as of commit `f5ad6a2` (runs #54–#56).

## 19. Repository map

```
study-hub/
├── src/
│   ├── app/                    # 31 pages + 12 API routes, route groups:
│   │   ├── (leader)/           #   the main signed-in app (/, courses, search, jobs, ai-keys…)
│   │   ├── s/                  #   the student app (/s/join, /s, /s/courses, /s/notes, /s/map…)
│   │   ├── admin/              #   the admin console (dashboard, leaders, team, courses,
│   │   │                       #     settings, ai, backups, audit, health)
│   │   ├── login/ · reset-password/
│   │   └── api/                #   health, worker/{claim,complete}, ai/{task,chat,keys…},
│   │                           #     admin/{export,settings,ai/{usage,limits}}
│   ├── components/             # TipTap editor, AI side panel, test-key button,
│   │                           #   install prompt, nav/layout, forms
│   ├── lib/                    # 47 shared modules; server-only ones marked `server-only`:
│   │   ├── dal.ts              #   the data-access layer (single choke point for reads/writes)
│   │   ├── schemas.ts          #   every zod schema
│   │   ├── rate-limit.ts       #   the 5 purposes + hashed-key limiter
│   │   ├── jobs.ts             #   job types/statuses/runner derivation/retry (pure, shared)
│   │   ├── student-cookie.ts / student-access.ts
│   │   ├── admin-auth.ts / admin-actions-guard.ts / audit.ts
│   │   ├── ai/{router,gemini,chat,usage,admin,handoff}.ts + ai-crypto.ts + ai-keys.ts
│   │   ├── browser-jobs/{dictation,…}.ts (tesseract, pdf-lib, mammoth, whisper-worker)
│   │   ├── export.ts / backup-auth.ts / worker-auth.ts / health.ts
│   │   ├── settings.ts / file-allowlist.ts / storage.ts / slug.ts / diff.ts
│   │   ├── mind-map.ts / templates.ts / join-code.ts / temp-password.ts
│   │   └── supabase/{server,client,browser,admin,middleware}.ts
│   ├── proxy.ts                # Next-16 middleware entry: session refresh via getUser()
│   └── messages/en.json        # student-facing strings (next-intl)
├── supabase/
│   ├── migrations/00001…00017  # full schema/RLS history
│   └── (seed + config)
├── worker/                     # Python Home Worker: worker.py, install.ps1, requirements.txt
├── scripts/                    # test-rls, restore, load-test, check-lighthouse,
│                               #   generate-icons, copy-pdf-worker
├── .github/workflows/          # ci.yml, backup.yml, keepalive.yml
├── public/                     # PWA manifest, sw.js service worker, icons
├── docs/                       # THIS FILE + the guides in §20
└── package.json / AGENTS.md / .env.example
```

## 20. The documentation set

| Document | What it covers |
|---|---|
| `docs/PROJECT-GUIDE.md` | *this document* — the whole system in one place |
| `docs/QUESTIONS.md` | the decision log; #29–30 are the bug-fix decisions |
| `docs/WORKER.md` | installing and running the Home Worker, plain language |
| `docs/JOBS.md` | what each job does, size limits, what runs where |
| `docs/STUDENTS-AND-JOIN-CODES.md` | the student flow explained for leaders |
| `docs/leader-guide.md` | day-to-day leader manual |
| `docs/key-guide.md` | creating the leader's own Gemini key, correctly |
| `docs/FREE_TIER.md` | every service with the date + source proving it's free for this use |
| `docs/restore.md` | recovering from a backup ZIP |

---

### One paragraph to remember it all

Study Hub is a **Next.js 16 + React 19 + Tailwind 4 app on Vercel** whose brain
is a **hosted Supabase Postgres** with forced RLS on all 22 public tables,
whose files live in one private Storage bucket, whose team authenticates
through GoTrue behind a Next proxy that always re-verifies the JWT, whose
students are cookie-only joiners on `/s/*`, whose content is **immutable
versions** published through servers actions from **TipTap** notes navigated
by a **React-Flow mind map** and cross-linked by tags, whose **jobs queue**
picks per-job between the **leader's browser** (tesseract.js, pdf-lib,
mammoth+turndown, vendored xlsx, Whisper-in-browser) and a **Python Home
Worker** on the leader's own PC (ffmpeg, tesseract CLI, LibreOffice),
whose **AI panel** streams Gemini answers through a per-leader-key router
that projects quota maths every call and records usage per minute/day,
whose limits all live in the **settings** and **ai_limits** tables,
whose abuses are throttled by a **hashed-IP Postgres rate limiter**, whose data
is guarded by **weekly GitHub-Actions exports** and a **daily keep-alive ping**,
and whose every change is tested by **Vitest + RLS tests + Playwright e2e with
axe-core in CI**.
