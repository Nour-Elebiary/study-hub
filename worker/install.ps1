# Study Hub Home Worker installer (Windows).
# Run in PowerShell:  powershell -ExecutionPolicy Bypass -File install.ps1
# Installs the free tools the worker needs, sets up Python, creates the
# worker's token, and registers it to start when you log in.
# The worker opens NO inbound ports: it only calls the Study Hub server.

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $here

function Install-IfNeeded($id, $name, $check) {
  if (Get-Command $check -ErrorAction SilentlyContinue) {
    Write-Host "[ok] $name is already installed."
  } else {
    Write-Host "Installing $name (this can take a while)..."
    winget install --id $id -e --accept-source-agreements --accept-package-agreements
  }
}

# --- 1. The free tools the worker uses --------------------------------------
Install-IfNeeded "Gyan.FFmpeg" "FFmpeg" "ffmpeg"
Install-IfNeeded "UB-Mannheim.TesseractOCR" "Tesseract OCR" "tesseract"
Install-IfNeeded "ArtifexSoftware.GhostScript" "Ghostscript (needed by ocrmypdf)" "gswin64c"
Install-IfNeeded "TheDocumentFoundation.LibreOffice" "LibreOffice" "soffice"

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
  Write-Host "Installing Python 3.11..."
  winget install --id Python.Python.3.11 -e --accept-source-agreements --accept-package-agreements
}

# --- 2. Arabic OCR data for Tesseract ----------------------------------------
$tessdata = Join-Path $env:ProgramFiles "Tesseract-OCR\tessdata"
if (-not (Test-Path (Join-Path $tessdata "ara.traineddata"))) {
  Write-Host "Downloading the Arabic OCR data file..."
  New-Item -ItemType Directory -Force -Path $tessdata | Out-Null
  Invoke-WebRequest `
    -Uri "https://github.com/tesseract-ocr/tessdata_fast/raw/main/ara.traineddata" `
    -OutFile (Join-Path $tessdata "ara.traineddata")
}

# --- 3. Python environment ----------------------------------------------------
if (-not (Test-Path ".venv")) { py -3.11 -m venv .venv }
& ".venv\Scripts\python.exe" -m pip install --upgrade pip | Out-Null
& ".venv\Scripts\pip.exe" install -r requirements.txt

# --- 4. The worker's token ----------------------------------------------------
# The worker keeps the raw token; the Study Hub server stores only its
# SHA-256 hash (WORKER_TOKEN_HASH in the server's environment variables).
$envPath = Join-Path $here ".env"
if (Test-Path $envPath) {
  Write-Host "[ok] worker\.env already exists — keeping the existing token."
  $token = (Get-Content $envPath | Select-String "^WORKER_TOKEN=").Line -replace "^WORKER_TOKEN=", ""
} else {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""

  $url = Read-Host "Study Hub address (for example https://your-app.vercel.app)"
  $name = Read-Host "A name for this worker PC (Enter = computer name)"
  if (-not $name) { $name = $env:COMPUTERNAME }

  @"
WORKER_URL=$url
WORKER_TOKEN=$token
WORKER_NAME=$name
WORKER_WHISPER_MODEL=small
"@ | Set-Content -Encoding utf8 $envPath

  $hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash(
    [System.Text.Encoding]::UTF8.GetBytes($token))
  $hashHex = ($hash | ForEach-Object { $_.ToString("x2") }) -join ""

  Write-Host ""
  Write-Host "============================================================="
  Write-Host "NEXT STEP (one time): open your Study Hub hosting settings"
  Write-Host "(Vercel > Settings > Environment Variables) and add:"
  Write-Host ""
  Write-Host "  Name:  WORKER_TOKEN_HASH"
  Write-Host "  Value: $hashHex"
  Write-Host ""
  Write-Host "Then redeploy the app. Never paste the raw token anywhere"
  Write-Host "except this PC's worker\.env file."
  Write-Host "============================================================="
}

# --- 5. Start automatically at login ------------------------------------------
$runner = Join-Path $here "run-worker.cmd"
@"
@echo off
cd /d "$here"
"$here\.venv\Scripts\python.exe" "$here\worker.py" >> "$here\worker.log" 2>&1
"@ | Set-Content -Encoding ascii $runner

schtasks /Create /F /SC ONLOGON /TN "StudyHubWorker" `
  /TR "`"$runner`"" | Out-Null
Write-Host "[ok] The worker will start automatically when you log in."
Write-Host "     (To remove it later: schtasks /Delete /TN StudyHubWorker /F)"
Write-Host ""
Write-Host "Start it now with:  $runner"
