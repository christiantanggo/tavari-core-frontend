# Full Smartwaiver PDF archive -> Tavari legacy_waivers + Storage
# Requires SUPABASE_SERVICE_ROLE_KEY in .env (loaded below).
#
# Usage (PowerShell, from repo root):
#   .\scripts\smartwaiver\runFullImport.ps1
#   .\scripts\smartwaiver\runFullImport.ps1 -Limit 25
#   .\scripts\smartwaiver\runFullImport.ps1 -DryRun
#   .\scripts\smartwaiver\runFullImport.ps1 -StartIndex 5000 -SkipExisting

param(
  [string]$PdfDir = "C:\Users\chris\OneDrive\Desktop\One Drive\OneDrive\! OTWK\A11 - Legal\Smart Waiver File Download",
  [string]$BusinessId = "cb982fca-cf7a-4f59-b9c7-55ca0364eddc",
  [int]$Limit = 0,
  [int]$StartIndex = 0,
  [switch]$DryRun,
  [switch]$SkipExisting
)

# Per-PDF failures log to stderr; do not abort the whole 18k run.
$ErrorActionPreference = "Continue"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $Root

foreach ($name in @(".env", ".env.local")) {
  $envFile = Join-Path $Root $name
  if (-not (Test-Path $envFile)) { continue }
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '^([^#=]+)=(.*)$') { return }
    $k = $matches[1].Trim()
    $v = $matches[2].Trim().Trim('"').Trim("'")
    [Environment]::SetEnvironmentVariable($k, $v, "Process")
  }
}

$env:SMARTWAIVER_PDF_DIR = $PdfDir
$env:SMARTWAIVER_BUSINESS_ID = $BusinessId
if ($Limit -gt 0) { $env:LIMIT = "$Limit" } else { Remove-Item Env:\LIMIT -ErrorAction SilentlyContinue }
if ($StartIndex -gt 0) { $env:SMARTWAIVER_START_INDEX = "$StartIndex" }
if ($DryRun) { $env:DRY_RUN = "1" } else { Remove-Item Env:\DRY_RUN -ErrorAction SilentlyContinue }
if ($SkipExisting) { $env:SMARTWAIVER_SKIP_EXISTING = "1" }

$log = Join-Path $Root "smartwaiver-import.log"
Write-Host "PDF dir: $PdfDir"
Write-Host "Business: $BusinessId"
Write-Host "Log: $log"
Write-Host "Starting import... (18k PDFs may take many hours)"

# Call node directly — npm stderr warnings must not stop the script (ErrorActionPreference = Stop).
node (Join-Path $Root "scripts\smartwaiver\importSmartwaiverPdfs.mjs") 2>&1 | Tee-Object -FilePath $log -Append
