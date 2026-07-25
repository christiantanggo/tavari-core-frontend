/**
 * One-off: insert a sample row into public.legacy_waivers for the current business.
 * Requires: migration 20260423120000_legacy_waivers_table.sql applied, and .env with VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY.
 * Run as a user who is in business_users for the business (uses browser session — prefer Supabase SQL editor for service role).
 *
 * Usage:
 *   node scripts/insert-sample-legacy-waiver.mjs <business_uuid>
 *
 * Or set BUSINESS_ID env.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadEnv() {
  try {
    const raw = readFileSync(join(root, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      const k = m[1].trim();
      let v = m[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    /* no .env */
  }
}

loadEnv();

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
const businessId = process.env.BUSINESS_ID || process.argv[2];

if (!url || !key) {
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (from .env or env).');
  process.exit(1);
}
if (!businessId) {
  console.error('Usage: node scripts/insert-sample-legacy-waiver.mjs <business_uuid>');
  process.exit(1);
}

const supabase = createClient(url, key);

const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
if (sessionError) console.warn(sessionError);
if (!sessionData?.session) {
  console.error(
    'No Supabase session. This script needs a logged-in JWT — run from a small app script or use the SQL editor with INSERT as postgres instead.',
  );
  process.exit(1);
}

const { data, error } = await supabase
  .from('legacy_waivers')
  .insert({
    business_id: businessId,
    source_system: 'wallkids',
    legacy_row_id: Math.floor(Date.now() / 1000),
    first_name: 'Sample',
    last_name: 'Legacy',
    email: 'legacy.sample@example.com',
    phone: '555-0100',
    num_minors: 0,
    notes: 'Sample legacy_waivers row for UI testing.',
    signed_at: new Date().toISOString()
  })
  .select('id')
  .single();

if (error) {
  console.error('Insert failed:', error);
  process.exit(1);
}

console.log('Inserted legacy_waivers id:', data.id);
console.log('Open waivers dashboard; detail URL id:', `legacy-${data.id}`);
