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

### Seeded ai_limits rows are placeholders — admin must verify (M7)

Checked: 29 October 2026 — Source:
https://ai.google.dev/gemini-api/docs/rate-limits (the page publishes the
current per-model free-tier caps; numbers change often and are tier- and
region-dependent).

Migration `00011_m7_ai_limits_defaults.sql` seeds `ai_limits` with
**conservative placeholder numbers** so the router has something to project
against:

| Model                 | rpm | tpm    | rpd | soft_pct |
| --------------------- | --- | ------ | --- | -------- |
| gemini-2.5-flash-lite | 10  | 200000 | 200 | 80       |
| gemini-2.5-flash      | 10  | 200000 | 200 | 80       |

These are deliberately lower than the published free-tier caps, so the app
can only under-use a key, never over-use it. **Before real use the admin
must open the rate-limits page, compare the current published numbers, and
update `ai_limits` in the admin portal** — the router treats a real 429 as
the final truth either way (the key cools down and the next candidate is
tried), so a stale row costs availability, not compliance.

## What this file is for

When a new milestone wants to add a service or a dependency, add a row here
with the date and the official source before the code that uses it is merged.

## Dependencies added so far

| Date       | Dependency                                                                                                                      | License      | Why it is free for this use                                                                                                                | Source                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| 2026-10-28 | @tiptap/react, @tiptap/pm, @tiptap/starter-kit, @tiptap/extension-table (+ table-row/cell/header), @tiptap/markdown (M2 editor) | MIT          | Open-source editor libraries that run inside the app; no hosted service, no paid plan, no account needed                                   | https://github.com/ueberdosis/tiptap       |
| 2026-10-28 | react-markdown (M2 note rendering)                                                                                              | MIT          | Open-source Markdown renderer; escapes raw HTML by default, so stored notes cannot inject scripts                                          | https://github.com/remarkjs/react-markdown |
| 2026-10-28 | @xyflow/react (M3 mind-map)                                                                                                     | MIT          | Open-source React Flow library, runs entirely in the browser; no hosted service                                                            | https://github.com/xyflow/xyflow           |
| 2026-10-28 | pdfjs-dist (M3 PDF preview)                                                                                                     | Apache-2.0   | Open-source Mozilla PDF.js viewer, runs in the browser; no hosted service                                                                  | https://github.com/mozilla/pdf.js          |
| 2026-10-28 | pg (dev-only: RLS test runner talks to the local test database)                                                                 | MIT          | Open-source PostgreSQL client for Node; used only by the test runner against the local database, never shipped to the browser              | https://github.com/brianc/node-postgres    |
| 2026-10-28 | lighthouse (CI-only, run with npx; M4 performance check)                                                                        | Apache-2.0   | Open-source Google auditing tool run inside the CI job against the local build; not a project dependency, nothing hosted                   | https://github.com/GoogleChrome/lighthouse |
| 2026-10-28 | tesseract.js (M5 image OCR in the browser, English + Arabic)                                                                    | Apache-2.0   | Open-source Tesseract port that runs entirely in the leader's browser; the language data downloads from its CDN on first use, no paid plan | https://github.com/naptha/tesseract.js     |
| 2026-10-28 | mammoth (M5 Word to HTML in the browser)                                                                                        | BSD-2-Clause | Open-source .docx reader that runs in the browser; no hosted service                                                                       | https://github.com/mwilliamson/mammoth.js  |
| 2026-10-28 | turndown (+ @types/turndown) (M5 HTML to Markdown for the note body)                                                            | MIT          | Open-source HTML-to-Markdown converter; no hosted service                                                                                  | https://github.com/domchristie/turndown    |
| 2026-10-28 | pdf-lib (M5 merge and split of PDFs in the browser)                                                                             | MIT          | Open-source PDF toolkit that runs in the browser; no hosted service                                                                        | https://github.com/Hopding/pdf-lib         |
| 2026-10-29 | qrcode (+ @types/qrcode, dev) (M8 join-code QR on the access screen)                                                            | MIT          | Open-source QR generator that runs on the server; the join link never leaves the app, unlike hosted QR image services                      | https://github.com/soldair/node-qrcode     |
| 2026-10-29 | jszip (M8 content export ZIP)                                                                                                   | MIT          | Open-source ZIP builder that runs on the server; no hosted service. Already present as a transitive dependency of mammoth                  | https://github.com/Stuk/jszip              |
| 2026-10-29 | @axe-core/playwright (dev-only: M8 accessibility audit in the e2e suite)                                                        | MPL-2.0      | Open-source axe-core rules engine run inside the existing Playwright suite against the local build; nothing hosted, never shipped to users | https://github.com/dequelabs/axe-core-npm  |

## Home Worker (M6) — Python packages and desktop tools

The worker runs on a leader's own Windows PC, not on any hosted service, so
nothing here adds hosting cost. Its Python packages are installed into a
private environment by `worker/install.ps1`; the desktop tools come from
winget.

| Date       | Dependency                                                    | License                         | Why it is free for this use                                                                                                                                                                                          | Source                                                    |
| ---------- | ------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 2026-10-28 | requests (worker HTTP calls)                                  | Apache-2.0                      | Open-source Python HTTP library; no hosted service                                                                                                                                                                   | https://github.com/psf/requests                           |
| 2026-10-28 | faster-whisper (worker audio-to-text)                         | MIT                             | Open-source Whisper implementation that runs locally on the worker PC using CTranslate2; no cloud service, no paid plan                                                                                              | https://github.com/SYSTRAN/faster-whisper                 |
| 2026-10-28 | ocrmypdf (worker scanned-PDF OCR)                             | MPL-2.0                         | Open-source tool that runs locally with Tesseract; no hosted service                                                                                                                                                 | https://github.com/ocrmypdf/OCRmyPDF                      |
| 2026-10-28 | FFmpeg (desktop tool: video to audio, compress, audio chunks) | LGPL-2.1+ (Gyan builds are GPL) | Free open-source media toolkit, installed on the leader's own PC via winget; nothing hosted                                                                                                                          | https://ffmpeg.org / https://github.com/GyanD/codexffmpeg |
| 2026-10-28 | Tesseract OCR + Arabic traineddata (desktop tool)             | Apache-2.0                      | Free open-source OCR engine; the Arabic data file is from the free tessdata_fast repository                                                                                                                          | https://github.com/tesseract-ocr/tesseract                |
| 2026-10-28 | Ghostscript (desktop tool, needed by ocrmypdf)                | AGPL-3.0                        | Free for this use: it runs locally inside the school's own worker PC and is not distributed with a commercial product                                                                                                | https://ghostscript.com                                   |
| 2026-10-28 | LibreOffice (desktop tool: Word/PowerPoint to PDF)            | MPL-2.0                         | Free open-source office suite, installed on the leader's own PC via winget; headless conversion only                                                                                                                 | https://www.libreoffice.org                               |
| 2026-10-29 | next-intl 4.14.9 (UI translations)                            | MIT                             | Open-source internationalization library for Next.js; no hosted service                                                                                                                                              | https://github.com/amannn/next-intl                       |
| 2026-10-29 | SheetJS CE 0.20.3 (Excel to CSV, spec section 7)              | Apache-2.0                      | Open-source spreadsheet reader; runs in the leader's browser, no hosted service. Vendored tarball from the official SheetJS CDN because the npm-registry copy is frozen at 0.18.5 with unpatched security advisories | https://docs.sheetjs.com / https://cdn.sheetjs.com        |
| 2026-10-29 | @huggingface/transformers 4.3.2 (browser Whisper fallback)    | Apache-2.0                      | Open-source transformers runtime; the Whisper model (onnx-community/whisper-tiny, MIT) downloads from the free Hugging Face Hub on first use and runs locally in the leader's browser — no cloud API                 | https://github.com/huggingface/transformers.js            |
