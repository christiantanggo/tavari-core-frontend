/**
 * Drop In Play uses "Adult" (8ac8b82d) in ticket_settings but that POS item is inactive.
 * Portal only loads active inventory, so supervising adults cannot be assigned a ticket.
 *
 * Run: node scripts/fix-dropin-adult-ticket-config.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const DROP_IN_ACTIVITY_ID = '59cf5820-0ec2-49d4-b1d3-8c7475d72e47';
const INACTIVE_ADULT_ID = '8ac8b82d-24f4-46d3-a1aa-f90e61259579';
const FREE_ADULT_ID = '8c1c0879-ab7e-4e86-8bbb-c8c064409bab';
const ADDITIONAL_ADULT_ID = 'dbf00a0d-01fe-4d42-959f-549c4f640da2';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const replaceId = (value) => {
  if (typeof value === 'string') {
    return value === INACTIVE_ADULT_ID ? FREE_ADULT_ID : value;
  }
  return value;
};

function patchTicketSettings(raw) {
  const settings = typeof raw === 'string' ? JSON.parse(raw) : { ...(raw || {}) };

  settings.inventory_item_ids = [...new Set(
    (settings.inventory_item_ids || [])
      .map(replaceId)
      .filter((id) => id !== INACTIVE_ADULT_ID)
  )];
  if (!settings.inventory_item_ids.includes(FREE_ADULT_ID)) {
    settings.inventory_item_ids.push(FREE_ADULT_ID);
  }

  settings.assignment_rules = (settings.assignment_rules || []).map((rule) => ({
    ...rule,
    inventory_item_id: replaceId(rule.inventory_item_id),
  }));

  settings.pricing_rules = (settings.pricing_rules || []).map((rule) => ({
    ...rule,
    inventory_item_id: replaceId(rule.inventory_item_id),
    trigger_item_ids: Array.isArray(rule.trigger_item_ids)
      ? rule.trigger_item_ids.map(replaceId)
      : rule.trigger_item_ids,
  }));

  return settings;
}

async function main() {
  const { data: activity, error } = await supabase
    .from('booking_activities')
    .select('id, activity_name, ticket_settings')
    .eq('id', DROP_IN_ACTIVITY_ID)
    .eq('business_id', BIZ)
    .single();
  if (error) throw error;

  const before = activity.ticket_settings || {};
  const after = patchTicketSettings(before);

  const { error: updateError } = await supabase
    .from('booking_activities')
    .update({ ticket_settings: after, updated_at: new Date().toISOString() })
    .eq('id', DROP_IN_ACTIVITY_ID);
  if (updateError) throw updateError;

  const { data: items } = await supabase
    .from('pos_inventory')
    .select('id, name, is_active, price')
    .in('id', [INACTIVE_ADULT_ID, FREE_ADULT_ID, ADDITIONAL_ADULT_ID]);

  console.log('Updated Drop In Play ticket_settings');
  console.log('inventory_item_ids:', after.inventory_item_ids);
  console.log(
    'adult assignment rule:',
    after.assignment_rules?.find((r) => r.inventory_item_id === FREE_ADULT_ID),
  );
  console.log('\nRelated POS items:');
  (items || []).forEach((item) => {
    console.log(`  ${item.name} (${item.id}): active=${item.is_active}, price=${item.price}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
