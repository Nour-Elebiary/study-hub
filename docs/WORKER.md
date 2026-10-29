# Setting up the Home Worker

The Home Worker is a small program that runs on one Windows computer and
does the heavy jobs — scanned-PDF OCR, Word/PowerPoint to PDF, video work,
and turning recordings into text. Everything runs on that computer; nothing
is sent to outside services.

**One worker serves the whole school.** You do not need one on every
leader's computer — the job queue is built so several workers could share
it, but in practice one machine that is usually switched on is enough.

The full step-by-step install guide lives in
[`worker/README.md`](../worker/README.md) — read that first. This page is
the short version and the safety notes.

## The short version

1. On the chosen PC, open PowerShell in the project's `worker` folder and
   run:
   ```
   powershell -ExecutionPolicy Bypass -File install.ps1
   ```
2. The installer installs the free tools (FFmpeg, Tesseract with the
   Arabic data, Ghostscript, LibreOffice, Python), creates the worker's
   secret token, and registers the worker to start at login.
3. The installer prints a **hash**. Paste it into the hosting settings
   (Vercel → Settings → Environment Variables) as `WORKER_TOKEN_HASH` and
   redeploy. This is done once for the whole platform.
4. Run `run-worker.cmd` (or log off and on). The Jobs screen shows
   **Home Worker: online** for admins.

## Which computer?

- **Any ordinary Windows PC from the last few years is enough:** four
  processing cores, 8 GB of memory, and about 5 GB of free disk space.
  No graphics card is needed — the transcription model is deliberately
  the small one, tuned to run on the ordinary processor.
- **The important part is not power — it is being on.** A worker only
  helps while its computer is running. A modest machine left plugged in
  (a small used mini-PC is ideal) beats a powerful laptop that is usually
  shut. The Jobs screen shows **offline** whenever the worker's computer
  is off, so you can always tell.
- **A weak computer is not a problem for everyday work.** The light jobs —
  reading text from a photo, converting a document, transcribing a
  recording up to 10 minutes — run in your browser when you ask for them,
  and they finish on a modest laptop or phone; they just take a little
  longer.
- **When the shared worker is offline or busy**, a leader can use the AI
  assistant as a fallback for heavy work. That uses the leader's own free
  Google AI key and counts against its quotas, so it is a pressure valve,
  not the default.

## How the secrets work

- The worker keeps the **raw token** only in `worker\.env` on its own PC.
  It is never typed into the app, never committed to git, and never sent
  anywhere except to your own Study Hub server.
- The server stores only the token's **SHA-256 hash**. Seeing the hash
  does not reveal the token.
- The worker holds **no Supabase keys** and never talks to the database.
  For every job the server hands it two short-lived signed links: one to
  download the input, one to upload the result. Links expire after an hour.
- The worker opens **no incoming ports** — it only makes outgoing requests
  to your server, like a web browser does.

## What admins can see

- The **online/offline badge** on the Jobs screen (admins only).
- Which worker claimed each job, recorded in the audit log alongside the
  job's completion.
