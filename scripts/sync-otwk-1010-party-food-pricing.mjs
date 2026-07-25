/**
 * Apply party flyer food pricing to OTWK "10 & 10" portal options + linked inventory.
 * Run: node scripts/sync-otwk-1010-party-food-pricing.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const ACTIVITY_ID = 'd4f2f7a0-d20e-4045-90dd-09a94765a4fa';

/** Flyer prices (12" pizzas, platters, drinks). */
const FLYER_PRICE_BY_NAME = {
  'Cheese Pizza': 15.71,
  '12" Medium Cheese': 15.71,
  'Pepperoni Pizza': 17.48,
  'Vegetarian Pizza': 19.25,
  'Canadian Pizza': 19.25,
  '3-Meat Pizza': 19.25,
  'Deluxe Pizza': 19.25,
  'Breakfast Platter': 53.1,
  '12 Hot Dogs & Fries': 53.98,
  '24 Chicken Strips & Fries': 59.29,
  '36 Nuggets & Fries': 43.36,
  'Veggie Tray': 49.56,
  'Fruit Tray': 49.56,
  'Gold Fish Bowl': 13.27,
  'Chip Bowl': 9.73,
  'French Fry Bowl': 9.96,
  'Juice Box': 1.33,
  'Pepsi Pitcher': 8.85,
  'Coffee Pot': 2.25,
  'Food Option A': 60,
  'Food Option B': 56.41,
  'Food Option C': 59.26,
  'Chicken Nugget Party Platter': 40,
};

const ADDONS_TO_ENSURE = [
  { inventoryId: '2f2d5b05-adba-4f44-96fd-420db2984222', name: 'Cheese Pizza', price: 15.71 },
  { inventoryId: 'a48ced5e-4697-4a90-942b-5c4e88236fee', name: 'Canadian Pizza', price: 19.25 },
  { inventoryId: 'fc011243-0711-4b3d-b05a-fbc813ed37ab', name: 'Vegetarian Pizza', price: 19.25 },
  { inventoryId: '09d58afa-5cf1-4516-8a05-3603572464b1', name: '3-Meat Pizza', price: 19.25 },
  { inventoryId: '6911e62e-0d71-4301-b1b0-48da3bbc9fc7', name: 'Deluxe Pizza', price: 19.25 },
  { inventoryId: '15cbacf8-2ff9-4fa5-b400-db92ea90e90e', name: 'Coffee Pot', price: 2.25 },
];

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function newOptionId() {
  return `opt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function resolveFlyerPrice(optionName, inventoryName) {
  return (
    FLYER_PRICE_BY_NAME[optionName]
    ?? FLYER_PRICE_BY_NAME[inventoryName]
    ?? null
  );
}

async function syncInventoryPrices() {
  const names = Object.keys(FLYER_PRICE_BY_NAME);
  const { data: items, error } = await supabase
    .from('pos_inventory')
    .select('id, name, price')
    .eq('business_id', BIZ)
    .in('name', names);

  if (error) throw error;

  for (const item of items || []) {
    const flyerPrice = FLYER_PRICE_BY_NAME[item.name];
    if (flyerPrice == null) continue;
    const current = Number.parseFloat(item.price);
    if (Number.isFinite(current) && Math.abs(current - flyerPrice) < 0.01) continue;

    const { error: updateError } = await supabase
      .from('pos_inventory')
      .update({ price: flyerPrice, updated_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('business_id', BIZ);

    if (updateError) throw updateError;
    console.log(`  inventory: ${item.name} → $${flyerPrice.toFixed(2)}`);
  }
}

async function main() {
  console.log('=== Sync 10 & 10 party food pricing ===\n');

  console.log('Updating pos_inventory from flyer...');
  await syncInventoryPrices();

  const { data: activity, error: fetchError } = await supabase
    .from('booking_activities')
    .select('id, activity_name, addon_settings')
    .eq('id', ACTIVITY_ID)
    .eq('business_id', BIZ)
    .single();

  if (fetchError || !activity) {
    throw new Error(fetchError?.message || 'Activity not found');
  }

  const addonSettings =
    activity.addon_settings && typeof activity.addon_settings === 'object'
      ? activity.addon_settings
      : {};
  const portal = addonSettings.portal_options || {};
  const groups = Array.isArray(portal.groups) ? [...portal.groups] : [];

  const inventoryIds = new Set();
  for (const group of groups) {
    for (const opt of group.options || []) {
      if (opt.inventory_item_id) inventoryIds.add(opt.inventory_item_id);
    }
  }
  for (const row of ADDONS_TO_ENSURE) inventoryIds.add(row.inventoryId);

  const { data: inventoryRows, error: invError } = await supabase
    .from('pos_inventory')
    .select('id, name, price')
    .eq('business_id', BIZ)
    .in('id', [...inventoryIds]);

  if (invError) throw invError;

  const inventoryById = new Map((inventoryRows || []).map((row) => [row.id, row]));

  console.log('\nUpdating portal option prices...');
  for (const group of groups) {
    if (!/food/i.test(group.name || '')) continue;

    group.options = (group.options || []).map((opt) => {
      const inv = opt.inventory_item_id ? inventoryById.get(opt.inventory_item_id) : null;
      const flyerPrice = resolveFlyerPrice(opt.name, inv?.name);
      const price =
        flyerPrice != null
          ? flyerPrice
          : inv?.price != null
            ? Number.parseFloat(inv.price)
            : opt.price;

      if (flyerPrice != null) {
        console.log(`  ${group.name} / ${opt.name}: $${Number(price).toFixed(2)}`);
      }

      return {
        ...opt,
        price: price != null && Number.isFinite(Number(price)) ? Number(price) : null,
      };
    });

    if (group.name === 'Additional Food Add Ons') {
      const existingInvIds = new Set(
        (group.options || []).map((o) => o.inventory_item_id).filter(Boolean),
      );
      for (const row of ADDONS_TO_ENSURE) {
        if (existingInvIds.has(row.inventoryId)) continue;
        group.options.push({
          id: newOptionId(),
          name: row.name,
          description: '',
          price: row.price,
          inventory_item_id: row.inventoryId,
          max_quantity: 1,
          required: false,
          included: false,
          show_when_option_id: null,
          input_type: 'quantity',
          sort_order: group.options.length,
        });
        console.log(`  Added to Additional Food: ${row.name} ($${row.price.toFixed(2)})`);
      }
    }
  }

  const { error: updateError } = await supabase
    .from('booking_activities')
    .update({
      addon_settings: {
        ...addonSettings,
        portal_options: {
          ...portal,
          groups,
        },
      },
    })
    .eq('id', ACTIVITY_ID)
    .eq('business_id', BIZ);

  if (updateError) throw updateError;

  console.log(`\nDone — updated "${activity.activity_name}" food option pricing.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
