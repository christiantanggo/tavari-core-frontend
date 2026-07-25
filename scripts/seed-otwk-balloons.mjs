/**
 * Seed OTWK London balloon inventory, modifiers, and bouquet bundles.
 * Run: node scripts/seed-otwk-balloons.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const ids = {};
const groups = {};

const LATEX_VARIANTS = [
  ['latexSmileFace', 'Smile Face', 'AQF58479'],
  ['latexHotPink', 'Hot Pink', 'AQF71392'],
  ['latexOceanBlue', 'Ocean Blue', 'AQF70988'],
  ['latexGreen', 'Green', 'AQF71047'],
  ['latexPurple', 'Purple', 'AQF71087'],
  ['latexRed', 'Red', 'AQF70921'],
  ['latexWhite', 'White', 'AQF71055'],
  ['latexYellow', 'Yellow', 'AQF70896'],
  ['latexOrange', 'Orange', 'AQF70906'],
];

const FOIL_VARIANTS = [
  ['foilBirthdaySmiles', 'Birthday Smiles', 'f13551'],
  ['foilBirthdayBalloons', 'Birthday Balloons', 'F13552'],
  ['foilBirthdayStreamers', 'Birthday Streamers', 'F13557'],
  ['foilBirthdayCupcake', 'Birthday Cupcake', 'F3269202'],
  ['foilRainbowBirthday', 'Rainbow Birthday', 'F35228'],
  ['foilHbdDots', 'HBD Dots of Colour', 'F41296'],
  ['foilPink', 'Pink', 'F18RBGPBGP'],
  ['foilBlue', 'Blue', 'F18rbubu'],
  ['foilGreen', 'Green', 'F18rgngn'],
  ['foilOrange', 'Orange', 'F04561'],
  ['foilPurple', 'Purple', 'F18Rplpl'],
  ['foilRed', 'Red', 'F18rdrd'],
  ['foilWhite', 'White', 'F18wtwt'],
  ['foilYellow', 'Yellow', 'F18rywyw'],
  ['foilRainbow', 'Rainbow', 'F39259'],
];

const NUMBER_VARIANTS = Array.from({ length: 10 }, (_, n) => [
  `number${n}`,
  String(n),
  `NUM-${n}`,
]);

const BOUQUETS = [
  { key: 'air7Latex', name: 'Air Filled - 7 Latex', price: 8.85, latex: 7, foil: 0, helium: 0 },
  { key: 'air1F6L', name: 'Air Filled - 1 Foil, 6 Latex', price: 14.16, latex: 6, foil: 1, helium: 0 },
  { key: 'air3F4L', name: 'Air Filled - 3 Foil, 4 Latex', price: 23.01, latex: 4, foil: 3, helium: 0 },
  { key: 'air7Foil', name: 'Air Filled - 7 Foil', price: 41.59, latex: 0, foil: 7, helium: 0 },
  { key: 'hel5L', name: 'Helium - 5 Latex', price: 16.81, latex: 5, foil: 0, helium: 5 },
  { key: 'hel7L', name: 'Helium - 7 Latex', price: 23.01, latex: 7, foil: 0, helium: 7 },
  { key: 'hel1F4L', name: 'Helium - 1 Foil, 4 Latex', price: 20.35, latex: 4, foil: 1, helium: 5 },
  { key: 'hel1F6L', name: 'Helium - 1 Foil, 6 Latex', price: 26.55, latex: 6, foil: 1, helium: 7 },
  { key: 'hel2F3L', name: 'Helium - 2 Foil, 3 Latex', price: 24.78, latex: 3, foil: 2, helium: 5 },
  { key: 'hel3F4L', name: 'Helium - 3 Foil, 4 Latex', price: 34.51, latex: 4, foil: 3, helium: 7 },
  { key: 'hel5Foil', name: 'Helium - 5 Foil', price: 36.28, latex: 0, foil: 5, helium: 5 },
  { key: 'hel7Foil', name: 'Helium - 7 Foil', price: 49.56, latex: 0, foil: 7, helium: 7 },
];

async function getOrCreateCategory(name, emoji, sortOrder) {
  const { data: existing } = await supabase
    .from('pos_categories')
    .select('id, name')
    .eq('business_id', BIZ)
    .ilike('name', name)
    .maybeSingle();

  if (existing) {
    console.log(`  category exists: ${name}`);
    return existing.id;
  }

  const { data, error } = await supabase
    .from('pos_categories')
    .insert({
      business_id: BIZ,
      name,
      emoji,
      sort_order: sortOrder,
      category_type: 'both',
    })
    .select('id')
    .single();

  if (error) throw error;
  console.log(`  created category: ${name}`);
  return data.id;
}

async function createItem({
  key,
  name,
  price,
  categoryId = null,
  sku = null,
  isModifier = false,
  displayOnPos = true,
  modifierGroupIds = null,
  isBundle = false,
  bundleUseAutoPrice = false,
  bundleDescription = null,
}) {
  const { data: dup } = await supabase
    .from('pos_inventory')
    .select('id, modifier_group_ids, is_bundle')
    .eq('business_id', BIZ)
    .eq('name', name)
    .maybeSingle();

  if (dup) {
    ids[key] = dup.id;
    const updates = {};
    if (modifierGroupIds?.length) updates.modifier_group_ids = modifierGroupIds;
    if (categoryId) updates.category_id = categoryId;
    if (sku) updates.sku = sku;
    if (displayOnPos === false) updates.display_on_pos = false;
    if (Object.keys(updates).length) {
      await supabase.from('pos_inventory').update(updates).eq('id', dup.id);
    }
    console.log(`  skip existing item: ${name}`);
    return dup.id;
  }

  const row = {
    business_id: BIZ,
    name,
    price,
    category_id: categoryId,
    sku,
    is_modifier_item: isModifier,
    display_on_pos: displayOnPos,
    track_stock: false,
    is_active: true,
    is_bundle: isBundle,
    bundle_use_auto_price: isBundle ? bundleUseAutoPrice : true,
    bundle_description: bundleDescription,
    modifier_group_ids: modifierGroupIds?.length ? modifierGroupIds : null,
  };

  const { data, error } = await supabase.from('pos_inventory').insert(row).select('id').single();
  if (error) throw error;
  ids[key] = data.id;
  console.log(`  item: ${name} ($${Number(price).toFixed(2)})`);
  return data.id;
}

async function createGroup({
  key,
  name,
  required = false,
  minSelections = null,
  maxSelections = null,
  sortOrder = 0,
}) {
  const { data: dup } = await supabase
    .from('pos_modifier_groups')
    .select('id')
    .eq('business_id', BIZ)
    .eq('name', name)
    .maybeSingle();

  if (dup) {
    groups[key] = dup.id;
    console.log(`  skip existing group: ${name}`);
    return dup.id;
  }

  const { data, error } = await supabase
    .from('pos_modifier_groups')
    .insert({
      business_id: BIZ,
      name,
      is_required: required,
      min_selections: minSelections,
      max_selections: maxSelections,
      sort_order: sortOrder,
      is_active: true,
      group_type: 'modifier',
    })
    .select('id')
    .single();

  if (error) throw error;
  groups[key] = data.id;
  console.log(`  group: ${name}`);
  return data.id;
}

async function addGroupItem(groupKey, inventoryKey, {
  priceOverride = null,
  isFree = false,
  isDefault = false,
  sortOrder = 0,
}) {
  const groupId = groups[groupKey];
  const inventoryId = ids[inventoryKey];
  if (!groupId || !inventoryId) {
    throw new Error(`Missing group/item for ${groupKey} -> ${inventoryKey}`);
  }

  const { data: dup } = await supabase
    .from('pos_modifier_group_items')
    .select('id')
    .eq('modifier_group_id', groupId)
    .eq('inventory_id', inventoryId)
    .maybeSingle();

  if (dup) return dup.id;

  const { error } = await supabase.from('pos_modifier_group_items').insert({
    modifier_group_id: groupId,
    inventory_id: inventoryId,
    price_override: priceOverride,
    is_free: isFree,
    is_default_selected: isDefault,
    sort_order: sortOrder,
    is_active: true,
  });

  if (error) throw error;
  return true;
}

async function linkParentGroups(itemKey, groupKeys) {
  const groupIds = groupKeys.map((gk) => groups[gk]).filter(Boolean);
  if (!ids[itemKey] || !groupIds.length) return;
  await supabase
    .from('pos_inventory')
    .update({ modifier_group_ids: groupIds })
    .eq('id', ids[itemKey]);
  console.log(`  linked ${itemKey} -> ${groupKeys.join(', ')}`);
}

async function createBundle({ key, name, price, categoryId, latex = 0, foil = 0, helium = 0 }) {
  const { data: dup } = await supabase
    .from('pos_inventory')
    .select('id')
    .eq('business_id', BIZ)
    .eq('name', name)
    .maybeSingle();

  let bundleId = dup?.id;
  if (!bundleId) {
    bundleId = await createItem({
      key,
      name,
      price,
      categoryId,
      isBundle: true,
      bundleUseAutoPrice: false,
      bundleDescription: 'Balloon bouquet package',
    });
  } else {
    ids[key] = bundleId;
    await supabase
      .from('pos_inventory')
      .update({
        price,
        category_id: categoryId,
        is_bundle: true,
        bundle_use_auto_price: false,
        display_on_pos: true,
        is_active: true,
      })
      .eq('id', bundleId);
    console.log(`  skip existing bundle: ${name}`);
  }

  await supabase.from('pos_inventory_bundle_items').delete().eq('bundle_inventory_id', bundleId);

  const components = [];
  if (latex > 0) components.push({ inventoryKey: 'latexBalloon', quantity: latex });
  if (foil > 0) components.push({ inventoryKey: 'foilBalloon', quantity: foil });
  if (helium > 0) components.push({ inventoryKey: 'helium', quantity: helium });

  for (const [index, spec] of components.entries()) {
    const componentId = ids[spec.inventoryKey];
    if (!componentId) {
      console.warn(`    missing component ${spec.inventoryKey} for ${name}`);
      continue;
    }
    const { error } = await supabase.from('pos_inventory_bundle_items').insert({
      business_id: BIZ,
      bundle_inventory_id: bundleId,
      component_inventory_id: componentId,
      quantity: spec.quantity,
      sort_order: index,
    });
    if (error) throw error;
  }

  console.log(`    bundle linked: ${name} (${latex} latex, ${foil} foil, ${helium} helium)`);
  return bundleId;
}

async function main() {
  console.log('=== OTWK London balloons seed ===\n');

  console.log('Category...');
  const balloonsCat = await getOrCreateCategory('Balloons', '🎈', 9);

  console.log('\nModifier variant items...');
  for (const [key, label, sku] of LATEX_VARIANTS) {
    await createItem({
      key,
      name: `${label} - Latex`,
      price: 0,
      sku,
      isModifier: true,
      displayOnPos: false,
    });
  }

  for (const [key, label, sku] of FOIL_VARIANTS) {
    await createItem({
      key,
      name: `${label} - Foil`,
      price: 0,
      sku,
      isModifier: true,
      displayOnPos: false,
    });
  }

  for (const [key, label, sku] of NUMBER_VARIANTS) {
    await createItem({
      key,
      name: `Number ${label}`,
      price: 0,
      sku,
      isModifier: true,
      displayOnPos: false,
    });
  }

  console.log('\nModifier groups...');
  await createGroup({
    key: 'latexStyle',
    name: 'Latex Style',
    required: true,
    minSelections: 1,
    maxSelections: 1,
    sortOrder: 1,
  });
  await createGroup({
    key: 'foilStyle',
    name: 'Foil Style',
    required: true,
    minSelections: 1,
    maxSelections: 1,
    sortOrder: 1,
  });
  await createGroup({
    key: 'numberDigit',
    name: 'Number',
    required: true,
    minSelections: 1,
    maxSelections: 1,
    sortOrder: 1,
  });

  console.log('\nGroup items...');
  let sort = 0;
  for (const [key] of LATEX_VARIANTS) {
    await addGroupItem('latexStyle', key, { isFree: true, sortOrder: sort, isDefault: sort === 0 });
    sort += 1;
  }
  sort = 0;
  for (const [key] of FOIL_VARIANTS) {
    await addGroupItem('foilStyle', key, { isFree: true, sortOrder: sort, isDefault: sort === 0 });
    sort += 1;
  }
  sort = 0;
  for (const [key] of NUMBER_VARIANTS) {
    await addGroupItem('numberDigit', key, { isFree: true, sortOrder: sort, isDefault: sort === 0 });
    sort += 1;
  }

  console.log('\nSellable inventory...');
  await createItem({
    key: 'latexBalloon',
    name: 'Latex Balloon',
    price: 1.0,
    categoryId: balloonsCat,
    sku: 'LATEX-12',
    modifierGroupIds: [groups.latexStyle],
    displayOnPos: false,
  });
  await createItem({
    key: 'foilBalloon',
    name: 'Foil Balloon',
    price: 5.39,
    categoryId: balloonsCat,
    sku: 'FOIL-18',
    modifierGroupIds: [groups.foilStyle],
    displayOnPos: false,
  });
  await createItem({
    key: 'numberBalloon',
    name: 'Number Balloon (w/ Helium)',
    price: 15.04,
    categoryId: balloonsCat,
    sku: 'NUM-HELIUM',
    modifierGroupIds: [groups.numberDigit],
    displayOnPos: false,
  });
  await createItem({
    key: 'silverWeight',
    name: 'Silver Weight',
    price: 1.88,
    categoryId: balloonsCat,
    sku: 'A112725-18',
    displayOnPos: false,
  });
  await createItem({
    key: 'helium',
    name: 'Helium',
    price: 2.75,
    categoryId: balloonsCat,
    sku: 'HELIUM',
    displayOnPos: false,
  });
  await createItem({
    key: 'tableTopStand',
    name: 'Table Top Stand',
    price: 6.25,
    categoryId: balloonsCat,
    sku: 'TABLE-STAND',
    displayOnPos: false,
  });

  await linkParentGroups('latexBalloon', ['latexStyle']);
  await linkParentGroups('foilBalloon', ['foilStyle']);
  await linkParentGroups('numberBalloon', ['numberDigit']);

  console.log('\nBouquet bundles...');
  for (const bouquet of BOUQUETS) {
    await createBundle({
      ...bouquet,
      categoryId: balloonsCat,
    });
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
