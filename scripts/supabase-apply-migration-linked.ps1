# Apply a single migration file to the linked remote Supabase project.
# Use when `db push --include-all` fails on unrelated backlog migrations.
#
# From tavari-core-frontend repo root:
#   .\scripts\supabase-apply-migration-linked.ps1 supabase/migrations/20260701120000_pullcoparent_initial.sql
#
# After apply, registers the migration version in schema_migrations (from filename timestamp).

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$MigrationFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not (Test-Path $MigrationFile)) {
  throw "Migration file not found: $MigrationFile"
}

$fileName = Split-Path -Leaf $MigrationFile
if ($fileName -notmatch '^(\d{14})_(.+)\.sql$') {
  throw "Migration filename must match YYYYMMDDHHMMSS_name.sql"
}

$version = $Matches[1]
$name = $Matches[2]

Write-Host "Applying $MigrationFile to linked remote..."
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
npx supabase db query --linked -f $MigrationFile 2>&1 | Out-Null
$applyExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
if ($applyExit -ne 0) {
  throw "Migration SQL failed for $MigrationFile. Version was NOT registered - fix the error and re-run."
}

Write-Host "Reloading PostgREST schema cache..."
$ErrorActionPreference = "Continue"
npx supabase db query --linked "NOTIFY pgrst, 'reload schema';" 2>&1 | Out-Null
$ErrorActionPreference = $prevEap
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Could not NOTIFY pgrst - you may need to reload the API schema in the Supabase dashboard."
}

Write-Host "Registering schema_migrations version $version..."
$ErrorActionPreference = "Continue"
$registerResult = npx supabase db query --linked "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('$version', '$name') ON CONFLICT (version) DO NOTHING RETURNING version;" 2>&1 | Out-String
$registerExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
if ($registerExit -ne 0) {
  throw "Failed to register migration version $version in schema_migrations."
}

Write-Host $registerResult
Write-Host "Done."
