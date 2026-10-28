# The Home Worker

The Home Worker is a small program that runs on a leader's own computer and
does the heavy processing jobs that a phone browser should not do:

| Job                                            | Tool used on your PC    |
| ---------------------------------------------- | ----------------------- |
| Read text from a scanned PDF (searchable copy) | OCRmyPDF + Tesseract    |
| Word or PowerPoint to PDF                      | LibreOffice             |
| Video to audio (MP3), compress a video         | FFmpeg                  |
| Audio to text                                  | FFmpeg + faster-whisper |

Everything runs on your own PC. Files are downloaded, processed, and the
result uploaded — nothing is sent to any other service, and the worker opens
no incoming ports.

## What the worker knows

The worker holds **no Supabase keys**. It talks only to your Study Hub
server with one secret token (`WORKER_TOKEN`), and the server hands it
short-lived signed links for each file. The server stores only a hash of
the token, so even a leaked server backup does not expose it.

## One-time setup

1. Install [Python 3.11](https://www.python.org/) if you do not have it.
2. Open PowerShell in this `worker` folder and run:
   ```
   powershell -ExecutionPolicy Bypass -File install.ps1
   ```
   This installs FFmpeg, Tesseract (plus the Arabic data file), Ghostscript,
   and LibreOffice, creates a private Python environment, generates the
   token, and registers the worker to start when you log in.
3. The installer prints a **hash** — paste it into your hosting settings
   (Vercel → Settings → Environment Variables) as `WORKER_TOKEN_HASH`, then
   redeploy. This is done once per server, not per worker.
4. Start the worker now by running `run-worker.cmd`, or just log off and on.

## How it works

- Every 10 seconds the worker asks the server "any work for me?" — that
  question doubles as the heartbeat the app uses to show
  **Home Worker: online/offline** on the Jobs screen (admins only).
- The server hands out one job at a time. Two workers can never take the
  same job.
- Long recordings are split into 10-minute chunks, transcribed with time
  stamps like `[00:10:23]`, and merged in order. A chunk that fails is
  retried by itself; if it never succeeds it is marked in the text instead
  of losing the whole transcription.
- If the app shows "Home Worker: offline", check that `run-worker.cmd` is
  running and that `worker.log` in this folder has no errors.

## If a tool is "not found"

After the first install, Windows sometimes needs a restart before FFmpeg or
LibreOffice appear on the PATH. Restart the PC and start the worker again.

## Settings

`worker\.env` (created by the installer):

| Setting                | Meaning                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `WORKER_URL`           | Your Study Hub address, no trailing slash                                                                                          |
| `WORKER_TOKEN`         | This worker's secret token — never share it                                                                                        |
| `WORKER_NAME`          | Shown in the app's records of who took a job                                                                                       |
| `WORKER_WHISPER_MODEL` | Speech model size: `tiny`, `base`, `small` (default), `medium`. Bigger is more accurate but slower and downloads more on first use |
