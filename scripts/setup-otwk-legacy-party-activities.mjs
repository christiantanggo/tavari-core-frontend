/**
 * OTWK London: legacy Bookeo party activities (12/24/36, staff-only on portal)
 * and ensure public 10/20/30 activities stay portal-visible.
 *
 * Run: node scripts/setup-otwk-legacy-party-activities.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const BIRTHDAY_TYPE_ID = 'e87ee858-1f8c-4a39-b169-f3e9afbfe97d';

const PUBLIC_ACTIVITIES = {
  ten: 'd4f2f7a0-d20e-4045-90dd-09a94765a4fa',
  twenty: 'b939a283-14ad-4a04-aa47-6158ab7fb14f',
  thirty: '7815d4a7-6938-4cf8-a7ca-5bb51cc3d308',
};

const INVENTORY = {
  kids12: 'c149c8ec-d4c1-4796-8901-635205244eae',
  kids24: '5a3927c9-12cb-4b04-a386-a1bf2c87c4ce',
  kids36: '8bc28455-29b3-4500-a2ab-74dd5fc3876c',
};

/** Customer-facing public portal party tiers (10/20/30 kids). */
function includedFoodBundleLine(pickCount, optionCount = 3) {
  if (pickCount >= optionCount) {
    return `Included party food bundles — all ${optionCount} options included`;
  }
  return `Included party food bundles — choose ${pickCount} of ${optionCount} options when booking`;
}

function publicPartyDescription(tier) {
  return `${tier.name} — up to ${tier.includedKids} kids and ${tier.includedAdults} adults · 90 minutes in the private party room (on your booked schedule) · Unlimited play in the facility until we close · ${includedFoodBundleLine(tier.includedFoodBundles)}.`;
}

function publicPartyWebsiteInclusions(tier) {
  return [
    `${tier.name} — up to ${tier.includedKids} kids and ${tier.includedAdults} adults included`,
    '90 minutes in the private party room (on your booked schedule)',
    'Unlimited play in the facility until we close',
    includedFoodBundleLine(tier.includedFoodBundles),
  ];
}

const PUBLIC_PARTY_TIERS = {
  ten: { name: 'Classic Birthday Party', includedKids: 10, includedAdults: 10, includedFoodBundles: 1, sortOrder: 1 },
  twenty: { name: 'Super Birthday Party', includedKids: 20, includedAdults: 20, includedFoodBundles: 2, sortOrder: 2 },
  thirty: { name: 'Ultimate Birthday Party', includedKids: 30, includedAdults: 30, includedFoodBundles: 3, sortOrder: 3 },
};

const LEGACY_TIERS = [
  {
    name: 'Party for Up to 12 Kids',
    bookeoActivityMatch: 'Up to 12 Child Birthday Party',
    inventoryId: INVENTORY.kids12,
    includedKids: 12,
    includedAdults: 12,
    cloneFrom: PUBLIC_ACTIVITIES.ten,
  },
  {
    name: 'Party for Up to 24 Kids',
    bookeoActivityMatch: 'Up to 24 Child Birthday Party',
    inventoryId: INVENTORY.kids24,
    includedKids: 24,
    includedAdults: 24,
    cloneFrom: PUBLIC_ACTIVITIES.twenty,
  },
  {
    name: 'Party for Up to 36 Kids',
    bookeoActivityMatch: 'Up to 36 Child Birthday Party',
    inventoryId: INVENTORY.kids36,
    includedKids: 36,
    includedAdults: 36,
    cloneFrom: PUBLIC_ACTIVITIES.ten,
  },
];

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function buildTicketSettings(template, inventoryId) {
  const base = template && typeof template === 'object' ? structuredClone(template) : {};
  base.party_booking = true;
  base.require_birthday_child = true;
  base.enforce_online_only = true;
  base.inventory_item_ids = [inventoryId];
  base.assignment_rules = [
    {
      enabled: true,
      inventory_item_id: inventoryId,
      max_unit: 'years',
      max_value: null,
      min_unit: 'years',
      min_value: null,
      priority: 1000,
      use_inventory_age_restriction: true,
    },
  ];
  base.pricing_rules = [
    {
      allow_additional_paid_tickets: true,
      count_paid_triggers_only: true,
      discounted_quantity: 1,
      enabled: false,
      inventory_item_id: inventoryId,
      max_discounted_quantity: null,
      trigger_item_ids: [],
      trigger_quantity: 1,
    },
  ];
  // Match Classic: staff approval + 20% deposit; T&Cs go out after approval, not in portal checkout.
  if (!base.online_payment) {
    base.online_payment = {
      auto_approve: false,
      deposit_due_days_after_approval: 3,
      deposit_fixed_amount: null,
      deposit_percentage: 20,
      deposit_type: 'percentage',
      mode: 'require_deposit',
    };
  }
  return base;
}

async function findActivityByName(name) {
  const { data, error } = await supabase
    .from('booking_activities')
    .select('id, activity_name, portal_visible, is_active')
    .eq('business_id', BIZ)
    .eq('activity_name', name)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadActivity(id) {
  const { data, error } = await supabase
    .from('booking_activities')
    .select('*')
    .eq('id', id)
    .eq('business_id', BIZ)
    .single();
  if (error) throw error;
  return data;
}

async function copySchedules(fromActivityId, toActivityId) {
  const { data: schedules, error } = await supabase
    .from('booking_activity_schedules')
    .select('*')
    .eq('business_id', BIZ)
    .eq('activity_id', fromActivityId);

  if (error) throw error;
  if (!schedules?.length) {
    console.log(`  no schedules on source ${fromActivityId}`);
    return 0;
  }

  const { data: existing, error: existingError } = await supabase
    .from('booking_activity_schedules')
    .select('id')
    .eq('business_id', BIZ)
    .eq('activity_id', toActivityId)
    .limit(1);
  if (existingError) throw existingError;
  if (existing?.length) {
    console.log(`  schedules already exist on ${toActivityId} — skip copy`);
    return 0;
  }

  const rows = schedules.map(({ id, created_at, updated_at, activity_id, ...rest }) => ({
    ...rest,
    business_id: BIZ,
    activity_id: toActivityId,
    is_active: rest.is_active !== false,
  }));

  const { error: insertError } = await supabase
    .from('booking_activity_schedules')
    .insert(rows);
  if (insertError) throw insertError;
  return rows.length;
}

async function ensureLegacyActivity(tier) {
  console.log(`\n--- ${tier.name} ---`);
  const template = await loadActivity(tier.cloneFrom);
  let activity = await findActivityByName(tier.name);

  const ticketSettings = buildTicketSettings(template.ticket_settings, tier.inventoryId);
  const payload = {
    business_id: BIZ,
    type_id: BIRTHDAY_TYPE_ID,
    activity_name: tier.name,
    duration_minutes: template.duration_minutes || 90,
    requires_waiver: true,
    is_active: true,
    portal_visible: false,
    party_included_kids: tier.includedKids,
    party_included_adults: tier.includedAdults,
    party_one_adult_per_child: template.party_one_adult_per_child ?? null,
    ticket_settings: ticketSettings,
    addon_settings: template.addon_settings || {},
    description:
      `Legacy Bookeo import tier — ${tier.includedKids} kids / ${tier.includedAdults} adults. Hidden from customer booking site; staff and imports only.`,
  };

  if (activity) {
    const { data, error } = await supabase
      .from('booking_activities')
      .update({
        ...payload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', activity.id)
      .select('id, activity_name, portal_visible')
      .single();
    if (error) throw error;
    activity = data;
    console.log(`  updated existing activity ${activity.id}`);
  } else {
    const { data, error } = await supabase
      .from('booking_activities')
      .insert(payload)
      .select('id, activity_name, portal_visible')
      .single();
    if (error) throw error;
    activity = data;
    console.log(`  created activity ${activity.id}`);
  }

  const copied = await copySchedules(tier.cloneFrom, activity.id);
  console.log(`  copied ${copied} schedule row(s)`);
  return activity;
}

async function applyIncludedFoodBundleMaxSelections(activityId, bundleCount) {
  const { data: activity, error: fetchError } = await supabase
    .from('booking_activities')
    .select('addon_settings')
    .eq('id', activityId)
    .eq('business_id', BIZ)
    .single();
  if (fetchError) throw fetchError;

  const addonSettings =
    activity?.addon_settings && typeof activity.addon_settings === 'object'
      ? activity.addon_settings
      : {};
  const portal = addonSettings.portal_options || {};
  const groups = Array.isArray(portal.groups)
    ? portal.groups.map((group) => {
        if (!/included food/i.test(group?.name || '')) return group;
        return { ...group, max_selections: bundleCount };
      })
    : [];

  const { error } = await supabase
    .from('booking_activities')
    .update({
      addon_settings: {
        ...addonSettings,
        portal_options: { ...portal, groups },
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', activityId)
    .eq('business_id', BIZ);
  if (error) throw error;
}

async function ensurePublicActivity(id, tierKey) {
  const tier = PUBLIC_PARTY_TIERS[tierKey];
  const { data, error } = await supabase
    .from('booking_activities')
    .update({
      activity_name: tier.name,
      portal_visible: true,
      is_active: true,
      party_included_kids: tier.includedKids,
      party_included_adults: tier.includedAdults,
      description: publicPartyDescription(tier),
      website_package_inclusions: publicPartyWebsiteInclusions(tier),
      website_show_party_package: true,
      website_food_credit: null,
      website_sort_order: tier.sortOrder,
      website_highlighted: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('business_id', BIZ)
    .select('id, activity_name, portal_visible, party_included_kids, party_included_adults, description')
    .single();
  if (error) throw error;
  await applyIncludedFoodBundleMaxSelections(id, tier.includedFoodBundles);
  console.log(`\nPublic: ${data.activity_name} — portal_visible=${data.portal_visible}, ${data.party_included_kids}/${data.party_included_adults} kids/adults, ${tier.includedFoodBundles} food bundle(s)`);
  return data;
}

async function ensureThirtyThirty() {
  const tier = PUBLIC_PARTY_TIERS.thirty;
  const template = await loadActivity(PUBLIC_ACTIVITIES.twenty);

  const { data: existing, error: fetchError } = await supabase
    .from('booking_activities')
    .select('id, activity_name')
    .eq('id', PUBLIC_ACTIVITIES.thirty)
    .eq('business_id', BIZ)
    .maybeSingle();
  if (fetchError) throw fetchError;

  const ticketSettings = buildTicketSettings(template.ticket_settings, INVENTORY.kids36);
  const payload = {
    business_id: BIZ,
    type_id: BIRTHDAY_TYPE_ID,
    activity_name: tier.name,
    duration_minutes: 90,
    requires_waiver: true,
    is_active: true,
    portal_visible: true,
    party_included_kids: tier.includedKids,
    party_included_adults: tier.includedAdults,
    party_one_adult_per_child: template.party_one_adult_per_child ?? null,
    ticket_settings: ticketSettings,
    addon_settings: template.addon_settings || {},
    description: publicPartyDescription(tier),
    website_package_inclusions: publicPartyWebsiteInclusions(tier),
    website_show_party_package: true,
    website_food_credit: null,
    website_sort_order: tier.sortOrder,
    website_highlighted: false,
  };

  if (existing) {
    const { data, error } = await supabase
      .from('booking_activities')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('id, activity_name, portal_visible')
      .single();
    if (error) throw error;
    console.log(`\nUpdated ${data.activity_name} (${data.id})`);
    return data;
  }

  const { data, error } = await supabase
    .from('booking_activities')
    .insert({ ...payload, id: PUBLIC_ACTIVITIES.thirty })
    .select('id, activity_name, portal_visible')
    .single();
  if (error) throw error;
  console.log(`\nCreated ${data.activity_name} (${data.id})`);
  await copySchedules(PUBLIC_ACTIVITIES.twenty, data.id);
  return data;
}

async function main() {
  console.log('=== OTWK legacy party activities setup ===');

  await ensurePublicActivity(PUBLIC_ACTIVITIES.ten, 'ten');
  await ensurePublicActivity(PUBLIC_ACTIVITIES.twenty, 'twenty');
  await ensureThirtyThirty();

  for (const tier of LEGACY_TIERS) {
    await ensureLegacyActivity(tier);
  }

  const { data: summary, error } = await supabase
    .from('booking_activities')
    .select('activity_name, portal_visible, party_included_kids, party_included_adults, is_active')
    .eq('business_id', BIZ)
    .eq('type_id', BIRTHDAY_TYPE_ID)
    .order('activity_name');
  if (error) throw error;

  console.log('\n=== Birthday party activities ===');
  for (const row of summary || []) {
    console.log(
      `${row.portal_visible ? 'PUBLIC ' : 'STAFF  '} | ${row.activity_name} | kids=${row.party_included_kids} adults=${row.party_included_adults}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
