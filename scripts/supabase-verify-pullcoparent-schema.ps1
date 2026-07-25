# Verify pullcoparent schema objects exist on linked remote.
# Run after migrations if you see "relation/column does not exist" errors.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$checks = @(
  "SELECT to_regclass('public.pullcoparent_settlements') AS ok",
  "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pullcoparent_child_wants' AND column_name='event_time') AS ok",
  "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pullcoparent_profiles' AND column_name='phone') AS ok",
  "SELECT to_regclass('public.pullcoparent_child_wants') AS ok",
  "SELECT to_regclass('public.pullcoparent_push_tokens') AS ok"
)

Write-Host "Verifying pullcoparent schema on linked remote..."
$failed = $false
foreach ($q in $checks) {
  Write-Host "  $q"
  $result = npx supabase db query --linked $q 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  FAILED (query error)" -ForegroundColor Red
    $failed = $true
    continue
  }
  if ($result -match 'false|null' -and $result -notmatch 'true') {
    Write-Host "  FAILED (missing object)" -ForegroundColor Red
    $failed = $true
  } else {
    Write-Host "  OK" -ForegroundColor Green
  }
}

if ($failed) {
  Write-Host "`nSchema incomplete. Run:" -ForegroundColor Yellow
  Write-Host "  .\scripts\supabase-apply-migration-linked.ps1 supabase/migrations/20260701173000_pullcoparent_schema_repair.sql"
  exit 1
}

Write-Host "`nAll checks passed."
npx supabase db query --linked "NOTIFY pgrst, 'reload schema';" | Out-Null
