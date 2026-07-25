# Deploy Pull Together: Co-Parent premium edge functions
#
# Run from tavari-core-frontend repo root after setting Supabase secrets (see below).
#
#   .\scripts\pullcoparent-deploy-premium.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$projectRef = "iagcamwcfuiopmwefohz"

Write-Host "Deploying pullcoparent-revenuecat-webhook..."
npx supabase functions deploy pullcoparent-revenuecat-webhook --project-ref $projectRef
if ($LASTEXITCODE -ne 0) { throw "Webhook deploy failed" }

Write-Host "Deploying pullcoparent-sync-subscription..."
npx supabase functions deploy pullcoparent-sync-subscription --project-ref $projectRef
if ($LASTEXITCODE -ne 0) { throw "Sync deploy failed" }

Write-Host ""
Write-Host "Done. Webhook URL:"
Write-Host "  https://${projectRef}.supabase.co/functions/v1/pullcoparent-revenuecat-webhook"
Write-Host ""
Write-Host "Required Supabase secrets (set once if not already):"
Write-Host "  npx supabase secrets set REVENUECAT_SECRET_API_KEY=sk_... --project-ref $projectRef"
Write-Host "  npx supabase secrets set REVENUECAT_WEBHOOK_AUTH=your-random-token --project-ref $projectRef"
Write-Host ""
Write-Host "RevenueCat dashboard:"
Write-Host "  1. Create entitlement: premium"
Write-Host "  2. Products: pullcoparent_premium_monthly, pullcoparent_premium_annual"
Write-Host "  3. Webhook → URL above, Authorization: Bearer <REVENUECAT_WEBHOOK_AUTH>"
Write-Host "  4. App User ID = household UUID (configured in app)"
Write-Host ""
Write-Host "pullcoparent/.env:"
Write-Host "  VITE_REVENUECAT_IOS_API_KEY=<RevenueCat public iOS SDK key>"
