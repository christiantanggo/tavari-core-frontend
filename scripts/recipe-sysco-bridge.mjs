/**
 * Local HTTP bridge so Recipe Manager "Refresh Prices" can scrape Sysco in one click.
 *
 * Run alongside dev server:
 *   npm run recipe:sysco-bridge
 *
 * Env: same as recipe-refresh-sysco-prices.mjs
 */
import 'dotenv/config';
import http from 'http';
import {
  createSupabaseAdmin,
  refreshSyscoSupplierPrices,
} from './lib/refreshSyscoPrices.mjs';

const PORT = Number(process.env.RECIPE_SYSCO_BRIDGE_PORT || 3927);
const supabase = createSupabaseAdmin();

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true, service: 'recipe-sysco-bridge' });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/refresh') {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', async () => {
    try {
      const payload = JSON.parse(body || '{}');
      const businessId = payload.business_id;
      if (!businessId) {
        sendJson(res, 400, { error: 'Missing business_id' });
        return;
      }

      const result = await refreshSyscoSupplierPrices({
        supabase,
        businessId,
        supplierPriceIds: payload.supplier_price_ids,
        headless: true,
      });

      sendJson(res, 200, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected bridge error';
      sendJson(res, 500, { error: message });
    }
  });
});

server.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.log(`Recipe Sysco bridge already running on http://127.0.0.1:${PORT}`);
    process.exit(0);
    return;
  }
  console.error('Recipe Sysco bridge failed:', err.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Recipe Sysco bridge listening on http://127.0.0.1:${PORT}`);
  console.log('POST /refresh  { business_id, supplier_price_ids? }');
  console.log('GET  /health');
});
