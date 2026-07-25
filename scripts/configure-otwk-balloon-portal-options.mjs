/**
 * Add balloon bouquet and extra options to OTWK 10 & 10 party portal booking.
 * Run: node scripts/configure-otwk-balloon-portal-options.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const ACTIVITY_ID = 'd4f2f7a0-d20e-4045-90dd-09a94765a4fa';

const newPortalOptionGroupId = () =>
  `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const newPortalOptionItemId = () =>
  `opt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const defaultPortalOptionItem = (overrides = {}) => ({
  id: newPortalOptionItemId(),
  name: '',
  description: '',
  price: null,
  inventory_item_id: null,
  max_quantity: 1,
  required: false,
  included: false,
  show_when_option_id: null,
  input_type: 'quantity',
  sort_order: 0,
  ...overrides,
});

const defaultPortalOptionGroup = (overrides = {}) => ({
  id: newPortalOptionGroupId(),
  name: '',
  description: '',
  price: null,
  show_when_option_id: null,
  max_selections: null,
  sort_order: 0,
  options: [],
  ...overrides,
});

const AIR_BOUQUETS = [
  ['a6c096c5-5252-423a-afc0-86c4d2ebb32d', 'Air Filled - 7 Latex'],
  ['3ea56dc9-9e76-448b-bcf7-812f1f33b08d', 'Air Filled - 1 Foil, 6 Latex'],
  ['f6357cdf-842e-4979-8b5e-49366363576a', 'Air Filled - 3 Foil, 4 Latex'],
  ['476a3492-10c4-45bc-8ad5-e1958851f9b9', 'Air Filled - 7 Foil'],
];

const HELIUM_BOUQUETS = [
  ['b87fa83f-dd57-4d9f-a340-2a6c56d0dbd5', 'Helium - 5 Latex'],
  ['6975116c-1593-467e-9069-4a8b881aaca5', 'Helium - 7 Latex'],
  ['78cdf3ab-23e9-4cfc-85f2-4206476ce34f', 'Helium - 1 Foil, 4 Latex'],
  ['f704da96-9861-40d6-903f-38eb8845fb3f', 'Helium - 1 Foil, 6 Latex'],
  ['a68c2cad-eba2-424f-a4c3-2f08d6f40aef', 'Helium - 2 Foil, 3 Latex'],
  ['91d9bbfe-25f8-4f5e-b8fc-26819bfae707', 'Helium - 3 Foil, 4 Latex'],
  ['ec7a7ce9-cffe-46ec-a64c-10ff664b7e7f', 'Helium - 5 Foil'],
  ['bdf98d55-3ff4-488c-b27f-212ddf7da0ba', 'Helium - 7 Foil'],
];

/** Standalone balloon SKUs — sold only inside bouquets, not on POS grid or portal as separate options. */
const STANDALONE_BALLOON_NAMES = [
  'Latex Balloon',
  'Foil Balloon',
  'Number Balloon (w/ Helium)',
  'Silver Weight',
  'Table Top Stand',
  'Helium',
];

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function buildInventoryOptions(rows, maxQuantity = 1) {
  return rows.map(([inventoryId, name], index) =>
    defaultPortalOptionItem({
      id: newPortalOptionItemId(),
      name,
      inventory_item_id: inventoryId,
      price: null,
      included: false,
      required: false,
      input_type: 'quantity',
      max_quantity: maxQuantity,
      sort_order: index,
    })
  );
}

function buildBalloonGroup(startSortOrder = 0) {
  const allOptions = [
    ...buildInventoryOptions(AIR_BOUQUETS),
    ...buildInventoryOptions(HELIUM_BOUQUETS),
  ];

  return defaultPortalOptionGroup({
    id: newPortalOptionGroupId(),
    name: 'Balloons',
    description:
      'Optional balloon bouquets. After you add a bouquet, choose colours and styles for each balloon in the popup.',
    sort_order: startSortOrder,
    options: allOptions,
  });
}

function isBalloonGroup(group) {
  if (group?.is_bundle_component_group) return true;
  const name = String(group?.name || '').toLowerCase();
  return (
    name.includes('balloon')
    || String(group?.id || '').startsWith('grp_balloon_')
  );
}

async function hideStandaloneBalloonItemsFromPos() {
  const { error } = await supabase
    .from('pos_inventory')
    .update({ display_on_pos: false })
    .eq('business_id', BIZ)
    .in('name', STANDALONE_BALLOON_NAMES);

  if (error) throw new Error(error.message);
  console.log(`Hidden ${STANDALONE_BALLOON_NAMES.length} standalone balloon items from POS grid.`);
}

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

  const addonSettings =
    activity.addon_settings && typeof activity.addon_settings === 'object'
      ? activity.addon_settings
      : {};

  const portal = addonSettings.portal_options || {};
  const existingGroups = Array.isArray(portal.groups) ? portal.groups : [];
  const withoutBalloons = existingGroups.filter((group) => !isBalloonGroup(group));
  const maxSort = withoutBalloons.reduce(
    (max, group) => Math.max(max, Number.parseInt(group?.sort_order, 10) || 0),
    -1
  );

  const balloonGroup = buildBalloonGroup(maxSort + 1);
  const nextPortalOptions = {
    display_mode: portal.display_mode || 'step_modals',
    groups: [...withoutBalloons, balloonGroup],
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

  await hideStandaloneBalloonItemsFromPos();

  console.log(`Updated "${activity.activity_name}" with balloon portal options.`);
  console.log(`Group added: ${balloonGroup.name} (${balloonGroup.options.length} options)`);
  console.log(`Total portal groups: ${nextPortalOptions.groups.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
