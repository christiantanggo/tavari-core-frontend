/**
 * Remove menu items and refresh grab-and-go photos from the Snacks folder.
 * Run: node scripts/update-otwk-menu-and-snack-photos.mjs
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const BUCKET = 'pos-product-images';

const SNACKS_DIR =
  'C:/Users/chris/OneDrive/Desktop/One Drive/OneDrive/! OTWK/A2 - Marketing/Concession/Food App Photos/Snacks';

const REMOVE_NAMES = new Set(['Dessert Bar & Ice Cream', 'Assorted Snacks']);

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function prepareJpeg(sourcePath, { fit = 'contain' } = {}) {
  const buf = fs.readFileSync(sourcePath);
  return sharp(buf)
    .flatten({ background: '#ffffff' })
    .resize(600, 600, { fit, position: 'centre', background: '#ffffff' })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function uploadImage(jpegBuf, slug) {
  const storagePath = `${BIZ}/${randomUUID()}_otwk_${slug}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, jpegBuf, {
    contentType: 'image/jpeg',
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

async function setInventoryImage(ids, url) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return;
  const { error } = await supabase
    .from('pos_inventory')
    .update({ image_url: url })
    .eq('business_id', BIZ)
    .in('id', unique);
  if (error) throw error;
}

const SNACK_PHOTOS = [
  {
    slug: 'choc-bar',
    file: path.join(SNACKS_DIR, 'Aero chocolate bar.png'),
    ids: ['bf9a1ebf-82e3-42d3-9fc7-bcf5fa5a035c'],
  },
  {
    slug: 'bear-paw',
    file: path.join(SNACKS_DIR, 'bear paw.png'),
    ids: ['b50a14b6-2132-4278-8ab2-fb4cbca0fd12'],
  },
  {
    slug: 'hot-rod',
    file: path.join(SNACKS_DIR, 'hot rod.png'),
    ids: ['23471f37-b634-4dcb-861f-33db1d0e9703'],
  },
  {
    slug: 'cheese-string',
    file: path.join(SNACKS_DIR, 'cheese string.png'),
    ids: ['a25f9485-e096-4064-9714-7ccf656dc7d2'],
  },
  {
    slug: 'yogurt-tube',
    file: path.join(SNACKS_DIR, 'yogurt tube.png'),
    ids: ['3f007b99-c258-4806-a22d-ff4ecf1f8a71'],
  },
  {
    slug: 'chips',
    file: path.join(SNACKS_DIR, 'Lays chips.jpg'),
    ids: ['a8beb0c7-5dfd-4de3-90b7-e76f007192d5'],
  },
  {
    slug: 'juice-box',
    file: path.join(SNACKS_DIR, 'minute maid apple juice box.png'),
    ids: ['1f9c2f95-e1e3-4d67-9659-ca7b81959845'],
  },
];

// --- Remove menu items ---
const { data, error } = await supabase
  .from('business_website_menu')
  .select('menu_sections')
  .eq('business_id', BIZ)
  .single();
if (error) throw error;

const sections = (data.menu_sections || []).map((section) => ({
  ...section,
  items: (section.items || []).filter((item) => {
    const name = (item.displayName || item.name || '').trim();
    return !REMOVE_NAMES.has(name);
  }),
}));

const { error: menuErr } = await supabase
  .from('business_website_menu')
  .update({ menu_sections: sections, updated_at: new Date().toISOString() })
  .eq('business_id', BIZ);
if (menuErr) throw menuErr;

console.log('Removed from menu: Dessert Bar & Ice Cream, Assorted Snacks');

// --- Upload snack photos ---
const previewDir = path.join(__dirname, 'snacks-photos-preview');
fs.mkdirSync(previewDir, { recursive: true });

for (const item of SNACK_PHOTOS) {
  if (!fs.existsSync(item.file)) {
    console.error(`✗ ${item.slug}: missing ${item.file}`);
    continue;
  }
  const jpeg = await prepareJpeg(item.file);
  fs.writeFileSync(path.join(previewDir, `${item.slug}.jpg`), jpeg);
  const url = await uploadImage(jpeg, item.slug);
  await setInventoryImage(item.ids, url);
  console.log(`✓ ${item.slug} <- ${path.basename(item.file)}`);
}

console.log(`\nPreviews: ${previewDir}`);
