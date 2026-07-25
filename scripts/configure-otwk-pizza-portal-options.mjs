/**
 * Import Cheese Pizza POS modifiers into OTWK 10 & 10 party portal options.
 * Run: node scripts/configure-otwk-pizza-portal-options.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { buildPortalOptionGroupsFromPosItem } from '../src/utils/portalOptionsFromPosModifiers.js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const ACTIVITY_ID = 'd4f2f7a0-d20e-4045-90dd-09a94765a4fa';
const CHEESE_PIZZA_ID = '933889d6-8007-4a86-af22-0c9af657ac8c';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function main() {
  const { data: activity, error: fetchError } = await supabase
    .from('booking_activities')
    .select('id, activity_name, addon_settings')
    .eq('id', ACTIVITY_ID)
    .eq('business_id', BIZ)
    .single();

  if (fetchError || !activity) {
    throw new Error(fetchError?.message || 'Activity not found');
  }

  const { sourceItemName, groups: pizzaGroups } = await buildPortalOptionGroupsFromPosItem(
    supabase,
    BIZ,
    CHEESE_PIZZA_ID
  );

  const addonSettings =
    activity.addon_settings && typeof activity.addon_settings === 'object'
      ? activity.addon_settings
      : {};

  const portal = addonSettings.portal_options || {};
  const existingGroups = Array.isArray(portal.groups) ? portal.groups : [];
  const withoutPizza = existingGroups.filter(
    (group) =>
      !String(group?.id || '').startsWith('grp_pizza_')
      && !/pizza size|toppings|pizza side/i.test(String(group?.name || ''))
  );

  const nextPortalOptions = {
    display_mode: 'step_modals',
    groups: [...withoutPizza, ...pizzaGroups],
  };

  const { error: updateError } = await supabase
    .from('booking_activities')
    .update({
      addon_settings: {
        ...addonSettings,
        portal_options: nextPortalOptions,
      },
    })
    .eq('id', ACTIVITY_ID)
    .eq('business_id', BIZ);

  if (updateError) throw new Error(updateError.message);

  console.log(`Updated "${activity.activity_name}" from POS item "${sourceItemName}".`);
  console.log(`Groups: ${nextPortalOptions.groups.map((g) => g.name).join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
