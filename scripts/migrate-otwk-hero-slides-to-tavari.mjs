/**
 * One-off: copy OTWK public.hero_slides into Tavari business_website_hero_slides.
 *
 * OTWK hero_slides are public-read; this script uses linked Supabase CLI from the
 * OTWK project for a consistent export, then upserts into Tavari via service role.
 *
 * Usage (from tavari-core-frontend root):
 *   node scripts/migrate-otwk-hero-slides-to-tavari.mjs
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

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in tavari-core-frontend/.env`);
  return value;
}

function fetchOtwkHeroSlides() {
  const sql = [
    'SELECT row_to_json(h.*) AS slide',
    'FROM public.hero_slides h',
    'ORDER BY sort_order ASC, created_at ASC;',
  ].join('\n');
  const tempDir = mkdtempSync(path.join(tmpdir(), 'otwk-hero-slides-'));
  const sqlPath = path.join(tempDir, 'hero-slides.sql');
  writeFileSync(sqlPath, sql, 'utf8');

  try {
    const output = execFileSync(
      'npx',
      ['supabase', 'db', 'query', '--linked', '--file', sqlPath, '-o', 'json'],
      { cwd: otwkRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, shell: true },
    );
    const jsonStart = output.indexOf('{');
    if (jsonStart < 0) throw new Error('OTWK hero_slides query returned no JSON');
    const payload = JSON.parse(output.slice(jsonStart));
    return (payload.rows || [])
      .map((row) => row.slide)
      .filter(Boolean);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const tavariBase = requireEnv('SUPABASE_URL');
  const tavariServiceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const tavari = createClient(tavariBase, tavariServiceKey);

  const slides = fetchOtwkHeroSlides();
  if (!slides.length) {
    console.log('No OTWK hero slides to migrate.');
    return;
  }

  for (const slide of slides) {
    const slug = String(slide.id || '').trim().toLowerCase();
    if (!slug) {
      console.warn('Skipping slide without id');
      continue;
    }

    const row = {
      business_id: TAVARI_BUSINESS_ID,
      slug,
      image_url: slide.image_url,
      alt: slide.alt || '',
      title: slide.title,
      caption: slide.caption,
      cta_text: slide.cta_text,
      cta_href: slide.cta_href,
      sort_order: slide.sort_order ?? 0,
      show_text_overlay: slide.show_text_overlay !== false,
      image_focus_x: slide.image_focus_x ?? 50,
      image_focus_y: slide.image_focus_y ?? 50,
      valid_from: slide.valid_from,
      valid_until: slide.valid_until,
      show_on_days: Array.isArray(slide.show_on_days) ? slide.show_on_days : null,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    const { error } = await tavari
      .from('business_website_hero_slides')
      .upsert(row, { onConflict: 'business_id,slug' });

    if (error) {
      console.error(`Failed to upsert slide ${slug}:`, error.message);
    } else {
      console.log(`Upserted hero slide ${slug} (sort_order=${row.sort_order})`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
