/**
 * Build daily_sales_ledger_days cache for OTWK London in monthly chunks.
 * Usage: node scripts/backfill_daily_sales_ledger_days.mjs [startDate] [endDate]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUSINESS_ID = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const DEFAULT_START = '2020-02-15';
const DEFAULT_END = new Date().toISOString().slice(0, 10);

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

function monthRangesBetween(startKey, endKey) {
  const ranges = [];
  let [y, m] = startKey.split('-').map(Number);
  const [endY, endM] = endKey.split('-').map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    ranges.push({
      start: monthStart < startKey ? startKey : monthStart,
      end: monthEnd > endKey ? endKey : monthEnd,
    });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return ranges;
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
  const ranges = monthRangesBetween(startDate, endDate);

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Rebuild ledger day cache: ${startDate} -> ${endDate} (${ranges.length} month chunk(s))`);

  let totalCached = 0;
  for (let i = 0; i < ranges.length; i += 1) {
    const { start, end } = ranges[i];
    process.stdout.write(`[${i + 1}/${ranges.length}] ${start} -> ${end} ... `);
    const { data, error } = await supabase.functions.invoke('daily-sales-ledger', {
      headers: { Authorization: `Bearer ${serviceKey}` },
      body: {
        action: 'rebuild_ledger_days',
        business_id: BUSINESS_ID,
        start_date: start,
        end_date: end,
      },
    });
    if (error) {
      console.error('failed:', error.message || error);
      process.exit(1);
    }
    if (data?.error) {
      console.error('failed:', data.error);
      process.exit(1);
    }
    totalCached += data?.cachedDays || 0;
    console.log(`${data?.cachedDays || 0} day(s) cached`);
  }

  console.log(`Done. ${totalCached} day row(s) cached total.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
