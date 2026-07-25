# Applies migrations missing from supabase_migrations.schema_migrations, including files whose
# timestamps sort *before* the newest remote entry (requires --include-all).
# Run from repo root: .\scripts\supabase-push-pending-including-out-of-order.ps1
# If you hit ECIRCUITBREAKER on the pooler, wait and retry; set SUPABASE_DB_PASSWORD if the CLI asks.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

npx supabase db push --include-all --yes
