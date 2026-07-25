/**
 * OTWK PA DAY - Day Camp 2026-2027 — TVDSB PA Day session schedule.
 *
 * Dates from TVDSB draft calendar (see OTWK pa-day-dates.ts).
 * Run: node scripts/setup-otwk-pa-day-camp-2026-2027-schedule.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const ACTIVITY_ID = '4953a3fc-cb09-41c0-85c3-c249bf21ef34';
const SOURCE_ACTIVITY_ID = '6df2118d-d593-4b10-8253-b121a367027b'; // 2025-2026 PA Day (tickets / payment)
const SCHEDULE_NAME = 'TVDSB PA Days 2026-2027';
const START_TIME = '8:30 AM';
const SPACES = 20;

/** Camp uses all party rooms for the full session. */
const DAY_CAMP_RESOURCE_ASSIGNMENTS = {
  'party-rooms': ['red-room', 'yellow-room', 'teal-room'],
};

/** TVDSB PA Day dates — 2026–2027 school year (draft calendar). */
const TVDSB_PA_DAYS_2026_2027 = [
  // Sep 2–3 omitted: already covered by summer camp single/week days
  '2026-10-26',
  '2027-01-15',
  '2027-04-16',
  '2027-06-04',
  '2027-06-30',
];

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function main() {
  console.log('=== OTWK PA Day Camp 2026-2027 (TVDSB) schedule ===');

  const { data: activity, error: actErr } = await supabase
    .from('booking_activities')
    .select('activity_name, ticket_settings')
    .eq('id', ACTIVITY_ID)
    .eq('business_id', BIZ)
    .single();
  if (actErr) throw actErr;
  console.log(`Activity: ${activity.activity_name}`);

  const { data: sourceActivity, error: sourceErr } = await supabase
    .from('booking_activities')
    .select('ticket_settings, terms_package_id')
    .eq('id', SOURCE_ACTIVITY_ID)
    .eq('business_id', BIZ)
    .maybeSingle();
  if (sourceErr) throw sourceErr;

  const sourceTickets =
    sourceActivity?.ticket_settings && typeof sourceActivity.ticket_settings === 'object'
      ? sourceActivity.ticket_settings
      : {};
  const existingTickets =
    activity?.ticket_settings && typeof activity.ticket_settings === 'object'
      ? activity.ticket_settings
      : {};

  // Prefer existing tickets if already configured; otherwise copy from 2025-2026 PA Day.
  const hasTickets = Array.isArray(existingTickets.inventory_item_ids)
    && existingTickets.inventory_item_ids.length > 0;
  const ticketSettings = hasTickets
    ? {
        ...existingTickets,
        camp_guide_url:
          existingTickets.camp_guide_url
          || 'https://www.offthewallkids.ca/pa-day-activities-london-ontario',
        online_payment: existingTickets.online_payment || sourceTickets.online_payment || {
          mode: 'require_deposit',
          deposit_type: 'percentage',
          deposit_percentage: 25,
          deposit_fixed_amount: null,
          auto_approve: true,
          deposit_due_days_after_approval: 7,
        },
      }
    : {
        ...sourceTickets,
        camp_guide_url: 'https://www.offthewallkids.ca/pa-day-activities-london-ontario',
      };

  const { error: activityUpdateError } = await supabase
    .from('booking_activities')
    .update({
      portal_visible: true,
      requires_waiver: true,
      requires_camper_registration: true,
      duration_minutes: 480,
      website_show_camp_sessions: true,
      website_camp_program: 'pa_day',
      website_camp_age_min: 4,
      website_camp_age_max: 12,
      website_camp_schedule_summary: '8:30am–4:30pm full day with lunch, snacks & drinks included',
      ticket_settings: ticketSettings,
      terms_package_id: sourceActivity?.terms_package_id || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ACTIVITY_ID)
    .eq('business_id', BIZ);
  if (activityUpdateError) throw activityUpdateError;
  console.log('Activity configured for portal + website camp sessions');

  const { error: deactivateError } = await supabase
    .from('booking_activity_schedules')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('business_id', BIZ)
    .eq('activity_id', ACTIVITY_ID)
    .eq('is_active', true);
  if (deactivateError) throw deactivateError;

  const { error: deleteError } = await supabase
    .from('booking_activity_schedules')
    .delete()
    .eq('business_id', BIZ)
    .eq('activity_id', ACTIVITY_ID)
    .eq('schedule_name', SCHEDULE_NAME);
  if (deleteError) throw deleteError;

  const rows = TVDSB_PA_DAYS_2026_2027.map((dateStr) => ({
    activity_id: ACTIVITY_ID,
    business_id: BIZ,
    day_of_week: new Date(`${dateStr}T12:00:00`).getDay(),
    start_time: START_TIME,
    spaces: SPACES,
    nominal_max_spaces: SPACES,
    resource_assignments: DAY_CAMP_RESOURCE_ASSIGNMENTS,
    schedule_name: SCHEDULE_NAME,
    start_date: dateStr,
    end_date: dateStr,
    is_active: true,
  }));

  const { error: insertError } = await supabase
    .from('booking_activity_schedules')
    .insert(rows);
  if (insertError) throw insertError;

  const { data: created, error: listError } = await supabase
    .from('booking_activity_schedules')
    .select('start_date, start_time, spaces, is_active')
    .eq('business_id', BIZ)
    .eq('activity_id', ACTIVITY_ID)
    .eq('schedule_name', SCHEDULE_NAME)
    .eq('is_active', true)
    .order('start_date');
  if (listError) throw listError;

  console.log(`Created ${created.length} TVDSB PA Day sessions (${START_TIME}, ${SPACES} spaces each):`);
  for (const row of created) {
    console.log(`  - ${row.start_date}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
