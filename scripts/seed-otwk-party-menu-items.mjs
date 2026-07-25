/**
 * Seed Off The Wall Kids London party menu items from the party flyer PDF.
 * Adds only items that are not already in pos_inventory (matched by exact name).
 *
 * Run: node scripts/seed-otwk-party-menu-items.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function getCategoryId(name) {
  const { data, error } = await supabase
    .from('pos_categories')
    .select('id, name')
    .eq('business_id', BIZ)
    .ilike('name', name)
    .limit(1);
  if (error) throw error;
  return data?.[0]?.id ?? null;
}

async function findItemByName(name) {
  const { data } = await supabase
    .from('pos_inventory')
    .select('id, name, price, is_active, is_bundle')
    .eq('business_id', BIZ)
    .eq('name', name)
    .maybeSingle();
  return data;
}

async function createSellableItem({ name, price, categoryId, description = null, isBundle = false }) {
  const existing = await findItemByName(name);
  if (existing) {
    console.log(`  skip (exists): ${name}`);
    return existing.id;
  }

  const row = {
    business_id: BIZ,
    name,
    price,
    category_id: categoryId,
    is_active: true,
    display_on_pos: true,
    track_stock: false,
    is_bundle: isBundle,
    bundle_use_auto_price: isBundle ? false : true,
    bundle_description: description,
  };

  const { data, error } = await supabase
    .from('pos_inventory')
    .insert(row)
    .select('id')
    .single();

  if (error) throw error;
  console.log(`  created: ${name} ($${Number(price).toFixed(2)})`);
  return data.id;
}

async function createPizzaBundle({ name, price, categoryId, description, componentSpecs }) {
  const existing = await findItemByName(name);
  if (existing) {
    console.log(`  skip (exists): ${name}`);
    return existing.id;
  }

  const bundleId = await createSellableItem({
    name,
    price,
    categoryId,
    description,
    isBundle: true,
  });

  for (const [index, spec] of componentSpecs.entries()) {
    const component = await findItemByName(spec.name);
    if (!component) {
      console.warn(`    warning: component not found for ${name}: ${spec.name}`);
      continue;
    }
    const { error } = await supabase.from('pos_inventory_bundle_items').insert({
      business_id: BIZ,
      bundle_inventory_id: bundleId,
      component_inventory_id: component.id,
      quantity: spec.quantity ?? 1,
      sort_order: index,
    });
    if (error) throw error;
  }

  console.log(`    bundle components linked for ${name}`);
  return bundleId;
}

async function main() {
  console.log('=== OTWK London party menu seed ===\n');

  const partyCat =
    (await getCategoryId('Parties')) ||
    (await getCategoryId('Birthday Party')) ||
    (await getCategoryId('Party'));
  const pubGrubCat = await getCategoryId('Pub Grub');
  const drinksCat = await getCategoryId('Drinks');
  const healthyCat = await getCategoryId('Healthy');

  console.log(`Categories: party=${partyCat ?? 'none'}, pubGrub=${pubGrubCat ?? 'none'}, drinks=${drinksCat ?? 'none'}\n`);

  // --- Party packages (flyer) ---
  console.log('Party packages...');
  await createSellableItem({
    name: '36 & 36 Party',
    price: 849.99,
    categoryId: partyCat,
    description: 'Up to 36 kids & 36 free adults, three party rooms, $150 food credit',
  });
  await createSellableItem({
    name: 'Private Facility Booking',
    price: 1034.99,
    categoryId: partyCat,
    description: 'Limit 150 people total, $150 food credit',
  });

  // --- Preset 12" pizzas (bundles like Canadian / Pepperoni) ---
  console.log('\nPreset pizzas...');
  await createPizzaBundle({
    name: 'Vegetarian Pizza',
    price: 19.25,
    categoryId: partyCat ?? pubGrubCat,
    description: '12" pizza — mushroom, green pepper, onion, tomato, olives',
    componentSpecs: [
      { name: '12" Medium Cheese', quantity: 1 },
      { name: 'Mushroom (12" Full)', quantity: 1 },
      { name: 'Green Pepper (12" Full)', quantity: 1 },
      { name: 'Onion (12" Full)', quantity: 1 },
      { name: 'Tomato (12" Full)', quantity: 1 },
      { name: 'Olives (12" Full)', quantity: 1 },
    ],
  });
  await createPizzaBundle({
    name: '3-Meat Pizza',
    price: 19.25,
    categoryId: partyCat ?? pubGrubCat,
    description: '12" pizza — pepperoni, sausage, bacon crumble',
    componentSpecs: [
      { name: '12" Medium Cheese', quantity: 1 },
      { name: 'Pepperoni (12" Full)', quantity: 1 },
      { name: 'Sausage (12" Full)', quantity: 1 },
      { name: 'Bacon Crumble (12" Full)', quantity: 1 },
    ],
  });
  await createPizzaBundle({
    name: 'Deluxe Pizza',
    price: 19.25,
    categoryId: partyCat ?? pubGrubCat,
    description: '12" pizza — pepperoni, sausage, mushroom, green pepper, onion',
    componentSpecs: [
      { name: '12" Medium Cheese', quantity: 1 },
      { name: 'Pepperoni (12" Full)', quantity: 1 },
      { name: 'Sausage (12" Full)', quantity: 1 },
      { name: 'Mushroom (12" Full)', quantity: 1 },
      { name: 'Green Pepper (12" Full)', quantity: 1 },
      { name: 'Onion (12" Full)', quantity: 1 },
    ],
  });

  // --- Platters (designed to feed 12 kids) ---
  console.log('\nPlatters & bowls...');
  const platters = [
    ['Breakfast Platter', 53.1, 'Designed to feed 12 kids'],
    ['12 Hot Dogs & Fries', 53.98, 'Designed to feed 12 kids'],
    ['24 Chicken Strips & Fries', 59.29, 'Designed to feed 12 kids'],
    ['36 Nuggets & Fries', 43.36, 'Designed to feed 12 kids'],
    ['Veggie Tray', 49.56, 'Designed to feed 12 kids'],
    ['Fruit Tray', 49.56, 'Designed to feed 12 kids'],
    ['Gold Fish Bowl', 13.27, null],
    ['Chip Bowl', 9.73, null],
    ['French Fry Bowl', 9.96, null],
  ];
  for (const [name, price, desc] of platters) {
    await createSellableItem({
      name,
      price,
      categoryId: partyCat ?? pubGrubCat ?? healthyCat,
      description: desc,
    });
  }

  // --- Drinks ---
  console.log('\nDrinks...');
  await createSellableItem({
    name: 'Pepsi Pitcher',
    price: 8.85,
    categoryId: drinksCat,
  });
  await createSellableItem({
    name: 'Coffee Pot',
    price: 2.25,
    categoryId: drinksCat,
    description: 'Per cup — minimum order of 6 cups',
  });

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
