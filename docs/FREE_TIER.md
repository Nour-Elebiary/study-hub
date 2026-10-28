# Free-tier verification log

Spec rule (section 12, rule 7): before we rely on any free service, we record
what it gives us, where the limit is, and the date we checked. Leaders can
read this file to see exactly what the platform is allowed to do for free.

Every entry below was checked on the official page listed. If a plan changes,
update the row and the date before you depend on it.

## Hosting — Vercel Hobby plan

Checked: 28 October 2026 · Source: https://vercel.com/docs/plans/hobby

| What we get                     | Limit                                             |
| ------------------------------- | ------------------------------------------------- |
| Free hosting for the web app    | 1 deployment concurrency, non-commercial use only |
| Serverless function invocations | 1 million per month                               |
| Function duration               | up to 300 seconds per invocation                  |
| Bandwidth (site transfer)       | 100 GB per month                                  |
| Image optimization              | 5,000 source images per month                     |
| Build minutes                   | 6,000 minutes per month                           |

Why it fits: the Study Hub is a small private platform for one school's
leaders and students — well inside these limits. The Hobby plan forbids
commercial use, which matches the platform's purpose (a free study tool, not
a product for sale).

## Database, auth, storage — Supabase Free plan

Checked: 28 October 2026 · Source: https://supabase.com/pricing

| What we get                 | Limit                                                                           |
| --------------------------- | ------------------------------------------------------------------------------- |
| Database size               | 500 MB                                                                          |
| File storage                | 1 GB                                                                            |
| Maximum single file upload  | 50 MB                                                                           |
| Monthly active users (auth) | 50,000                                                                          |
| Bandwidth                   | 5 GB per month                                                                  |
| Edge function invocations   | 500,000 per month                                                               |
| Projects                    | 2 active projects per organization                                              |
| Inactivity                  | projects are paused after 1 week of inactivity (keep-alive pings planned in M8) |

Why it fits: hundreds of notes, PDFs and quizzes for a handful of courses fit
easily inside 500 MB / 1 GB. The app sets its own smaller limits in the
`settings` table (for example `max_file_mb = 10`) so we never approach the
platform ceiling.

## AI — Gemini API (each leader's own key)

Checked: 28 October 2026 · Source: https://ai.google.dev/gemini-api/terms
(effective 23 March 2026, page updated 28 April 2026) and
https://ai.google.dev/gemini-api/docs/rate-limits

### How the Study Hub uses Gemini (agreed feature decision)

Each leader who wants AI help adds **their own API key**, created in **their
own Google account and their own project**, through the app's AI tab. The key
is encrypted at rest and used **only for that leader's own jobs**. The
platform never shares keys between leaders, never rotates accounts to dodge
quota limits, and never hides which project a request comes from — those
things are forbidden by the spec (sections 8 and 14) and by Google's terms.

### What the terms require us to respect

| Requirement                                                                                                                                                                                                                   | What it means for the Study Hub                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unpaid (free-tier) quota: Google may use submitted content and responses to improve its products, and human reviewers may read them. "Do not submit sensitive, confidential, or personal information to the Unpaid Services." | On the free tier, leaders must not send student personal data (names, grades, private notes about a person) through AI jobs. The AI tab will show this warning. See the open question in `QUESTIONS.md`. |
| The services are for people 18+, and API clients must not be directed at under-18s.                                                                                                                                           | Only leaders call the AI — never students. Students see AI-produced study material only, and the student site never sends anything to Gemini.                                                            |
| EEA, Switzerland and UK: only Paid Services may be used when making the API available to users there.                                                                                                                         | If the school operates from those regions, AI features need a paid (billed) Gemini project. Recorded as an open question.                                                                                |
| Prohibited Use Policy and safety settings apply.                                                                                                                                                                              | AI-generated study material is reviewed by the leader before it is published to students (spec section 8).                                                                                               |
| Rate limits per project (free tier: modest requests-per-minute caps).                                                                                                                                                         | The per-leader daily allowance in `ai_limits`/`settings` keeps each leader far under Google's per-project caps, because every leader uses their own project.                                             |

### Free-tier numbers (indicative, re-check before M7)

The exact free-tier request caps change often; the authoritative page is
https://ai.google.dev/gemini-api/docs/rate-limits. The design does not depend
on any specific number: each leader is limited by their own project's quota,
and the app's `ai_daily_allowance_per_leader` setting (default 0 = AI off)
is the real control.

## What this file is for

When a new milestone wants to add a service or a dependency, add a row here
with the date and the official source before the code that uses it is merged.

## Dependencies added so far

| Date       | Dependency                                                                                                                      | License | Why it is free for this use                                                                              | Source                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 2026-10-28 | @tiptap/react, @tiptap/pm, @tiptap/starter-kit, @tiptap/extension-table (+ table-row/cell/header), @tiptap/markdown (M2 editor) | MIT     | Open-source editor libraries that run inside the app; no hosted service, no paid plan, no account needed | https://github.com/ueberdosis/tiptap       |
| 2026-10-28 | react-markdown (M2 note rendering)                                                                                              | MIT     | Open-source Markdown renderer; escapes raw HTML by default, so stored notes cannot inject scripts        | https://github.com/remarkjs/react-markdown |
