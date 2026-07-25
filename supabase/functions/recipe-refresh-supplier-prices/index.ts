// Refresh Recipe Manager supplier prices from stored product URLs.
// POST body: { business_id: string, supplier_price_ids?: string[] }
// Deploy: npx supabase functions deploy recipe-refresh-supplier-prices

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { syncIngredientCostsFromSupplierPrices } from '../_shared/recipeSupplierCostSync.ts';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-CA,en;q=0.9',
};

type ParsedProduct = {
  productName: string | null;
  shelfPrice: number | null;
  packSize: number | null;
  packSizeUnit: string | null;
};

type RefreshResult = {
  id: string;
  ok: boolean;
  shelfPrice?: number | null;
  productName?: string | null;
  error?: string;
  browserRequired?: boolean;
};

type BrowserRequiredRow = {
  id: string;
  product_url: string;
  reason: string;
};

function requiresBrowserScrape(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'shop.sysco.ca' || host === 'shop.sysco.com';
  } catch {
    return /shop\.sysco\.(ca|com)/i.test(url);
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function parseMoney(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function normalizeUnit(unit: string | null | undefined): string {
  if (!unit) return '';
  const key = unit.trim().toLowerCase();
  const aliases: Record<string, string> = {
    ea: 'each',
    each: 'each',
    pc: 'each',
    pcs: 'each',
    ct: 'each',
    count: 'each',
    kg: 'kg',
    g: 'g',
    l: 'l',
    ml: 'ml',
    lb: 'lb',
    oz: 'oz',
  };
  return aliases[key] || key;
}

function parsePackSize(text: string | null | undefined): { packSize: number | null; packSizeUnit: string | null } {
  if (!text) return { packSize: null, packSizeUnit: null };
  const match = text.match(/([\d,.]+)\s*(kg|g|l|ml|ea|each|pack|count|ct|lb|oz)\b/i);
  if (!match) return { packSize: null, packSizeUnit: null };
  const packSize = parseMoney(match[1].replace(/,/g, ''));
  return {
    packSize,
    packSizeUnit: normalizeUnit(match[2]),
  };
}

function extractJsonLdProducts(html: string): ParsedProduct[] {
  const results: ParsedProduct[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        collectProductNodes(node, results);
      }
    } catch {
      // ignore invalid JSON-LD blocks
    }
  }
  return results;
}

function collectProductNodes(node: unknown, results: ParsedProduct[]) {
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const typeValue = obj['@type'];
  const types = Array.isArray(typeValue) ? typeValue : [typeValue];
  const isProduct = types.some((t) => String(t).toLowerCase().includes('product'));

  if (isProduct) {
    const offers = obj.offers;
    const offer = Array.isArray(offers) ? offers[0] : offers;
    const offerObj = (offer || {}) as Record<string, unknown>;
    const shelfPrice = parseMoney(offerObj.price ?? offerObj.lowPrice ?? offerObj.highPrice);
    const productName = typeof obj.name === 'string' ? obj.name : null;
    const pack = parsePackSize(productName);
    if (shelfPrice != null) {
      results.push({
        productName,
        shelfPrice,
        packSize: pack.packSize,
        packSizeUnit: pack.packSizeUnit,
      });
    }
  }

  if (Array.isArray(obj['@graph'])) {
    for (const child of obj['@graph']) collectProductNodes(child, results);
  }
}

function parseProductPage(html: string, url: string): ParsedProduct {
  const jsonLdMatches = extractJsonLdProducts(html);
  if (jsonLdMatches.length > 0) {
    return jsonLdMatches[0];
  }

  const titleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<title>([^<]+)<\/title>/i);
  const productName = titleMatch?.[1]?.trim() || null;

  const pricePatterns = [
    /"regularPrice"\s*:\s*([\d.]+)/i,
    /"salePrice"\s*:\s*([\d.]+)/i,
    /"price"\s*:\s*([\d.]+)/i,
    /itemprop=["']price["'][^>]*content=["']([\d.]+)["']/i,
    /\$\s*([\d,.]+)/,
  ];

  let shelfPrice: number | null = null;
  for (const pattern of pricePatterns) {
    const match = html.match(pattern);
    if (match) {
      shelfPrice = parseMoney(match[1]);
      if (shelfPrice != null) break;
    }
  }

  const pack = parsePackSize(productName);
  return {
    productName,
    shelfPrice,
    packSize: pack.packSize,
    packSizeUnit: pack.packSizeUnit,
  };
}

async function fetchProduct(url: string): Promise<ParsedProduct> {
  const response = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow' });
  const html = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching product page`);
  }

  if (/verify yourself|not robots|captcha|access denied/i.test(html)) {
    throw new Error('Supplier site blocked automated access (CAPTCHA/bot protection)');
  }

  const parsed = parseProductPage(html, url);
  if (parsed.shelfPrice == null) {
    throw new Error('Could not parse price from product page');
  }

  return parsed;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const body = (await req.json().catch(() => ({}))) as {
      business_id?: string;
      supplier_price_ids?: string[];
    };

    const businessId = body.business_id;
    if (!businessId) return json({ error: 'Missing business_id' }, 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const isServiceRoleCall = authHeader === `Bearer ${serviceRoleKey}`;

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (!isServiceRoleCall) {
      const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await supabaseUser.auth.getUser();
      const { data: membership } = await supabaseUser
        .from('business_users')
        .select('user_id')
        .eq('business_id', businessId)
        .eq('user_id', user?.id)
        .in('role', ['owner', 'manager', 'admin'])
        .maybeSingle();

      if (!membership) return json({ error: 'Access denied to this business' }, 403);
    }

    const { data: suppliers, error: suppliersError } = await supabaseAdmin
      .from('rb_suppliers')
      .select('id')
      .eq('business_id', businessId)
      .eq('is_active', true);

    if (suppliersError) return json({ error: suppliersError.message }, 500);

    const supplierIds = (suppliers || []).map((s) => s.id);
    if (supplierIds.length === 0) {
      return json({ refreshed: 0, results: [], message: 'No active suppliers configured' });
    }

    let priceQuery = supabaseAdmin
      .from('rb_supplier_prices')
      .select('id, supplier_id, ingredient_id, pos_inventory_id, inventory_id, product_url, unit_of_measure')
      .in('supplier_id', supplierIds)
      .eq('is_current', true)
      .not('product_url', 'is', null);

    if (Array.isArray(body.supplier_price_ids) && body.supplier_price_ids.length > 0) {
      priceQuery = priceQuery.in('id', body.supplier_price_ids);
    }

    const { data: priceRows, error: priceError } = await priceQuery;
    if (priceError) return json({ error: priceError.message }, 500);

    const rows = priceRows || [];
    const results: RefreshResult[] = [];
    const browserRequired: BrowserRequiredRow[] = [];

    for (const row of rows) {
      const url = String(row.product_url || '').trim();
      if (!url) continue;

      if (requiresBrowserScrape(url)) {
        browserRequired.push({
          id: row.id,
          product_url: url,
          reason: 'Sysco requires logged-in browser scrape (npm run recipe:sysco-bridge)',
        });
        continue;
      }

      try {
        const parsed = await fetchProduct(url);
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

        const { error: updateError } = await supabaseAdmin
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
        const message = err instanceof Error ? err.message : 'Unknown refresh error';
        await supabaseAdmin
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

    const refreshed = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;

    let costsSynced = { ingredientsUpdated: 0, inventoryUpdated: 0 };
    if (refreshed > 0) {
      costsSynced = await syncIngredientCostsFromSupplierPrices(supabaseAdmin, businessId);
    }

    return json({
      refreshed,
      failed,
      total: results.length,
      results,
      browser_required: browserRequired,
      browser_required_count: browserRequired.length,
      costs_synced: costsSynced,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return json({ error: message }, 500);
  }
});
