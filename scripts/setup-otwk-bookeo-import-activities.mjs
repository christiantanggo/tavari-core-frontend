/**
 * Create / update Tavari activities needed for Bookeo CSV import.
 *
 * Run: node scripts/setup-otwk-bookeo-import-activities.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const TYPES = {
  birthday: 'e87ee858-1f8c-4a39-b169-f3e9afbfe97d',
  dropIn: '2676aa5c-54a0-44fa-bd98-1854cd93fbcf',
  dayCamp: '87cb7e10-0e87-43b8-a512-d07243db9117',
};

const ACTIVITIES = {
  dropIn: '59cf5820-0ec2-49d4-b1d3-8c7475d72e47',
  party12: 'ec8c38d6-5e61-4640-9be8-52ea886b5df3',
  party24: 'cfb7c4fb-b0b6-499c-b612-6366a22e56e5',
  party36: '264b29d8-2605-4d7f-ab95-7fd8b933ac0c',
};

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function upsertActivity({ name, typeId, durationMinutes, portalVisible, requiresWaiver, requiresCamperRegistration, description, ticketSettings }) {
  const { data: existing, error: findError } = await supabase
    .from('booking_activities')
    .select('id, activity_name')
    .eq('business_id', BIZ)
    .eq('activity_name', name)
    .maybeSingle();
  if (findError) throw findError;

  const payload = {
    business_id: BIZ,
    type_id: typeId,
    activity_name: name,
    duration_minutes: durationMinutes,
    requires_waiver: requiresWaiver !== false,
    requires_camper_registration: requiresCamperRegistration === true,
    is_active: true,
    portal_visible: portalVisible !== false,
    description: description || null,
    ticket_settings: ticketSettings || {},
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { data, error } = await supabase
      .from('booking_activities')
      .update(payload)
      .eq('id', existing.id)
      .select('id, activity_name, portal_visible')
      .single();
    if (error) throw error;
    console.log(`  updated: ${data.activity_name} (${data.id})`);
    return data;
  }

  const { data, error } = await supabase
    .from('booking_activities')
    .insert(payload)
    .select('id, activity_name, portal_visible')
    .single();
  if (error) throw error;
  console.log(`  created: ${data.activity_name} (${data.id})`);
  return data;
}

async function loadTicketSettings(activityId) {
  const { data, error } = await supabase
    .from('booking_activities')
    .select('ticket_settings')
    .eq('id', activityId)
    .single();
  if (error) throw error;
  return data?.ticket_settings || {};
}

async function main() {
  console.log('=== OTWK Bookeo import activities ===\n');

  const dropInTickets = await loadTicketSettings(ACTIVITIES.dropIn);

  console.log('Drop-In (portal visible — customer copy in Additional Information Sections):');
  await upsertActivity({
    name: 'Drop In Play',
    typeId: TYPES.dropIn,
    durationMinutes: 120,
    portalVisible: true,
    requiresWaiver: true,
    description: null,
    ticketSettings: dropInTickets,
  });

  console.log('\nLegacy party tiers (staff/import only):');
  for (const [label, id] of [['12', ACTIVITIES.party12], ['24', ACTIVITIES.party24], ['36', ACTIVITIES.party36]]) {
    const { data } = await supabase
      .from('booking_activities')
      .select('id, activity_name, portal_visible')
      .eq('id', id)
      .single();
    console.log(`  ${data.activity_name}: portal_visible=${data.portal_visible}`);
  }

  console.log('\nSummer camp (Bookeo import):');
  const campTickets = {
    enforce_online_only: false,
    inventory_item_ids: [],
    min_tickets: 1,
    max_tickets: null,
    multiDay: {
      enabled: true,
      dayCount: 5,
      daysOfWeek: [1, 2, 3, 4, 5],
      anchorDayOfWeek: 1,
      dailyDurationMinutes: 480,
    },
  };
  await upsertActivity({
    name: 'Week Long Summer Camp 2026',
    typeId: TYPES.dayCamp,
    durationMinutes: 480,
    portalVisible: false,
    requiresWaiver: true,
    requiresCamperRegistration: true,
    description: 'Imported from Bookeo — week-long summer camp bookings.',
    ticketSettings: campTickets,
  });

  console.log('\nSingle-day summer camp (Bookeo import):');
  await upsertActivity({
    name: 'SINGLE DAYS - Summer Camp 2026',
    typeId: TYPES.dayCamp,
    durationMinutes: 480,
    portalVisible: false,
    requiresWaiver: true,
    requiresCamperRegistration: true,
    description: 'Imported from Bookeo — single-day summer camp bookings.',
    ticketSettings: campTickets,
  });

  console.log('\nPA Day camp (Bookeo import):');
  await upsertActivity({
    name: 'PA DAY - Day Camp 2026-2027',
    typeId: TYPES.dayCamp,
    durationMinutes: 480,
    portalVisible: false,
    requiresWaiver: true,
    requiresCamperRegistration: true,
    description: 'Imported from Bookeo — PA Day camp bookings.',
    ticketSettings: {},
  });

  console.log('\nCommunity partner events (Bookeo import):');
  await upsertActivity({
    name: 'Community Partner Night',
    typeId: TYPES.dropIn,
    durationMinutes: 240,
    portalVisible: false,
    requiresWaiver: true,
    description: 'Imported from Bookeo — community partner night bookings.',
    ticketSettings: {},
  });

  console.log('\nDone. Activity IDs for import script:');
  console.log(JSON.stringify({ ...ACTIVITIES, dropIn: ACTIVITIES.dropIn }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
