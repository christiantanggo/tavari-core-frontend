// Refresh CAD/USD prices for Dividend Income watchlist via Yahoo Finance chart API.
// POST { business_id: string }
// Deploy: npx supabase functions deploy dividend-income-refresh-quotes --no-verify-jwt

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function fetchYahooPrice(symbol: string): Promise<number | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    '?interval=1d&range=5d';
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  });
  if (!res.ok) return null;
  const body = await res.json();
  const meta = body?.chart?.result?.[0]?.meta;
  const price = Number(meta?.regularMarketPrice ?? meta?.previousClose);
  return Number.isFinite(price) && price > 0 ? price : null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const businessId = String(body?.business_id || '').trim();
    if (!businessId) {
      return json({ error: 'business_id required' }, 400);
    }

    const { data: membership } = await admin
      .from('business_users')
      .select('role')
      .eq('business_id', businessId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership) {
      return json({ error: 'Not a member of this business' }, 403);
    }

    const { data: biz } = await admin
      .from('businesses')
      .select('id, name')
      .eq('id', businessId)
      .maybeSingle();

    if (!biz || String(biz.name || '').trim().toLowerCase() !== 'christian fournier') {
      return json({ error: 'Dividend quotes only allowed for Christian Fournier business' }, 403);
    }

    const { data: instruments, error: instErr } = await admin
      .from('div_instruments')
      .select('id, ticker, yahoo_symbol, last_price, currency')
      .eq('business_id', businessId)
      .eq('active', true);

    if (instErr) {
      return json({ error: instErr.message }, 500);
    }

    const results: Array<Record<string, unknown>> = [];
    const now = new Date().toISOString();

    for (const inst of instruments || []) {
      const isUsd = String(inst.currency || 'CAD').toUpperCase() === 'USD';
      const symbol = inst.yahoo_symbol || (isUsd ? inst.ticker : `${inst.ticker}.TO`);
      try {
        const price = await fetchYahooPrice(symbol);
        if (price == null) {
          results.push({ ticker: inst.ticker, ok: false, error: 'No price from Yahoo' });
          continue;
        }

        const { error: updErr } = await admin
          .from('div_instruments')
          .update({
            last_price: price,
            price_updated_at: now,
            updated_at: now,
          })
          .eq('id', inst.id);

        if (updErr) {
          results.push({ ticker: inst.ticker, ok: false, error: updErr.message });
          continue;
        }

        await admin.from('div_price_snapshots').insert({
          business_id: businessId,
          instrument_id: inst.id,
          as_of: now,
          price,
          source: 'yahoo_chart',
        });

        results.push({ ticker: inst.ticker, ok: true, price, previous: inst.last_price });
      } catch (e) {
        results.push({
          ticker: inst.ticker,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return json({
      ok: true,
      refreshed_at: now,
      results,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
