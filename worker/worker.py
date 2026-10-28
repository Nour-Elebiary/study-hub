"""Study Hub Home Worker (spec section 7 rule 5).

A small Python program that runs on a leader's own Windows PC. Every ten
seconds it asks the Study Hub server for work. The server hands it one job
at a time, plus signed URLs to download the input file and upload the
result — the worker never holds a Supabase key and never talks to the
database directly.

Heavy jobs live here:
  - OCR of a scanned PDF  (ocrmypdf + Tesseract -> searchable PDF)
  - Word/PowerPoint to PDF (LibreOffice headless)
  - Video to audio, compress video (FFmpeg)
  - Audio to text (FFmpeg + faster-whisper, in 10-minute chunks with
    [hh:mm:ss] timestamps, merged in order; a failed chunk is retried alone)

Configure with a worker/.env file (created by install.ps1):
  WORKER_URL=https://your-app.example.com   (no trailing slash)
  WORKER_TOKEN=<the raw token; the server only stores its SHA-256 hash>
  WORKER_NAME=home-pc                       (optional, defaults to hostname)
  WORKER_WHISPER_MODEL=small                (optional)
"""

from __future__ import annotations

import logging
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import requests

POLL_SECONDS = 10
CHUNK_SECONDS = 600  # spec rule 3: split long audio into 10-minute chunks
CHUNK_RETRIES = 3

log = logging.getLogger("worker")

# ---------------------------------------------------------------- config ----


def load_env() -> dict[str, str]:
    """Read worker/.env (KEY=VALUE lines) without extra dependencies."""
    values: dict[str, str] = {}
    path = Path(__file__).resolve().parent / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                values[key.strip()] = value.strip()
    return values


ENV = load_env()
WORKER_URL = (ENV.get("WORKER_URL") or "").rstrip("/")
WORKER_TOKEN = ENV.get("WORKER_TOKEN") or ""
WORKER_NAME = ENV.get("WORKER_NAME") or socket.gethostname()
WHISPER_MODEL = ENV.get("WORKER_WHISPER_MODEL") or "small"

# ------------------------------------------------------------------ api -----


def api(path: str, payload: dict) -> requests.Response:
    return requests.post(
        f"{WORKER_URL}/api/worker/{path}",
        json=payload,
        headers={"Authorization": f"Bearer {WORKER_TOKEN}"},
        timeout=120,
    )


# --------------------------------------------------------------- tools ------


def run_cmd(cmd: list[str]) -> None:
    log.info("run: %s", " ".join(cmd[:6]) + (" ..." if len(cmd) > 6 else ""))
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        tail = (result.stderr or result.stdout or "")[-500:]
        raise RuntimeError(f"{cmd[0]} failed: {tail}")


def ocr_pdf_scan(src: Path, languages: list[str], out: Path) -> tuple[Path, str]:
    """A searchable PDF: the original pages plus an invisible text layer."""
    run_cmd(["ocrmypdf", "-l", "+".join(languages or ["eng"]), str(src), str(out)])
    return out, "application/pdf"


def office_to_pdf(src: Path, out_dir: Path) -> tuple[Path, str]:
    run_cmd(
        ["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(out_dir), str(src)]
    )
    out = out_dir / (src.stem + ".pdf")
    if not out.exists():
        raise RuntimeError("LibreOffice did not produce a PDF.")
    return out, "application/pdf"


def video_to_audio(src: Path, out: Path) -> tuple[Path, str]:
    run_cmd(
        ["ffmpeg", "-y", "-i", str(src), "-vn", "-acodec", "libmp3lame", "-q:a", "4", str(out)]
    )
    return out, "audio/mpeg"


def compress_video(src: Path, out: Path) -> tuple[Path, str]:
    run_cmd(
        [
            "ffmpeg", "-y", "-i", str(src),
            "-c:v", "libx264", "-crf", "28", "-preset", "medium",
            "-c:a", "aac", "-b:a", "128k",
            str(out),
        ]
    )
    return out, "video/mp4"


def fmt_ts(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"


# Whisper uses "en"/"ar"; the app stores Tesseract codes "eng"/"ara".
WHISPER_LANG = {"eng": "en", "ara": "ar"}


def transcribe(src: Path, languages: list[str], out: Path) -> tuple[Path, str]:
    """Audio to text in 10-minute chunks (spec section 7 rule 3).

    One language forces it; both languages lets Whisper decide per chunk.
    Chunks are merged in order; a chunk that keeps failing is retried alone
    and, if it never succeeds, marked in the text instead of losing the rest.
    """
    from faster_whisper import WhisperModel  # heavy import: only when needed

    chunk_dir = out.parent / "chunks"
    chunk_dir.mkdir(exist_ok=True)
    run_cmd(
        [
            "ffmpeg", "-y", "-i", str(src),
            "-f", "segment", "-segment_time", str(CHUNK_SECONDS),
            "-ac", "1", "-ar", "16000",
            str(chunk_dir / "chunk_%04d.wav"),
        ]
    )
    chunks = sorted(chunk_dir.glob("chunk_*.wav"))
    if not chunks:
        raise RuntimeError("FFmpeg produced no audio chunks.")

    model = WhisperModel(WHISPER_MODEL)
    language = WHISPER_LANG.get(languages[0]) if len(languages) == 1 else None

    parts: list[str] = []
    for index, chunk in enumerate(chunks):
        offset = index * CHUNK_SECONDS
        text: str | None = None
        last_error: Exception | None = None
        for _ in range(CHUNK_RETRIES):
            try:
                lines = []
                segments, _info = model.transcribe(str(chunk), language=language)
                for seg in segments:
                    body = seg.text.strip()
                    if body:
                        lines.append(f"[{fmt_ts(offset + seg.start)}] {body}")
                text = "\n".join(lines)
                break
            except Exception as exc:  # noqa: BLE001 — retry the chunk alone
                last_error = exc
                log.warning("chunk %d failed (%s), retrying", index, exc)
                time.sleep(2)
        if text is None:
            log.error("chunk %d failed after %d tries", index, CHUNK_RETRIES)
            parts.append(f"[{fmt_ts(offset)}] (this part could not be transcribed: {last_error})")
        else:
            parts.append(text)

    for stale in chunk_dir.glob("chunk_*.wav"):
        stale.unlink()
    out.write_text("\n\n".join(parts) + "\n", encoding="utf-8")
    return out, "text/markdown"


# ------------------------------------------------------------ job runner ----


def run_job(job: dict, download_url: str, upload_url: str, upload_path: str) -> None:
    job_id = job["id"]
    job_type = job["type"]
    params = job.get("params") or {}
    languages = params.get("languages") or []

    with tempfile.TemporaryDirectory(prefix="studyhub-") as tmp:
        tmp_dir = Path(tmp)
        src = tmp_dir / f"input{Path(download_url.split('?')[0]).suffix or '.bin'}"
        log.info("job %s (%s): downloading input", job_id, job_type)
        with requests.get(download_url, stream=True, timeout=600) as resp:
            resp.raise_for_status()
            with src.open("wb") as fh:
                for block in resp.iter_content(1 << 20):
                    fh.write(block)

        if job_type == "ocr" and params.get("source") == "pdf_scan":
            result, mime = ocr_pdf_scan(src, languages, tmp_dir / "result.pdf")
        elif job_type == "convert" and params.get("tool") == "office_to_pdf":
            result, mime = office_to_pdf(src, tmp_dir)
        elif job_type == "convert" and params.get("tool") == "video_to_audio":
            result, mime = video_to_audio(src, tmp_dir / "result.mp3")
        elif job_type == "convert" and params.get("tool") == "compress_video":
            result, mime = compress_video(src, tmp_dir / "result.mp4")
        elif job_type == "transcribe":
            result, mime = transcribe(src, languages, tmp_dir / "result.md")
        else:
            complete(job_id, ok=False, error="This job type is not for the worker.")
            return

        data = result.read_bytes()
        log.info("job %s: uploading result (%d bytes)", job_id, len(data))
        upload = requests.put(upload_url, data=data, timeout=1800)
        upload.raise_for_status()

        complete(
            job_id,
            ok=True,
            result_path=upload_path,
            mime=mime,
            size_bytes=len(data),
            text=data.decode("utf-8", errors="replace") if mime == "text/markdown" else None,
        )


def complete(job_id: str, *, ok: bool, error: str | None = None, **rest) -> None:
    payload = {"job_id": job_id, "ok": ok, **({"error": error} if error else {}), **rest}
    resp = api("complete", payload)
    if resp.status_code != 200:
        log.error("complete for %s failed: %s %s", job_id, resp.status_code, resp.text[:200])


# ------------------------------------------------------------------ main ----


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stdout,
    )
    if not WORKER_URL or not WORKER_TOKEN:
        log.error("worker/.env is missing WORKER_URL or WORKER_TOKEN. Run install.ps1 first.")
        return 1
    log.info("Home Worker '%s' starting; server %s", WORKER_NAME, WORKER_URL)

    while True:
        try:
            resp = api("claim", {"worker_name": WORKER_NAME})
            if resp.status_code == 401:
                log.error("The server rejected this worker's token. Fix WORKER_TOKEN.")
                time.sleep(60)
                continue
            resp.raise_for_status()
            data = resp.json()
            job = data.get("job")
            if not job:
                time.sleep(POLL_SECONDS)  # heartbeat only; queue is empty
                continue
            log.info("claimed job %s (%s)", job["id"], job["type"])
            run_job(job, data["download_url"], data["upload_url"], data["upload_path"])
        except KeyboardInterrupt:
            log.info("stopped by the user")
            return 0
        except Exception as exc:  # noqa: BLE001 — the loop must never die
            log.error("loop error: %s", exc)
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    sys.exit(main())
