# M9 reconnaissance (canvas foundation)

Spec rule 2 and the M9 kickoff prompt: before writing any SQL, verify each
assumption from the spec sketch against the actual code, and record where the
spec sketch must be adapted. Each row below was read directly from the
repository; the file paths and line numbers are the evidence.

## Recon table

| #   | Question                                                                                                    | Answer found                                                                                                                                                                                                                                                                                                          | Evidence                                                                |
| --- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| R1  | What is the global role column on `profiles` (the spec sketch said `role`)?                                  | The column is **`global_role`**, values `admin` \| `leader`. There is no `role` column.                                                                                                                                                                                                                               | `supabase/migrations/00001_foundation_schema.sql` lines 12–13            |
| R2  | Which helper functions already exist for access checks?                                                      | `is_admin()`, `can_access_course(course uuid)`, `is_course_owner(course uuid)`, `course_role(course uuid)` — all `security definer`, `search_path = ''`. **No `is_course_staff()` exists**; M9 creates it.                                                                                                            | `supabase/migrations/00002_foundation_policies.sql` lines 7–37           |
| R3  | What is the exact shape of `course_members` (the edit-policy driver)?                                        | `(course_id, user_id, role ∈ {owner, editor, contributor, reviewer}, areas text[], valid_from, valid_until)`. Validity window is honoured in app code (`getMembership`) — the SQL helper must do the same.                                                                                                           | `supabase/migrations/00005_m2_content.sql` (course_members table)        |
| R4  | Do the `nodes` and `assets` tables match the spec sketch (canvas cards will link to them)?                   | `nodes(id, course_id, parent_id, area, kind ∈ {core,course_home,section,note}, title, slug, status, published_version_id, draft_body_md, deleted_at, created_by)` and `assets(id, course_id, node_id, kind, storage, path_or_url, title, mime, size_bytes, ai_allowed, student_visible, student_downloadable, created_by)`. | `supabase/migrations/00005_m2_content.sql`, `00006_m3_assets.sql`       |
| R5  | Is the `updated_at` trigger named `set_updated_at()` (spec sketch naming)?                                   | No — it is **`touch_updated_at()`**, and migration 00016 pins its `search_path = ''`. New canvas tables must use this exact name.                                                                                                                                                                                      | `supabase/migrations/00005_m2_content.sql` lines 178–190; `00016_touch_updated_at_search_path.sql` |
| R6  | Is there a database-side settings reader the canvas can call?                                               | No. Settings are read app-side with the service-role client (`readSettings()`); the table is `key text primary key, value jsonb` and seeded values are JSON strings (`'10'`, `'"Study Hub"'`). So `canvas_apply_ops` must tolerate a missing row and a JSON-string value — same guard pattern as existing readers.       | `src/lib/settings.ts`, `supabase/migrations/00004`->settings table      |
| R7  | How do students see published content (canvases with student_visible cards copy the same rule)?              | Students have no accounts: the app uses the **service-role client with the scope from the signed cookie applied explicitly** (`student-access.ts`, `requireStudentScope`, cookie `scope.all | scope.courseIds`). Anon reads nothing (RLS test 02). Student canvas reads must filter to published canvases in scoped courses. | `src/lib/student-access.ts` lines 12–17                                 |
| R8  | How are private asset links served?                                                                         | `createSignedAssetUrl(storagePath, fileName)` in `src/lib/storage.ts` creates a signed URL that expires after 10 minutes and forces download. Canvas image cards must use the same pipeline, not public URLs.                                                                                                         | `src/lib/storage.ts` lines 10–23                                        |
| R9  | How are uploads validated (image cards reuse it)?                                                           | Browser and server share the pure `file-allowlist.ts` (`validateUpload`, `sniffMime`, `randomStoragePath`); the assets row is inserted server-side. SVG/HTML never allowed.                                                                                                                                           | `src/lib/file-allowlist.ts`                                             |
| R10 | Is there existing canvas-like layout code to follow?                                                        | `src/lib/mind-map.ts` is a pure layout module (`buildLayout`, `buildEdges`, `layoutBounds`, `layoutToSvg`) with unit tests, rendered by React Flow on the course map page. The canvas follows the same "pure module + tested" pattern.                                                                                | `src/lib/mind-map.ts`, `src/app/(leader)/courses/[courseId]/map/`       |
| R11 | What do the RLS tests rely on (helpers, users, memberships)?                                                 | Test files are numbered SQL files in `supabase/tests/rls/` (00–15) run by `scripts/test-rls.mjs` after a db reset. Helpers: `tests.assert_true`, `tests.acting_as`. Seed users: `aaaa…` admin (owner of both seeded courses), `bbbb…`; memberships for test leaders come from `bbbb…`-visible via plain SQL inserted as admin. New file: `16_canvas.sql`. | `supabase/tests/rls/00_helpers.sql`, `07_nodes_isolation.sql`, `scripts/test-rls.mjs` |
| R12 | How do e2e suites sign in (canvas editor tests need a leader session)?                                       | Only a **student** setup project exists (joins with `SEED-2026`, saves `playwright/.auth/student.json`). There is no leader sign-in helper. M9 adds `leader-setup.spec.ts` which must handle the first-sign-in password gate (`must_change_password=true` for the seeded admin — a new password, since GoTrue rejects re-setting the same one, e.g. fall back to cycled passwords), then the onboarding tour (`tour_done`). | `tests/e2e/student-setup.spec.ts`, `supabase/seed.sql`, `00003_must_change_password.sql` |
| R13 | How is text-size handled app-wide (canvas editor UI must respect it)?                                       | The root layout inline script reads `localStorage("sh_text_size")` and sets it before paint. The `<html>` element has **no `data-theme`** attribute yet — themes arrive in M11.                                                                                                                                       | `src/app/layout.tsx` lines 55–64                                        |
| R14 | How are server actions rate limited and audited?                                                            | `consume_rate_limit(purpose, max_events, window_seconds)` for purposes `join | suggest | login | ai_key | ai_chat` (EXECUTE revoked from client roles, service-role only). Audits via `writeAudit({actorId, action, entity, entityId?, meta?})`. Canvas publish/unpublish gets an audit entry; apply-ops intentionally skip rate limiting (protected by RLS + membership). | `src/lib/rate-limit.ts`, `src/lib/audit.ts`, `00007_m4_student.sql`     |

## Deviations from the CANVAS-SPEC sketch

Each of these changes a line of the spec sketch; none changes the spec's
intent. Questions are logged in `docs/QUESTIONS.md`.

| #  | Sketch said                                            | Reality / adaptation                                                                                                       |
| -- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| V1 | `profiles.role`                                        | `profiles.global_role` (R1). All new SQL uses `global_role`.                                                                 |
| V2 | helper `is_course_staff()`                             | Does not exist — created in migration 00018 with the same definer pattern.                                                  |
| V3 | `set_updated_at()`                                     | `touch_updated_at()` (R5); new trigger functions call the existing one, not a new one.                                       |
| V4 | settings reader RPC                                    | None exists (R6). `canvas_setting_int` tolerates missing rows and JSON-string values (`(data->># 'value')::text::int`).      |
| V5 | students view via RLS                                  | Students are account-less (R7): the app reads with service-role + explicit scope, so the student *viewer* is app-side, while RLS still hides everything from `anon` and limits members to their courses. |
| V6 | `canvas_edit_can → owner + editor` (RLS test 7 draft)  | **Confirmed decision (QUESTIONS #31): edits = every team level** — `admin OR any valid course_members row`; students and strangers read published only. |
| V7 | strict zod uuid                                        | Seed ids (`cccccccc-…`, `eeee…`, and the canvas test ids) are not RFC 4122; the schemas use the relaxed hex pattern (`uuidLike`, QUESTIONS #19/#42). |
| V8 | new dependency `@dagrejs/dagre`                        | Not present today — added in M9 (MIT, recorded in docs/FREE_TIER.md) because spec §5.1 uses dagre for auto-layout.           |

## Lighthouse baseline (before any canvas code)

Spec §12.1 rule: record the performance baseline before the canvas work so
M9 can prove the new pages did not make anything slower. This machine has no
Docker, so the baseline could not use the local Supabase stack (the capsule
CI job does); it was measured against a production build
(`npm run build` + `npm run start`) pointed at the hosted project, with the
student join cookie minted exactly the way the CI job does it. Two runs each
on `/s` and `/s/notes/…003` at the default (mobile) Lighthouse profile.

| Page        | Run 1 (cold server + remote DB) | Run 2 (warm) | CI bar |
| ----------- | ------------------------------- | ------------ | ------ |
| `/s`        | 92/100                          | —            | ≥ 90   |
| `/s/notes/eeeeeeee-0000-eeee-0000-000000000003` | 73/100      | 94/100       | ≥ 90   |

Notes: the cold `/s/notes` run is dominated by first-byte streaming against
the remote database (LCP 3.3 s) — the warm rerun is 2.7 s with
160 ms total blocking time and meets the bar with margin, matching the green
CI check, which runs against the local database with three attempts.
M9's acceptance for this baseline: every new student page (only the canvas
viewer, which loads its bundle with `next/dynamic`) must not degrade these
scores; the same script and bar run in CI after the work.
