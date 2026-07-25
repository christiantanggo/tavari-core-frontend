/**
 * Assign OTWK individual food-app product photos to pos_inventory.image_url.
 * Sources: Uber Eats, Skip The Dishes, Door Dash, Menu Board, For all food apps folders.
 *
 * Run: node scripts/assign-otwk-food-app-photos.mjs
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

const PHOTOS_ROOT =
  process.env.OTWK_FOOD_PHOTOS_ROOT ||
  'C:/Users/chris/OneDrive/Desktop/One Drive/OneDrive/! OTWK/A2 - Marketing/Concession/Food App Photos';

const OTWK_MENU_ITEMS_DIR =
  process.env.OTWK_MENU_ITEMS_DIR ||
  'C:/Users/chris/OneDrive/Desktop/One Drive/OneDrive/Apps/OTWK - Website Rebuild/public/menu/items';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function photo(...parts) {
  return path.join(PHOTOS_ROOT, ...parts);
}

async function prepareJpeg(sourcePath, { fit = 'cover' } = {}) {
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

/** @type {Array<{ slug: string; file: string; ids?: string[]; manualMenuName?: string; websiteFile?: string }>} */
const ASSIGNMENTS = [
  // Meals
  {
    slug: 'chicken-nuggets',
    file: photo('Uber Eats Photos', 'Nuggets.jpg'),
    ids: ['d6455cd0-a1af-4a4c-8216-0a706ddc0975', 'c5da6d88-d28d-4728-8638-cbcddecaa254'],
    websiteFile: 'chicken-nuggets.jpg',
  },
  {
    slug: 'chicken-strips',
    file: photo('Uber Eats Photos', 'Chicken Strips.jpg'),
    ids: ['e81815b8-8838-40a9-a46d-707544ca7d15', '162622c0-1855-4827-a6f5-4694705916fd'],
    websiteFile: 'chicken-strips.jpg',
  },
  {
    slug: 'hot-dog',
    file: photo('Uber Eats Photos', 'Hot Dog.jpg'),
    ids: ['69e75f82-2543-40f4-95da-1ec3ae843804', '3da829d2-f5d2-4d55-b50a-3c118c16423a'],
    websiteFile: 'hot-dog.jpg',
  },
  {
    slug: 'thunder-crunch',
    file: photo('Uber Eats Photos', 'Thunder Crunch.jpg'),
    ids: ['315fff44-2cd0-4aca-b701-fb6b6f7e3b0d', '947133c5-6a23-4f89-9811-73c297b55b43'],
    websiteFile: 'thunder-crunch.jpg',
  },

  // Sides
  {
    slug: 'fries',
    file: photo('Uber Eats Photos', 'Fries.jpg'),
    ids: ['75556c7d-140e-48ad-bbc5-dc3f02037538', 'c9efbb61-2f20-42e6-8e7f-a1d1add15345', 'd72c092e-ed02-49fe-8ea9-39ca18b78854'],
    websiteFile: 'fries.jpg',
  },
  {
    slug: 'poutine',
    file: photo('Uber Eats Photos', 'Poutine.jpg'),
    ids: ['d4835dbe-552b-414d-b7f7-e1314b9fb08e', '67015e2f-1cf1-4210-9103-7352f10a4f70', '5e4b8c6f-7c7e-4166-b346-73594a242270'],
    websiteFile: 'poutine.jpg',
  },
  {
    slug: 'onion-rings',
    file: photo('Uber Eats Photos', 'Onion rings.jpg'),
    ids: ['3bf8cd02-dec3-43ba-8413-027fe8584f2e', '6ea975ba-ae91-4415-8dd7-0de1b4ba1f65', 'a67ff363-9b4d-4068-b792-fb5dd7f2935c'],
    websiteFile: 'onion-rings.jpg',
  },

  // Pizza
  {
    slug: 'pizza-7',
    file: photo('Door Dash', 'Personal Pizza.jpg'),
    ids: ['0556ce17-d923-4212-b71a-9e596dfd53e2', '8b9b0f6c-48bc-4f82-bbdb-c8e6d202204e'],
    websiteFile: 'personal-pizza.jpg',
  },
  {
    slug: 'pizza-12',
    file: photo(
      'For all food apps & menu board',
      'off_the_wall_kids_smb_parent__london_ont__new_business__717_medium_cheese.jpg',
    ),
    ids: ['2f2d5b05-adba-4f44-96fd-420db2984222'],
    websiteFile: 'medium-pizza.jpg',
  },

  // Snacks
  {
    slug: 'fried-pickles',
    file: 'C:/Users/chris/OneDrive/Desktop/One Drive/OneDrive/! OTWK/A3 - Concession/Graphics/fried-pickles-7.jpg',
    ids: ['867ff13f-6152-4fcd-b6a6-594514dee2f5'],
    websiteFile: 'fried-pickles.jpg',
  },
  {
    slug: 'mozzarella-sticks',
    file: photo('Uber Eats Photos', 'mozzarella sticks.jpg'),
    ids: ['6a5b50f7-5955-40eb-82a2-44e627f5fa43'],
    websiteFile: 'mozzarella-sticks.jpg',
  },
  {
    slug: 'fiesta-poppers',
    file: photo('Uber Eats Photos', 'bold poppers.jpg'),
    ids: ['0b58c2b6-e641-4665-8f34-deb37c4ec803'],
    websiteFile: 'fiesta-poppers.jpg',
  },
  {
    slug: 'funnel-cake',
    file: photo('Uber Eats Photos', 'Funnel Cake Fries.jpg'),
    ids: ['6964ec24-4a07-4898-a0dd-b5d2bf4f5702', '2d3abac4-796d-4283-9acb-79065de73fbf', 'c73daaf3-9695-4127-85ab-357b145d816c'],
    websiteFile: 'funnel-cake-fries.jpg',
  },

  // Grab & go
  {
    slug: 'fruit-veg',
    file: photo('Door Dash', 'fruit_cup_off_the_wall_kids.jpg'),
    ids: ['3be4ed2a-6cc2-4945-a9fb-2e36a82f505d'],
    websiteFile: 'fruit-cup.png',
  },
  {
    slug: 'hummus',
    file: photo('Door Dash', 'hummus_and_crackers_off_the_wall_kids.jpg'),
    ids: ['32341c0e-e76b-4bb1-9f0e-a075316419f8'],
    websiteFile: 'hummus.png',
  },
  {
    slug: 'choc-bar',
    file: photo('Snacks', 'Aero chocolate bar.png'),
    ids: ['bf9a1ebf-82e3-42d3-9fc7-bcf5fa5a035c'],
    fit: 'contain',
  },
  {
    slug: 'bear-paw',
    file: photo('Snacks', 'bear paw.png'),
    ids: ['b50a14b6-2132-4278-8ab2-fb4cbca0fd12'],
    fit: 'contain',
  },
  {
    slug: 'hot-rod',
    file: photo('Snacks', 'hot rod.png'),
    ids: ['23471f37-b634-4dcb-861f-33db1d0e9703'],
    fit: 'contain',
  },
  {
    slug: 'cheese-string',
    file: photo('Snacks', 'cheese string.png'),
    ids: ['a25f9485-e096-4064-9714-7ccf656dc7d2'],
    fit: 'contain',
  },
  {
    slug: 'yogurt-tube',
    file: photo('Snacks', 'yogurt tube.png'),
    ids: ['3f007b99-c258-4806-a22d-ff4ecf1f8a71'],
    fit: 'contain',
  },
  {
    slug: 'chips',
    file: photo('Snacks', 'Lays chips.jpg'),
    ids: ['a8beb0c7-5dfd-4de3-90b7-e76f007192d5'],
    fit: 'contain',
  },

  // Drinks
  {
    slug: 'pepsi',
    file: photo('Uber Eats Photos', 'Pepsi.jpg'),
    ids: ['283280bf-fc6c-441f-90e8-40e48e6e9da7', '186eabf5-55d3-47d8-996c-b8a7f950a9c6', '7bd452d9-a62a-4265-ab34-1df3603fe9be'],
    websiteFile: 'pepsi.jpg',
  },
  {
    slug: 'slush-puppie',
    file: photo('Uber Eats Photos', 'Slush Puppy.jpg'),
    ids: ['86a98590-3fdd-455b-9d1c-a4893c445bbd', '3906d89a-be73-4dee-8a79-2844dde9ed82', '687c04a0-9d1d-4e5e-abe6-4dfcdabeac7c'],
    websiteFile: 'slush-puppie.jpg',
  },
  {
    slug: 'juice-box',
    file: photo('Snacks', 'minute maid apple juice box.png'),
    ids: ['1f9c2f95-e1e3-4d67-9659-ca7b81959845'],
    fit: 'contain',
  },
  {
    slug: 'bubly-water',
    file: photo('Uber Eats Photos', 'Bubly.jpg'),
    ids: ['e145a462-5757-4946-92f4-748f9b4af8ad', '88e618de-c262-4ab1-ad45-2e434d3885d7'],
  },
  {
    slug: 'coffee-tea-milk',
    file: photo('For all food apps & menu board', 'milk.jpg'),
    ids: ['15cbacf8-2ff9-4fa5-b400-db92ea90e90e', '91a6632a-f676-4334-920d-802f9a3a9bed', 'a4f9a613-75b5-4eba-b6f9-ce5f04e0dfaf'],
  },
  {
    slug: 'gatorade',
    file: photo('Uber Eats Photos', 'gatorade.jpg'),
    ids: ['32f22b7c-8e69-407a-8839-bd440af60417'],
    manualMenuName: 'Gatorade',
    websiteFile: 'gatorade.jpg',
  },
  {
    slug: 'aloe-coconut',
    file: photo('Door Dash', 'choclate_aloe_off_the_wall_kids.jpg'),
    ids: ['0964dc50-51d1-4c0d-a0f2-1920ba17f86b', '4706d933-be72-428c-96fc-baad200ff76f'],
  },
  {
    slug: 'asst-drinks',
    file: photo('For all food apps & menu board', 'Monster energy drink.jpg'),
    manualMenuName: 'Assorted Drinks',
  },
];

async function main() {
  const previewDir = path.join(__dirname, 'food-app-photos-preview');
  fs.mkdirSync(previewDir, { recursive: true });
  fs.mkdirSync(OTWK_MENU_ITEMS_DIR, { recursive: true });

  let ok = 0;
  let fail = 0;
  const skipped = [];

  for (const item of ASSIGNMENTS) {
    try {
      if (!fs.existsSync(item.file)) {
        throw new Error(`Missing source file: ${item.file}`);
      }

      const jpeg = await prepareJpeg(item.file, { fit: item.fit || 'cover' });
      fs.writeFileSync(path.join(previewDir, `${item.slug}.jpg`), jpeg);

      const url = await uploadImage(jpeg, item.slug);
      await setInventoryImage(item.ids || [], url);
      if (item.manualMenuName) await updateManualMenuImage(item.manualMenuName, url);

      if (item.websiteFile) {
        const dest = path.join(OTWK_MENU_ITEMS_DIR, item.websiteFile);
        if (item.websiteFile.endsWith('.png')) {
          const png = await sharp(jpeg).png().toBuffer();
          fs.writeFileSync(dest, png);
        } else {
          fs.writeFileSync(dest, jpeg);
        }
      }

      const count = (item.ids?.length || 0) + (item.manualMenuName ? 1 : 0);
      console.log(`✓ ${item.slug} <- ${path.basename(item.file)} (${count} target(s))`);
      ok += 1;
    } catch (err) {
      console.error(`✗ ${item.slug}:`, err.message || err);
      fail += 1;
    }
  }

  console.log(`\nDone. ${ok} assigned, ${fail} failed.`);
  console.log(`Previews: ${previewDir}`);
  console.log(`OTWK static copies: ${OTWK_MENU_ITEMS_DIR}`);
  if (skipped.length) console.log('Skipped (no photo found):', skipped.join(', '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
