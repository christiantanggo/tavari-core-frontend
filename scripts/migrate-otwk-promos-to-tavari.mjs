/**
 * One-off: copy OTWK public.promos into Tavari business_website_promotions.
 * Rewrites legacy Bookeo hrefs to Tavari party booking URL.
 *
 * OTWK promos are service-role only (no anon RLS). Reads via linked Supabase CLI
 * from the OTWK project; writes via Tavari service role from tavari-core-frontend/.env.
 *
 * Usage (from tavari-core-frontend root):
 *   node scripts/migrate-otwk-promos-to-tavari.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const otwkRoot = path.resolve(root, '../../OTWK - Website Rebuild');

loadEnv({ path: path.join(root, '.env') });

const TAVARI_BUSINESS_ID = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const WEBSITE_BASE = 'https://www.offthewallkids.ca';

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in tavari-core-frontend/.env`);
  return value;
}

function replaceBookeoUrls(value, partyBookingUrl, websiteBase) {
  if (typeof value === 'string') {
    if (/bookeo\.com/i.test(value)) return partyBookingUrl;
    if (value === '/party-promo') return `${websiteBase.replace(/\/$/, '')}/party-sale`;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => replaceBookeoUrls(item, partyBookingUrl, websiteBase));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = replaceBookeoUrls(nested, partyBookingUrl, websiteBase);
    }
    return out;
  }
  return value;
}

function fetchOtwkPromos() {
  const sql = [
    'SELECT row_to_json(p.*) AS promo',
    'FROM public.promos p',
    'ORDER BY ends_at DESC;',
  ].join('\n');
  const tempDir = mkdtempSync(path.join(tmpdir(), 'otwk-promos-'));
  const sqlPath = path.join(tempDir, 'promos.sql');
  writeFileSync(sqlPath, sql, 'utf8');

  try {
    const output = execFileSync(
      'npx',
      ['supabase', 'db', 'query', '--linked', '--file', sqlPath, '-o', 'json'],
      { cwd: otwkRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, shell: true },
    );
    const jsonStart = output.indexOf('{');
    if (jsonStart < 0) throw new Error('OTWK promo query returned no JSON');
    const payload = JSON.parse(output.slice(jsonStart));
    return (payload.rows || [])
      .map((row) => row.promo)
      .filter(Boolean);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function fetchPartyBookingUrl(tavariBase, serviceRoleKey) {
  const response = await fetch(
    `${tavariBase.replace(/\/$/, '')}/functions/v1/tavari-api-business-links?businessId=${encodeURIComponent(TAVARI_BUSINESS_ID)}`,
    {
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
      },
    },
  );
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'business-links failed');
  return payload?.links?.partyBookingUrl || payload?.links?.bookingUrl || null;
}

async function main() {
  const tavariBase = requireEnv('SUPABASE_URL');
  const tavariServiceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const tavari = createClient(tavariBase, tavariServiceKey);

  const promos = fetchOtwkPromos();
  if (!promos.length) {
    console.log('No OTWK promos to migrate.');
    return;
  }

  const partyBookingUrl = await fetchPartyBookingUrl(tavariBase, tavariServiceKey);
  if (!partyBookingUrl) throw new Error('Could not resolve Tavari party booking URL');

  for (const promo of promos) {
    const pageContent = replaceBookeoUrls(promo.page_content ?? {}, partyBookingUrl, WEBSITE_BASE);
    const row = {
      business_id: TAVARI_BUSINESS_ID,
      slug: promo.slug,
      label: promo.label,
      starts_at: promo.starts_at,
      ends_at: promo.ends_at,
      audience: 'web',
      priority: 100,
      is_active: true,
      countdown_prefix: promo.countdown_prefix || 'Sale Ends In',
      page_meta_title: promo.page_meta_title,
      page_meta_description: promo.page_meta_description,
      page_content: pageContent,
      hero_enabled: promo.hero_enabled === true,
      hero_image_url: promo.hero_image_url,
      hero_image_alt: promo.hero_image_alt || '',
      popup_enabled: promo.popup_enabled === true,
      popup_title: promo.popup_title || '',
      popup_body: promo.popup_body || '',
      popup_cta_label: promo.popup_cta_label,
      popup_cta_href: promo.popup_cta_href
        ? replaceBookeoUrls(promo.popup_cta_href, partyBookingUrl, WEBSITE_BASE)
        : null,
      home_button_enabled: promo.home_button_enabled === true,
      home_section_id: promo.home_section_id,
      home_button_label: promo.home_button_label,
      home_button_href: promo.home_button_href
        ? replaceBookeoUrls(promo.home_button_href, partyBookingUrl, WEBSITE_BASE)
        : null,
      floating_enabled: promo.floating_enabled === true,
      floating_label: promo.floating_label,
      floating_href: promo.floating_href
        ? replaceBookeoUrls(promo.floating_href, partyBookingUrl, WEBSITE_BASE)
        : null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await tavari
      .from('business_website_promotions')
      .upsert(row, { onConflict: 'business_id,slug' });

    if (error) throw error;
    console.log(`Migrated promo slug=${promo.slug}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
