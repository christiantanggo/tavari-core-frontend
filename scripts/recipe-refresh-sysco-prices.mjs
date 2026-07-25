/**
 * Refresh Sysco supplier prices via Playwright (logged-in browser scrape).
 *
 * Usage:
 *   npm run recipe:sysco-prices
 *   node scripts/recipe-refresh-sysco-prices.mjs --business-id=<uuid>
 *   node scripts/recipe-refresh-sysco-prices.mjs --dry-run
 *
 * Env (.env.local):
 *   SUPABASE_URL / VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SYSCO_EMAIL
 *   SYSCO_PASSWORD
 *
 * Or save login on the Sysco supplier (Settings → Suppliers → scraping config).
 */
import 'dotenv/config';
import {
  createSupabaseAdmin,
  refreshSyscoSupplierPrices,
} from './lib/refreshSyscoPrices.mjs';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const businessId = process.argv.find((a) => a.startsWith('--business-id='))?.split('=')[1]
  || process.env.OTWK_BUSINESS_ID
  || process.env.RECIPE_BUSINESS_ID
  || 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

const supabase = createSupabaseAdmin();

console.log(`Refreshing Sysco prices for business ${businessId}${dryRun ? ' (dry run)' : ''}...`);

const result = await refreshSyscoSupplierPrices({
  supabase,
  businessId,
  dryRun,
  headless: true,
});

console.log(JSON.stringify(result, null, 2));

if (result.failed > 0) process.exitCode = 1;
