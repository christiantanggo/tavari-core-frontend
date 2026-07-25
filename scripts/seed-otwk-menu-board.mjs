/**
 * Seed Off The Wall Kids London menu board items, categories, and modifier groups.
 * Run: node scripts/seed-otwk-menu-board.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const SMALL_FRY = 3.76;
const COMBO_DRINK_THRESHOLD = 3.0;

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const ids = {};
const groups = {};

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
  categoryId,
  isModifier = false,
  displayOnPos = true,
  modifierGroupIds = null,
}) {
  const { data: dup } = await supabase
    .from('pos_inventory')
    .select('id')
    .eq('business_id', BIZ)
    .eq('name', name)
    .maybeSingle();

  if (dup) {
    ids[key] = dup.id;
    if (modifierGroupIds?.length) {
      await supabase
        .from('pos_inventory')
        .update({ modifier_group_ids: modifierGroupIds })
        .eq('id', dup.id);
    }
    console.log(`  skip existing item: ${name}`);
    return dup.id;
  }

  const { data, error } = await supabase
    .from('pos_inventory')
    .insert({
      business_id: BIZ,
      name,
      price,
      category_id: categoryId,
      is_modifier_item: isModifier,
      display_on_pos: displayOnPos,
      track_stock: false,
      modifier_group_ids: modifierGroupIds?.length ? modifierGroupIds : null,
    })
    .select('id')
    .single();

  if (error) throw error;
  ids[key] = data.id;
  console.log(`  item: ${name} ($${price.toFixed(2)})`);
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

  const { data, error } = await supabase
    .from('pos_modifier_group_items')
    .insert({
      modifier_group_id: groupId,
      inventory_id: inventoryId,
      price_override: priceOverride,
      is_free: isFree,
      is_default_selected: isDefault,
      sort_order: sortOrder,
      is_active: true,
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

function comboDrinkUpgrade(fullPrice) {
  if (fullPrice <= COMBO_DRINK_THRESHOLD) return { priceOverride: 0, isFree: true };
  return { priceOverride: round(fullPrice - COMBO_DRINK_THRESHOLD), isFree: false };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

const TOPPINGS_7 = [
  ['Pepperoni', 0.88],
  ['Sausage', 0.44],
  ['Bacon Crumble', 0.44],
  ['Olives', 0.44],
  ['Pineapple', 0.44],
  ['Green Pepper', 0.44],
  ['Tomato', 0.44],
  ['Mushroom', 0.44],
  ['Onion', 0.44],
  ['Sun Dried Tomato', 0.44],
];

const TOPPINGS_12 = [
  ['Pepperoni', 1.77],
  ['Sausage', 0.88],
  ['Bacon Crumble', 0.88],
  ['Olives', 0.88],
  ['Pineapple', 0.88],
  ['Green Pepper', 0.88],
  ['Tomato', 0.88],
  ['Mushroom', 0.88],
  ['Onion', 0.88],
  ['Sun Dried Tomato', 0.88],
];

async function main() {
  console.log('=== OTWK London menu board seed ===\n');

  console.log('Categories...');
  const cat = {
    drinks: await getOrCreateCategory('Drinks', '🥤', 3),
    snacks: await getOrCreateCategory('Snacks', '🍿', 4),
    desserts: await getOrCreateCategory('Desserts', '🍰', 5),
    healthy: await getOrCreateCategory('Healthy', '🥗', 6),
    pubGrub: await getOrCreateCategory('Pub Grub', '🍟', 7),
    combo: await getOrCreateCategory('Combo', '🍱', 8),
  };

  console.log('\nInventory items...');

  // --- HEALTHY ---
  await createItem({ key: 'fruitVeg', name: 'Fruit / Veg', price: 4.42, categoryId: cat.healthy });
  await createItem({ key: 'hummus', name: 'Hummus & Crackers', price: 5.09, categoryId: cat.healthy });
  await createItem({ key: 'cheese', name: 'Cheese', price: 1.33, categoryId: cat.healthy });
  await createItem({ key: 'yogurt', name: 'Yogurt', price: 1.33, categoryId: cat.healthy });

  // --- SNACKS ---
  await createItem({ key: 'chocBar', name: 'Choc Bar', price: 2.65, categoryId: cat.snacks });
  await createItem({ key: 'bearPaw', name: 'Bear Paw', price: 1.33, categoryId: cat.snacks });
  await createItem({ key: 'hotRod', name: 'Hot Rod', price: 1.33, categoryId: cat.snacks });
  await createItem({ key: 'chips', name: 'Chips', price: 1.99, categoryId: cat.snacks });

  // --- DRINKS (fixed) ---
  await createItem({ key: 'hotChocolate', name: 'Carnation Hot Chocolate', price: 2.65, categoryId: cat.drinks });
  await createItem({ key: 'juiceBox', name: 'Juice Box', price: 1.33, categoryId: cat.drinks });
  await createItem({ key: 'water', name: 'Water', price: 1.77, categoryId: cat.drinks });
  await createItem({ key: 'coffee', name: 'Coffee', price: 2.88, categoryId: cat.drinks });
  await createItem({ key: 'tea', name: 'Tea', price: 2.88, categoryId: cat.drinks });
  await createItem({ key: 'milk', name: 'Milk', price: 2.88, categoryId: cat.drinks });
  await createItem({ key: 'gatorade', name: 'Gatorade', price: 3.10, categoryId: cat.drinks });
  await createItem({ key: 'aloe', name: 'Aloe', price: 3.98, categoryId: cat.drinks });
  await createItem({ key: 'coconut', name: 'Coconut', price: 3.98, categoryId: cat.drinks });

  // Sized drink parents (price 0, size modifiers)
  await createItem({ key: 'pepsi', name: 'Pepsi', price: 0, categoryId: cat.drinks });
  await createItem({ key: 'slushPuppie', name: 'Slush Puppie', price: 0, categoryId: cat.drinks });
  await createItem({ key: 'bubly', name: 'Bubly', price: 0, categoryId: cat.drinks });

  // Size modifier-only items
  await createItem({ key: 'pepsiSmall', name: 'Pepsi - Small', price: 2.21, isModifier: true });
  await createItem({ key: 'pepsiMed', name: 'Pepsi - Medium', price: 3.10, isModifier: true });
  await createItem({ key: 'pepsiLarge', name: 'Pepsi - Large', price: 3.98, isModifier: true });
  await createItem({ key: 'slushSmall', name: 'Slush Puppie - Small', price: 3.54, isModifier: true });
  await createItem({ key: 'slushMed', name: 'Slush Puppie - Medium', price: 4.42, isModifier: true });
  await createItem({ key: 'slushLarge', name: 'Slush Puppie - Large', price: 5.97, isModifier: true });

  // Bubly flavors
  for (const flavor of ['Lime', 'Peach', 'Blackberry', 'Pineapple', 'Mango']) {
    const key = `bubly${flavor.replace(/\s/g, '')}`;
    await createItem({ key, name: `Bubly - ${flavor}`, price: 1.77, isModifier: true });
  }

  // --- PUB GRUB ---
  await createItem({ key: 'fries', name: 'Fries', price: 0, categoryId: cat.pubGrub });
  await createItem({ key: 'poutine', name: 'Poutine', price: 0, categoryId: cat.pubGrub });
  await createItem({ key: 'onionRings', name: 'Onion Rings', price: 0, categoryId: cat.pubGrub });
  await createItem({ key: 'friedPickles', name: 'Deep Fried Pickles', price: 8.63, categoryId: cat.pubGrub });
  await createItem({ key: 'mozzarellaSticks', name: '5 Mozzarella Sticks', price: 6.19, categoryId: cat.pubGrub });
  await createItem({ key: 'fiestaPoppers', name: '4pc Fiesta Poppers', price: 9.51, categoryId: cat.pubGrub });
  await createItem({ key: 'hotDog', name: 'Hot Dog', price: 4.65, categoryId: cat.pubGrub });
  await createItem({ key: 'thunderCrunch', name: 'Thunder Crunch Sandwich', price: 10.62, categoryId: cat.pubGrub });
  await createItem({ key: 'chickenStrip', name: 'Chicken Strip', price: 1.0, categoryId: cat.pubGrub });
  await createItem({ key: 'chickenNugget', name: 'Chicken Nugget', price: 1.0, categoryId: cat.pubGrub });

  // Side size modifiers
  const sideSizes = [
    ['friesSmall', 'Fries - Small', 3.76],
    ['friesMed', 'Fries - Medium', 5.31],
    ['friesLarge', 'Fries - Large', 6.64],
    ['poutineSmall', 'Poutine - Small', 6.86],
    ['poutineMed', 'Poutine - Medium', 8.63],
    ['poutineLarge', 'Poutine - Large', 10.40],
    ['ringsSmall', 'Onion Rings - Small', 4.65],
    ['ringsMed', 'Onion Rings - Medium', 6.86],
    ['ringsLarge', 'Onion Rings - Large', 9.07],
  ];
  for (const [key, name, price] of sideSizes) {
    await createItem({ key, name, price, isModifier: true });
  }

  await createItem({ key: 'poutineShredded', name: 'Poutine - Shredded Cheese', price: 0, isModifier: true });
  await createItem({ key: 'poutineCurds', name: 'Poutine - Cheese Curds', price: 0, isModifier: true });
  await createItem({ key: 'poutineBoth', name: 'Poutine - Both Cheeses', price: 0.44, isModifier: true });

  // --- DESSERTS ---
  await createItem({ key: 'funnelCake', name: 'Funnel Cake Fries', price: 0, categoryId: cat.desserts });
  await createItem({ key: 'funnelSmall', name: 'Funnel Cake Fries - Small', price: 7.30, isModifier: true });
  await createItem({ key: 'funnelMed', name: 'Funnel Cake Fries - Medium', price: 10.84, isModifier: true });
  await createItem({ key: 'funnelLarge', name: 'Funnel Cake Fries - Large', price: 14.38, isModifier: true });
  await createItem({ key: 'dessertBar', name: 'Dessert Bar & Ice Cream', price: 7.08, categoryId: cat.desserts });
  for (const bar of ['Nanaimo Bar', 'Butter Tart', 'Carrot Cake', 'Brownie']) {
    const key = `bar${bar.replace(/\s/g, '')}`;
    await createItem({ key, name: bar, price: 0, isModifier: true });
  }

  // --- PIZZA ---
  await createItem({ key: 'pizza', name: 'Cheese Pizza', price: 0, categoryId: cat.pubGrub });
  await createItem({ key: 'pizza7', name: '7" Personal Cheese', price: 9.51, isModifier: true });
  await createItem({ key: 'pizza12', name: '12" Medium Cheese', price: 15.71, isModifier: true });
  await createItem({ key: 'pizzaFull', name: 'Full Pizza', price: 0, isModifier: true });
  await createItem({ key: 'pizzaLeft', name: 'Left Side', price: 0, isModifier: true });
  await createItem({ key: 'pizzaRight', name: 'Right Side', price: 0, isModifier: true });

  for (const [name, price7] of TOPPINGS_7) {
    await createItem({ key: `t7_${name.replace(/\s/g, '')}`, name: `${name} (7")`, price: price7, isModifier: true });
  }
  for (const [name, price12] of TOPPINGS_12) {
    const half = round(price12 / 2);
    await createItem({ key: `t12_${name.replace(/\s/g, '')}`, name: `${name} (12" Full)`, price: price12, isModifier: true });
    await createItem({ key: `t12L_${name.replace(/\s/g, '')}`, name: `${name} (12" Left)`, price: half, isModifier: true });
    await createItem({ key: `t12R_${name.replace(/\s/g, '')}`, name: `${name} (12" Right)`, price: half, isModifier: true });
  }

  // --- COMBOS ---
  const comboItems = [
    ['comboNugget4', 'Chicken Nuggets 4pc Meal', 9.07],
    ['comboNugget8', 'Chicken Nuggets 8pc Meal', 12.83],
    ['comboStrip2', 'Chicken Strips 2pc Meal', 10.40],
    ['comboStrip4', 'Chicken Strips 4pc Meal', 14.38],
    ['comboHotDog', 'Hot Dog Meal', 10.18],
    ['comboThunder', 'Thunder Crunch Meal', 15.27],
    ['comboPizza7', '7" Personal Pizza Combo', 16.15],
  ];
  for (const [key, name, price] of comboItems) {
    await createItem({ key, name, price, categoryId: cat.combo });
  }

  // Combo side modifier items (upgrade from included small fry)
  await createItem({ key: 'comboFrySmall', name: 'Combo - Small Fry (Included)', price: 0, isModifier: true });
  await createItem({ key: 'comboFryMed', name: 'Combo - Medium Fry Upgrade', price: round(5.31 - SMALL_FRY), isModifier: true });
  await createItem({ key: 'comboFryLarge', name: 'Combo - Large Fry Upgrade', price: round(6.64 - SMALL_FRY), isModifier: true });
  await createItem({ key: 'comboPoutineSmall', name: 'Combo - Small Poutine Swap', price: round(6.86 - SMALL_FRY), isModifier: true });
  await createItem({ key: 'comboPoutineMed', name: 'Combo - Medium Poutine Swap', price: round(8.63 - SMALL_FRY), isModifier: true });
  await createItem({ key: 'comboPoutineLarge', name: 'Combo - Large Poutine Swap', price: round(10.40 - SMALL_FRY), isModifier: true });

  console.log('\nModifier groups...');

  await createGroup({ key: 'pepsiSize', name: 'Pepsi Size', required: true, minSelections: 1, maxSelections: 1, sortOrder: 1 });
  await createGroup({ key: 'slushSize', name: 'Slush Puppie Size', required: true, minSelections: 1, maxSelections: 1, sortOrder: 1 });
  await createGroup({ key: 'bublyFlavor', name: 'Bubly Flavor', required: true, minSelections: 1, maxSelections: 1, sortOrder: 1 });
  await createGroup({ key: 'friesSize', name: 'Fries Size', required: true, minSelections: 1, maxSelections: 1, sortOrder: 1 });
  await createGroup({ key: 'poutineSize', name: 'Poutine Size', required: true, minSelections: 1, maxSelections: 1, sortOrder: 1 });
  await createGroup({ key: 'poutineCheese', name: 'Poutine Cheese', required: true, minSelections: 1, maxSelections: 1, sortOrder: 2 });
  await createGroup({ key: 'ringsSize', name: 'Onion Rings Size', required: true, minSelections: 1, maxSelections: 1, sortOrder: 1 });
  await createGroup({ key: 'funnelSize', name: 'Funnel Cake Fries Size', required: true, minSelections: 1, maxSelections: 1, sortOrder: 1 });
  await createGroup({ key: 'dessertChoice', name: 'Dessert Bar Choice', required: true, minSelections: 1, maxSelections: 1, sortOrder: 1 });
  await createGroup({ key: 'pizzaSize', name: 'Pizza Size', required: true, minSelections: 1, maxSelections: 1, sortOrder: 1 });
  await createGroup({ key: 'pizzaSide', name: 'Pizza Side (12" only)', required: false, minSelections: 0, maxSelections: 2, sortOrder: 2 });
  await createGroup({ key: 'toppings7', name: '7" Toppings', required: false, sortOrder: 3 });
  await createGroup({ key: 'toppings12Full', name: '12" Toppings (Full)', required: false, sortOrder: 4 });
  await createGroup({ key: 'toppings12Left', name: '12" Toppings - Left Side', required: false, sortOrder: 5 });
  await createGroup({ key: 'toppings12Right', name: '12" Toppings - Right Side', required: false, sortOrder: 6 });
  await createGroup({ key: 'comboSide', name: 'Combo Side', required: true, minSelections: 1, maxSelections: 1, sortOrder: 1 });
  await createGroup({ key: 'comboDrink', name: 'Combo Drink', required: true, minSelections: 1, maxSelections: 1, sortOrder: 2 });

  console.log('\nGroup items...');

  // Drink sizes
  await addGroupItem('pepsiSize', 'pepsiSmall', { sortOrder: 1, isDefault: true });
  await addGroupItem('pepsiSize', 'pepsiMed', { sortOrder: 2 });
  await addGroupItem('pepsiSize', 'pepsiLarge', { sortOrder: 3 });
  await addGroupItem('slushSize', 'slushSmall', { sortOrder: 1, isDefault: true });
  await addGroupItem('slushSize', 'slushMed', { sortOrder: 2 });
  await addGroupItem('slushSize', 'slushLarge', { sortOrder: 3 });
  for (const flavor of ['Lime', 'Peach', 'Blackberry', 'Pineapple', 'Mango']) {
    await addGroupItem('bublyFlavor', `bubly${flavor.replace(/\s/g, '')}`, { sortOrder: 0 });
  }

  // Pub grub sizes
  await addGroupItem('friesSize', 'friesSmall', { sortOrder: 1, isDefault: true });
  await addGroupItem('friesSize', 'friesMed', { sortOrder: 2 });
  await addGroupItem('friesSize', 'friesLarge', { sortOrder: 3 });
  await addGroupItem('poutineSize', 'poutineSmall', { sortOrder: 1, isDefault: true });
  await addGroupItem('poutineSize', 'poutineMed', { sortOrder: 2 });
  await addGroupItem('poutineSize', 'poutineLarge', { sortOrder: 3 });
  await addGroupItem('poutineCheese', 'poutineShredded', { isFree: true, isDefault: true, sortOrder: 1 });
  await addGroupItem('poutineCheese', 'poutineCurds', { isFree: true, sortOrder: 2 });
  await addGroupItem('poutineCheese', 'poutineBoth', { priceOverride: 0.44, sortOrder: 3 });
  await addGroupItem('ringsSize', 'ringsSmall', { sortOrder: 1, isDefault: true });
  await addGroupItem('ringsSize', 'ringsMed', { sortOrder: 2 });
  await addGroupItem('ringsSize', 'ringsLarge', { sortOrder: 3 });

  // Desserts
  await addGroupItem('funnelSize', 'funnelSmall', { sortOrder: 1, isDefault: true });
  await addGroupItem('funnelSize', 'funnelMed', { sortOrder: 2 });
  await addGroupItem('funnelSize', 'funnelLarge', { sortOrder: 3 });
  for (const bar of ['Nanaimo Bar', 'Butter Tart', 'Carrot Cake', 'Brownie']) {
    await addGroupItem('dessertChoice', `bar${bar.replace(/\s/g, '')}`, { isFree: true, sortOrder: 0 });
  }

  // Pizza
  await addGroupItem('pizzaSize', 'pizza7', { sortOrder: 1 });
  await addGroupItem('pizzaSize', 'pizza12', { sortOrder: 2 });
  await addGroupItem('pizzaSide', 'pizzaFull', { isFree: true, isDefault: true, sortOrder: 1 });
  await addGroupItem('pizzaSide', 'pizzaLeft', { isFree: true, sortOrder: 2 });
  await addGroupItem('pizzaSide', 'pizzaRight', { isFree: true, sortOrder: 3 });
  for (const [name] of TOPPINGS_7) {
    await addGroupItem('toppings7', `t7_${name.replace(/\s/g, '')}`, { sortOrder: 0 });
  }
  for (const [name] of TOPPINGS_12) {
    await addGroupItem('toppings12Full', `t12_${name.replace(/\s/g, '')}`, { sortOrder: 0 });
    await addGroupItem('toppings12Left', `t12L_${name.replace(/\s/g, '')}`, { sortOrder: 0 });
    await addGroupItem('toppings12Right', `t12R_${name.replace(/\s/g, '')}`, { sortOrder: 0 });
  }

  // Combo side
  await addGroupItem('comboSide', 'comboFrySmall', { isFree: true, isDefault: true, sortOrder: 1 });
  await addGroupItem('comboSide', 'comboFryMed', { sortOrder: 2 });
  await addGroupItem('comboSide', 'comboFryLarge', { sortOrder: 3 });
  await addGroupItem('comboSide', 'comboPoutineSmall', { sortOrder: 4 });
  await addGroupItem('comboSide', 'comboPoutineMed', { sortOrder: 5 });
  await addGroupItem('comboSide', 'comboPoutineLarge', { sortOrder: 6 });

  // Combo drinks - all drink items with upgrade pricing
  const drinkKeys = [
    'juiceBox', 'water', 'hotChocolate', 'coffee', 'tea', 'milk', 'gatorade', 'aloe', 'coconut',
    'pepsiSmall', 'pepsiMed', 'pepsiLarge', 'slushSmall', 'slushMed', 'slushLarge',
    'bublyLime', 'bublyPeach', 'bublyBlackberry', 'bublyPineapple', 'bublyMango',
  ];
  let drinkSort = 0;
  for (const dk of drinkKeys) {
    const { data: item } = await supabase.from('pos_inventory').select('price').eq('id', ids[dk]).single();
    const upgrade = comboDrinkUpgrade(Number(item?.price || 0));
    await addGroupItem('comboDrink', dk, {
      ...upgrade,
      sortOrder: drinkSort++,
    });
  }

  console.log('\nLink modifier groups to parent items...');

  const parentGroups = {
    pepsi: ['pepsiSize'],
    slushPuppie: ['slushSize'],
    bubly: ['bublyFlavor'],
    fries: ['friesSize'],
    poutine: ['poutineSize', 'poutineCheese'],
    onionRings: ['ringsSize'],
    funnelCake: ['funnelSize'],
    dessertBar: ['dessertChoice'],
    pizza: ['pizzaSize', 'pizzaSide', 'toppings7', 'toppings12Full', 'toppings12Left', 'toppings12Right'],
  };

  for (const comboKey of comboItems.map((c) => c[0])) {
    parentGroups[comboKey] = ['comboSide', 'comboDrink'];
  }

  for (const [itemKey, groupKeys] of Object.entries(parentGroups)) {
    const groupIds = groupKeys.map((gk) => groups[gk]).filter(Boolean);
    if (!ids[itemKey] || !groupIds.length) continue;
    await supabase
      .from('pos_inventory')
      .update({ modifier_group_ids: groupIds })
      .eq('id', ids[itemKey]);
    console.log(`  linked ${itemKey} -> ${groupKeys.join(', ')}`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
