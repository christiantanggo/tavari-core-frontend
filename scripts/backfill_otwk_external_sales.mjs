/**
 * Backfill Clover + Authorize.net sales for OTWK London, one day per request.
 * Usage: node scripts/backfill_otwk_external_sales.mjs [startDate] [endDate]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUSINESS_ID = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const DEFAULT_START = '2020-02-15';
const DEFAULT_END = new Date().toISOString().slice(0, 10);
const SLEEP_MS = 120;

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

function dateKeysBetween(startKey, endKey) {
  const dates = [];
  const [sy, sm, sd] = startKey.split('-').map(Number);
  const [ey, em, ed] = endKey.split('-').map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  for (let t = start; t <= end; t += 86400000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function invokeSync(supabase, functionName, syncDate) {
  const { data, error } = await supabase.functions.invoke(functionName, {
    body: { businessId: BUSINESS_ID, syncDate },
  });
  if (error) {
    const msg = error.message || String(error);
    if (/not configured/i.test(msg)) return { skipped: true, data: null };
    throw new Error(`${functionName} ${syncDate}: ${msg}`);
  }
  if (data?.error) {
    if (/not configured/i.test(String(data.error))) return { skipped: true, data: null };
    throw new Error(`${functionName} ${syncDate}: ${data.error}`);
  }
  return { skipped: false, data: data || {} };
}

async function main() {
  const env = loadEnv();
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  const startDate = process.argv[2] || DEFAULT_START;
  const endDate = process.argv[3] || DEFAULT_END;
  const days = dateKeysBetween(startDate, endDate);

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Backfill ${days.length} day(s): ${startDate} -> ${endDate}`);

  let cloverSkipped = false;
  let anetSkipped = false;
  const totals = {
    cloverImported: 0,
    cloverUpdated: 0,
    cloverScanned: 0,
    anetImported: 0,
    anetUpdated: 0,
    anetScanned: 0,
    errors: [],
  };

  for (let i = 0; i < days.length; i += 1) {
    const syncDate = days[i];
    process.stdout.write(`\r[${i + 1}/${days.length}] ${syncDate}   `);

    try {
      const [cloverResult, anetResult] = await Promise.allSettled([
        invokeSync(supabase, 'clover-sync-sales', syncDate),
        invokeSync(supabase, 'authorize-net-sync-sales', syncDate),
      ]);

      if (cloverResult.status === 'rejected') {
        totals.errors.push(`Clover ${syncDate}: ${cloverResult.reason?.message || cloverResult.reason}`);
      } else if (cloverResult.value.skipped) {
        cloverSkipped = true;
      } else {
        totals.cloverScanned += cloverResult.value.data?.scanned || 0;
        totals.cloverImported += cloverResult.value.data?.imported || 0;
        totals.cloverUpdated += cloverResult.value.data?.updated || 0;
      }

      if (anetResult.status === 'rejected') {
        totals.errors.push(`Authorize.net ${syncDate}: ${anetResult.reason?.message || anetResult.reason}`);
      } else if (anetResult.value.skipped) {
        anetSkipped = true;
      } else {
        totals.anetScanned += anetResult.value.data?.scanned || 0;
        totals.anetImported += anetResult.value.data?.imported || 0;
        totals.anetUpdated += anetResult.value.data?.updated || 0;
      }
    } catch (err) {
      totals.errors.push(`${syncDate}: ${err.message || err}`);
    }

    if (i < days.length - 1) await sleep(SLEEP_MS);
  }

  console.log('\n\nDone.');
  console.log(
    `Clover: ${totals.cloverImported} imported, ${totals.cloverUpdated} updated, ${totals.cloverScanned} scanned${
      cloverSkipped ? ' (skipped — not configured)' : ''
    }`,
  );
  console.log(
    `Authorize.net: ${totals.anetImported} imported, ${totals.anetUpdated} updated, ${totals.anetScanned} scanned${
      anetSkipped ? ' (skipped — not configured)' : ''
    }`,
  );
  if (totals.errors.length) {
    console.log(`Errors (${totals.errors.length}):`);
    totals.errors.slice(0, 20).forEach((e) => console.log(' -', e));
    if (totals.errors.length > 20) console.log(` ... and ${totals.errors.length - 20} more`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
