/**
 * One-off: copy OTWK builder_pages into Tavari business_website_builder_pages.
 *
 * Phase 1 (default): home + top 5 marketing slugs.
 * Pass MIGRATE_ALL=true to migrate every OTWK builder page row.
 *
 * Usage (from tavari-core-frontend root):
 *   node scripts/migrate-otwk-builder-pages-to-tavari.mjs
 *   MIGRATE_ALL=true node scripts/migrate-otwk-builder-pages-to-tavari.mjs
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

/** Phase 1 rollout — highest-traffic CMS pages. */
const PHASE_1_SLUGS = [
  'home',
  'kids-birthday-parties-london-ontario',
  'admission-pricing',
  'holiday-hours-london-ontario',
  'indoor-playground-london-ontario',
  'contact',
];

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in tavari-core-frontend/.env`);
  return value;
}

function fetchOtwkBuilderPages(slugs) {
  const slugList = slugs.map((slug) => `'${slug.replace(/'/g, "''")}'`).join(', ');
  const whereClause = slugs.length > 0 ? `WHERE slug IN (${slugList})` : '';
  const sql = [
    'SELECT row_to_json(bp.*) AS page',
    'FROM public.builder_pages bp',
    whereClause,
    'ORDER BY slug ASC;',
  ].join('\n');
  const tempDir = mkdtempSync(path.join(tmpdir(), 'otwk-builder-pages-'));
  const sqlPath = path.join(tempDir, 'builder-pages.sql');
  writeFileSync(sqlPath, sql, 'utf8');

  try {
    const output = execFileSync(
      'npx',
      ['supabase', 'db', 'query', '--linked', '--file', sqlPath, '-o', 'json'],
      { cwd: otwkRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, shell: true },
    );
    const jsonStart = output.indexOf('{');
    if (jsonStart < 0) throw new Error('OTWK builder_pages query returned no JSON');
    const payload = JSON.parse(output.slice(jsonStart));
    return (payload.rows || [])
      .map((row) => row.page)
      .filter(Boolean);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const migrateAll = String(process.env.MIGRATE_ALL || '').toLowerCase() === 'true';
  const slugs = migrateAll ? [] : PHASE_1_SLUGS;

  const tavariBase = requireEnv('SUPABASE_URL');
  const tavariServiceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const tavari = createClient(tavariBase, tavariServiceKey);

  const pages = fetchOtwkBuilderPages(slugs);
  if (!pages.length) {
    console.log('No OTWK builder pages to migrate.');
    return;
  }

  console.log(`Migrating ${pages.length} builder page(s)${migrateAll ? ' (all)' : ' (phase 1)'}...`);

  for (const page of pages) {
    const slug = String(page.slug || '').trim().toLowerCase();
    if (!slug) {
      console.warn('Skipping builder page without slug');
      continue;
    }

    const row = {
      business_id: TAVARI_BUSINESS_ID,
      slug,
      label: page.label || slug,
      content: page.content && typeof page.content === 'object' ? page.content : { sections: [] },
      is_active: true,
      updated_at: page.updated_at || new Date().toISOString(),
    };

    const { error } = await tavari
      .from('business_website_builder_pages')
      .upsert(row, { onConflict: 'business_id,slug' });

    if (error) {
      console.error(`Failed ${slug}:`, error.message);
    } else {
      const sectionCount = Array.isArray(row.content?.sections) ? row.content.sections.length : 0;
      console.log(`Upserted builder page ${slug} (${sectionCount} sections)`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
