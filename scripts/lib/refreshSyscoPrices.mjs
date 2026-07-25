/**
 * Shared Sysco price refresh runner (used by CLI + local bridge).
 */
import { createClient } from '@supabase/supabase-js';
import {
  isSyscoShopUrl,
  loginToSysco,
  normalizeUnit,
  scrapeSyscoProduct,
  withSyscoBrowser,
} from './syscoBrowser.mjs';
import { syncIngredientCostsFromSupplierPrices } from './recipeCostSync.mjs';

function resolveSyscoCredentials(suppliers) {
  const email = process.env.SYSCO_EMAIL || process.env.RECIPE_SYSCO_EMAIL || '';
  const password = process.env.SYSCO_PASSWORD || process.env.RECIPE_SYSCO_PASSWORD || '';

  if (email && password) return { email, password };

  for (const supplier of suppliers || []) {
    const cfg = supplier.scraping_config || {};
    if (cfg.browserType === 'sysco' || /sysco/i.test(supplier.name || '')) {
      const cfgEmail = cfg.loginEmail || cfg.email || '';
      const cfgPassword = cfg.loginPassword || cfg.password || '';
      if (cfgEmail && cfgPassword) return { email: cfgEmail, password: cfgPassword };
      if (cfgEmail && password) return { email: cfgEmail, password };
    }
  }

  if (email && password) return { email, password };
  throw new Error(
    'Sysco credentials missing. Set SYSCO_EMAIL and SYSCO_PASSWORD in .env, or save them on the Sysco supplier in Settings.',
  );
}

export async function refreshSyscoSupplierPrices({
  supabase,
  businessId,
  supplierPriceIds = null,
  dryRun = false,
  headless = true,
}) {
  const { data: suppliers, error: suppliersError } = await supabase
    .from('rb_suppliers')
    .select('id, name, scraping_config')
    .eq('business_id', businessId)
    .eq('is_active', true);

  if (suppliersError) throw new Error(suppliersError.message);

  const supplierIds = (suppliers || []).map((s) => s.id);
  if (supplierIds.length === 0) {
    return { refreshed: 0, failed: 0, total: 0, results: [], costs_synced: { ingredientsUpdated: 0, inventoryUpdated: 0 } };
  }

  let priceQuery = supabase
    .from('rb_supplier_prices')
    .select('id, supplier_id, ingredient_id, product_url, unit_of_measure')
    .in('supplier_id', supplierIds)
    .eq('is_current', true)
    .not('product_url', 'is', null);

  if (Array.isArray(supplierPriceIds) && supplierPriceIds.length > 0) {
    priceQuery = priceQuery.in('id', supplierPriceIds);
  }

  const { data: priceRows, error: priceError } = await priceQuery;
  if (priceError) throw new Error(priceError.message);

  const rows = (priceRows || []).filter((row) => isSyscoShopUrl(row.product_url));
  const results = [];

  if (rows.length === 0) {
    return {
      refreshed: 0,
      failed: 0,
      total: 0,
      results: [],
      costs_synced: { ingredientsUpdated: 0, inventoryUpdated: 0 },
      message: 'No Sysco product URLs to refresh',
    };
  }

  const credentials = resolveSyscoCredentials(suppliers);

  if (dryRun) {
    return {
      refreshed: 0,
      failed: 0,
      total: rows.length,
      dry_run: true,
      results: rows.map((row) => ({ id: row.id, ok: true, url: row.product_url })),
      costs_synced: { ingredientsUpdated: 0, inventoryUpdated: 0 },
    };
  }

  await withSyscoBrowser(async ({ page }) => {
    await loginToSysco(page, credentials);

    for (const row of rows) {
      const url = String(row.product_url || '').trim();
      try {
        const parsed = await scrapeSyscoProduct(page, url);
        const inventoryUnit = normalizeUnit(row.unit_of_measure || 'each');
        const packSize = parsed.packSize || 1;
        const packUnit = normalizeUnit(parsed.packSizeUnit || inventoryUnit || row.unit_of_measure);

        const updatePayload = {
          price_per_unit: parsed.shelfPrice,
          pack_size: packSize,
          pack_size_unit: packUnit || row.unit_of_measure,
          unit_of_measure: inventoryUnit || row.unit_of_measure,
          scraped_product_name: parsed.productName,
          scraped_at: new Date().toISOString(),
          scrape_error: null,
          last_updated: new Date().toISOString(),
          promo_price: null,
        };

        const { error: updateError } = await supabase
          .from('rb_supplier_prices')
          .update(updatePayload)
          .eq('id', row.id);

        if (updateError) throw new Error(updateError.message);

        results.push({
          id: row.id,
          ok: true,
          shelfPrice: parsed.shelfPrice,
          productName: parsed.productName,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown Sysco refresh error';
        await supabase
          .from('rb_supplier_prices')
          .update({
            scrape_error: message,
            scraped_at: new Date().toISOString(),
            last_updated: new Date().toISOString(),
          })
          .eq('id', row.id);

        results.push({ id: row.id, ok: false, error: message });
      }
    }
  }, { headless });

  const refreshed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  let costsSynced = { ingredientsUpdated: 0, inventoryUpdated: 0 };
  if (refreshed > 0) {
    costsSynced = await syncIngredientCostsFromSupplierPrices(supabase, businessId);
  }

  return {
    refreshed,
    failed,
    total: results.length,
    results,
    costs_synced: costsSynced,
  };
}

export function createSupabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
