/**
 * Crop product photos from OTWK menu board screens and assign to pos_inventory.image_url.
 * Run: node scripts/assign-menu-board-product-images.mjs
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

const ASSETS_DIR =
  process.env.MENU_BOARD_ASSETS_DIR ||
  'C:/Users/chris/.cursor/projects/c-Users-chris-OneDrive-Desktop-One-Drive-OneDrive-Apps-TAVARI-FULL-PROJECT-tavari-core-frontend/assets';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function screenFile(n) {
  const dir = ASSETS_DIR;
  const match = fs
    .readdirSync(dir)
    .filter((f) => f.includes(`Menu_Board_-_Screen_${n}-`))
    .sort()[0];
  if (!match) throw new Error(`Missing menu board screen ${n} in ${dir}`);
  return path.join(dir, match);
}

async function loadScreen(n) {
  const file = screenFile(n);
  const buf = fs.readFileSync(file);
  const meta = await sharp(buf).metadata();
  return { buf, width: meta.width, height: meta.height, file };
}

/** Crop using fractional coords relative to source image. */
function cropBox(w, h, { left = 0, top = 0, width = 1, height = 1 }) {
  const x = Math.max(0, Math.round(left * w));
  const y = Math.max(0, Math.round(top * h));
  const cw = Math.min(w - x, Math.round(width * w));
  const ch = Math.min(h - y, Math.round(height * h));
  return { left: x, top: y, width: cw, height: ch };
}

async function cropFromScreen(screenBuf, meta, box) {
  const region = cropBox(meta.width, meta.height, box);
  return sharp(screenBuf)
    .extract(region)
    .resize(480, 480, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 88 })
    .toBuffer();
}

async function uploadImage(jpegBuf, slug) {
  const storagePath = `${BIZ}/${randomUUID()}_menu-board_${slug}.jpg`;
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

async function updateManualMenuImage(menuName, url) {
  const { data, error } = await supabase
    .from('business_website_menu')
    .select('menu_sections')
    .eq('business_id', BIZ)
    .single();
  if (error) throw error;

  let changed = false;
  const sections = (data.menu_sections || []).map((section) => ({
    ...section,
    items: (section.items || []).map((item) => {
      if (item.kind === 'manual' && item.name?.trim() === menuName) {
        changed = true;
        return { ...item, imageSrc: url };
      }
      return item;
    }),
  }));

  if (!changed) {
    console.warn(`  (manual menu item not found: ${menuName})`);
    return;
  }

  const { error: updateErr } = await supabase
    .from('business_website_menu')
    .update({ menu_sections: sections, updated_at: new Date().toISOString() })
    .eq('business_id', BIZ);
  if (updateErr) throw updateErr;
}

/** @type {Array<{ slug: string; ids: string[]; screen: number; box: object }>} */
const ASSIGNMENTS = [
  // Screen 2 — sides (left column, photos on right of panel)
  {
    slug: 'fries',
    ids: ['75556c7d-140e-48ad-bbc5-dc3f02037538', 'c9efbb61-2f20-42e6-8e7f-a1d1add15345', 'd72c092e-ed02-49fe-8ea9-39ca18b78854'],
    screen: 2,
    box: { left: 0.2, top: 0.15, width: 0.09, height: 0.14 },
  },
  {
    slug: 'poutine',
    ids: ['d4835dbe-552b-414d-b7f7-e1314b9fb08e', '67015e2f-1cf1-4210-9103-7352f10a4f70', '5e4b8c6f-7c7e-4166-b346-73594a242270'],
    screen: 2,
    box: { left: 0.18, top: 0.36, width: 0.14, height: 0.18 },
  },
  {
    slug: 'onion-rings',
    ids: ['3bf8cd02-dec3-43ba-8413-027fe8584f2e', '6ea975ba-ae91-4415-8dd7-0de1b4ba1f65', 'a67ff363-9b4d-4068-b792-fb5dd7f2935c'],
    screen: 2,
    box: { left: 0.18, top: 0.6, width: 0.14, height: 0.18 },
  },
  // Screen 2 — meals (center grid)
  {
    slug: 'chicken-nuggets',
    ids: ['d6455cd0-a1af-4a4c-8216-0a706ddc0975', 'c5da6d88-d28d-4728-8638-cbcddecaa254'],
    screen: 2,
    box: { left: 0.36, top: 0.14, width: 0.2, height: 0.2 },
  },
  {
    slug: 'chicken-strips',
    ids: ['e81815b8-8838-40a9-a46d-707544ca7d15', '162622c0-1855-4827-a6f5-4694705916fd'],
    screen: 2,
    box: { left: 0.56, top: 0.14, width: 0.2, height: 0.2 },
  },
  {
    slug: 'hot-dog',
    ids: ['69e75f82-2543-40f4-95da-1ec3ae843804', '3da829d2-f5d2-4d55-b50a-3c118c16423a'],
    screen: 2,
    box: { left: 0.36, top: 0.52, width: 0.16, height: 0.16 },
  },
  {
    slug: 'thunder-crunch',
    ids: ['315fff44-2cd0-4aca-b701-fb6b6f7e3b0d', '947133c5-6a23-4f89-9811-73c297b55b43'],
    screen: 2,
    box: { left: 0.54, top: 0.5, width: 0.22, height: 0.22 },
  },
  // Screen 2 — snacks (right column, photos on left of panel)
  {
    slug: 'fried-pickles',
    ids: ['867ff13f-6152-4fcd-b6a6-594514dee2f5'],
    screen: 2,
    box: { left: 0.76, top: 0.12, width: 0.16, height: 0.18 },
  },
  {
    slug: 'mozzarella-sticks',
    ids: ['6a5b50f7-5955-40eb-82a2-44e627f5fa43'],
    screen: 2,
    box: { left: 0.76, top: 0.32, width: 0.16, height: 0.18 },
  },
  {
    slug: 'fiesta-poppers',
    ids: ['0b58c2b6-e641-4665-8f34-deb37c4ec803'],
    screen: 2,
    box: { left: 0.76, top: 0.52, width: 0.16, height: 0.18 },
  },
  {
    slug: 'funnel-cake',
    ids: ['6964ec24-4a07-4898-a0dd-b5d2bf4f5702', '2d3abac4-796d-4283-9acb-79065de73fbf', 'c73daaf3-9695-4127-85ab-357b145d816c'],
    screen: 2,
    box: { left: 0.76, top: 0.72, width: 0.16, height: 0.18 },
  },

  // Screen 3 — pizza
  {
    slug: 'pizza-7',
    ids: ['0556ce17-d923-4212-b71a-9e596dfd53e2', '8b9b0f6c-48bc-4f82-bbdb-c8e6d202204e'],
    screen: 3,
    box: { left: 0.06, top: 0.2, width: 0.4, height: 0.48 },
  },
  {
    slug: 'pizza-12',
    ids: ['2f2d5b05-adba-4f44-96fd-420db2984222'],
    screen: 3,
    box: { left: 0.54, top: 0.2, width: 0.4, height: 0.48 },
  },

  // Screen 4 — dessert row
  {
    slug: 'dessert-bar',
    ids: ['d980d712-2d88-4b5c-a305-99f3669b121a'],
    screen: 4,
    box: { left: 0.06, top: 0.58, width: 0.42, height: 0.34 },
  },

  // Screen 1 — column 1 (photos on right of panel)
  {
    slug: 'fruit-veg',
    ids: ['3be4ed2a-6cc2-4945-a9fb-2e36a82f505d'],
    screen: 1,
    box: { left: 0.16, top: 0.12, width: 0.16, height: 0.16 },
  },
  {
    slug: 'hummus',
    ids: ['32341c0e-e76b-4bb1-9f0e-a075316419f8'],
    screen: 1,
    box: { left: 0.16, top: 0.28, width: 0.16, height: 0.12 },
  },
  {
    slug: 'choc-bar',
    ids: ['bf9a1ebf-82e3-42d3-9fc7-bcf5fa5a035c'],
    screen: 1,
    box: { left: 0.16, top: 0.4, width: 0.16, height: 0.12 },
  },
  {
    slug: 'bear-paw-hot-rod',
    ids: ['b50a14b6-2132-4278-8ab2-fb4cbca0fd12', '23471f37-b634-4dcb-861f-33db1d0e9703'],
    screen: 1,
    box: { left: 0.16, top: 0.52, width: 0.16, height: 0.12 },
  },
  {
    slug: 'cheese-yogurt',
    ids: ['a25f9485-e096-4064-9714-7ccf656dc7d2', '3f007b99-c258-4806-a22d-ff4ecf1f8a71'],
    screen: 1,
    box: { left: 0.16, top: 0.64, width: 0.16, height: 0.14 },
  },

  // Screen 1 — column 2 (photos on right of panel)
  {
    slug: 'pepsi',
    ids: ['283280bf-fc6c-441f-90e8-40e48e6e9da7', '186eabf5-55d3-47d8-996c-b8a7f950a9c6', '7bd452d9-a62a-4265-ab34-1df3603fe9be'],
    screen: 1,
    box: { left: 0.58, top: 0.1, width: 0.12, height: 0.2 },
  },
  {
    slug: 'slush-puppie',
    ids: ['86a98590-3fdd-455b-9d1c-a4893c445bbd', '3906d89a-be73-4dee-8a79-2844dde9ed82', '687c04a0-9d1d-4e5e-abe6-4dfcdabeac7c'],
    screen: 1,
    box: { left: 0.56, top: 0.28, width: 0.14, height: 0.18 },
  },
  {
    slug: 'chips',
    ids: ['a8beb0c7-5dfd-4de3-90b7-e76f007192d5'],
    screen: 1,
    box: { left: 0.5, top: 0.48, width: 0.16, height: 0.12 },
  },
  {
    slug: 'asst-snacks',
    ids: [],
    manualMenuName: 'Assorted Snacks',
    screen: 1,
    box: { left: 0.5, top: 0.6, width: 0.16, height: 0.12 },
  },
  {
    slug: 'hot-chocolate',
    ids: ['bfa87edd-31d7-41d4-991e-185e0dc3b312'],
    screen: 1,
    box: { left: 0.52, top: 0.74, width: 0.14, height: 0.14 },
  },

  // Screen 1 — column 3 (photos on left of panel)
  {
    slug: 'juice-box',
    ids: ['1f9c2f95-e1e3-4d67-9659-ca7b81959845'],
    screen: 1,
    box: { left: 0.67, top: 0.11, width: 0.09, height: 0.11 },
  },
  {
    slug: 'bubly-water',
    ids: ['e145a462-5757-4946-92f4-748f9b4af8ad', '88e618de-c262-4ab1-ad45-2e434d3885d7'],
    screen: 1,
    box: { left: 0.66, top: 0.22, width: 0.14, height: 0.12 },
  },
  {
    slug: 'coffee-tea-milk',
    ids: ['15cbacf8-2ff9-4fa5-b400-db92ea90e90e', '91a6632a-f676-4334-920d-802f9a3a9bed', 'a4f9a613-75b5-4eba-b6f9-ce5f04e0dfaf'],
    screen: 1,
    box: { left: 0.66, top: 0.36, width: 0.14, height: 0.12 },
  },
  {
    slug: 'gatorade',
    ids: ['32f22b7c-8e69-407a-8839-bd440af60417'],
    manualMenuName: 'Gatorade',
    screen: 1,
    box: { left: 0.66, top: 0.5, width: 0.14, height: 0.12 },
  },
  {
    slug: 'aloe-coconut',
    ids: ['0964dc50-51d1-4c0d-a0f2-1920ba17f86b', '4706d933-be72-428c-96fc-baad200ff76f'],
    screen: 1,
    box: { left: 0.66, top: 0.63, width: 0.14, height: 0.12 },
  },
  {
    slug: 'asst-drinks',
    ids: [],
    manualMenuName: 'Assorted Drinks',
    screen: 1,
    box: { left: 0.66, top: 0.76, width: 0.14, height: 0.14 },
  },
];

async function main() {
  console.log('Loading menu board screens...');
  const screens = {};
  for (const n of [1, 2, 3, 4]) {
    screens[n] = await loadScreen(n);
    console.log(`  Screen ${n}: ${screens[n].width}x${screens[n].height}`);
  }

  const outPreviewDir = path.join(__dirname, 'menu-board-crops-preview');
  fs.mkdirSync(outPreviewDir, { recursive: true });

  let ok = 0;
  let fail = 0;

  for (const item of ASSIGNMENTS) {
    try {
      const jpeg = await cropFromScreen(screens[item.screen].buf, screens[item.screen], item.box);
      fs.writeFileSync(path.join(outPreviewDir, `${item.slug}.jpg`), jpeg);
      const url = await uploadImage(jpeg, item.slug);
      await setInventoryImage(item.ids, url);
      if (item.manualMenuName) await updateManualMenuImage(item.manualMenuName, url);
      const count = item.ids.length || (item.manualMenuName ? 1 : 0);
      console.log(`✓ ${item.slug} -> ${count} target(s)`);
      ok += 1;
    } catch (err) {
      console.error(`✗ ${item.slug}:`, err.message || err);
      fail += 1;
    }
  }

  console.log(`\nDone. ${ok} assigned, ${fail} failed.`);
  console.log(`Preview crops: ${outPreviewDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
