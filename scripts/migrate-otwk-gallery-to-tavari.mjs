/**
 * One-off: copy OTWK gallery_images into Tavari business_website_gallery_images.
 *
 * Usage (from tavari-core-frontend root):
 *   node scripts/migrate-otwk-gallery-to-tavari.mjs
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

function fetchOtwkGalleryImages() {
  const sql = [
    'SELECT row_to_json(g.*) AS image',
    'FROM public.gallery_images g',
    'ORDER BY sort_order ASC, created_at ASC;',
  ].join('\n');
  const tempDir = mkdtempSync(path.join(tmpdir(), 'otwk-gallery-'));
  const sqlPath = path.join(tempDir, 'gallery.sql');
  writeFileSync(sqlPath, sql, 'utf8');

  try {
    const output = execFileSync(
      'npx',
      ['supabase', 'db', 'query', '--linked', '--file', sqlPath, '-o', 'json'],
      { cwd: otwkRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, shell: true },
    );
    const jsonStart = output.indexOf('{');
    if (jsonStart < 0) throw new Error('OTWK gallery_images query returned no JSON');
    const payload = JSON.parse(output.slice(jsonStart));
    return (payload.rows || [])
      .map((row) => row.image)
      .filter(Boolean);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const tavariBase = requireEnv('SUPABASE_URL');
  const tavariServiceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const tavari = createClient(tavariBase, tavariServiceKey);

  const images = fetchOtwkGalleryImages();
  if (!images.length) {
    console.log('No OTWK gallery images to migrate.');
    return;
  }

  for (const image of images) {
    const slug = String(image.id || '').trim().toLowerCase();
    if (!slug) {
      console.warn('Skipping gallery image without id');
      continue;
    }

    const row = {
      id: image.id,
      business_id: TAVARI_BUSINESS_ID,
      slug,
      image_url: image.image_url,
      alt: image.alt || '',
      caption: null,
      tags: [],
      storage_path: image.storage_path || null,
      sort_order: image.sort_order ?? 0,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    const { error } = await tavari
      .from('business_website_gallery_images')
      .upsert(row, { onConflict: 'business_id,slug' });

    if (error) {
      console.error(`Failed to upsert gallery image ${slug}:`, error.message);
    } else {
      console.log(`Upserted gallery image ${slug} (sort_order=${row.sort_order})`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
