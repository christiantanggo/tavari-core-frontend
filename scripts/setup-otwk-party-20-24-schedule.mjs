/**
 * OTWK 20-kid & 24-kid party weekly schedule (from Bookeo "Regular Schedule 2026").
 *
 * Weekend (Sun/Sat): 10:15 AM, 12:45 PM, 3:15 PM, 5:45 PM — 1 space each
 * Weekdays (Mon–Fri): 4:00 PM – 6:00 PM every 30 min — 1 space each
 * All slots: pool of 2 adjacent rooms (red+yellow or yellow+teal — not red+teal).
 *
 * Run: node scripts/setup-otwk-party-20-24-schedule.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const SCHEDULE_NAME = 'Regular Schedule 2026';

const ACTIVITIES = [
  { id: 'b939a283-14ad-4a04-aa47-6158ab7fb14f', name: 'Super Birthday Party' },
  { id: 'cfb7c4fb-b0b6-499c-b612-6366a22e56e5', name: 'Party for Up to 24 Kids' },
];

const WEEKEND_DAYS = [0, 6];
const WEEKDAY_DAYS = [1, 2, 3, 4, 5];

const WEEKEND_SLOTS = ['10:15 AM', '12:45 PM', '3:15 PM', '5:45 PM'];

const WEEKDAY_SLOTS = ['4:00 PM', '4:30 PM', '5:00 PM', '5:30 PM', '6:00 PM'];

const RESOURCE_ASSIGNMENTS = {
  'party-rooms': {
    mode: 'pool',
    count: 2,
    pool: ['red-room', 'yellow-room', 'teal-room'],
    allowed_combinations: [
      ['red-room', 'yellow-room'],
      ['yellow-room', 'teal-room'],
    ],
  },
};

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function buildRows(activityId) {
  const rows = [];
  for (const day of WEEKEND_DAYS) {
    for (const startTime of WEEKEND_SLOTS) {
      rows.push({
        activity_id: activityId,
        business_id: BIZ,
        day_of_week: day,
        start_time: startTime,
        spaces: 1,
        nominal_max_spaces: 1,
        resource_assignments: RESOURCE_ASSIGNMENTS,
        schedule_name: SCHEDULE_NAME,
        start_date: null,
        end_date: null,
        is_active: true,
      });
    }
  }
  for (const day of WEEKDAY_DAYS) {
    for (const startTime of WEEKDAY_SLOTS) {
      rows.push({
        activity_id: activityId,
        business_id: BIZ,
        day_of_week: day,
        start_time: startTime,
        spaces: 1,
        nominal_max_spaces: 1,
        resource_assignments: RESOURCE_ASSIGNMENTS,
        schedule_name: SCHEDULE_NAME,
        start_date: null,
        end_date: null,
        is_active: true,
      });
    }
  }
  return rows;
}

async function applySchedule(activity) {
  console.log(`\n--- ${activity.name} ---`);

  const { error: deactivateError } = await supabase
    .from('booking_activity_schedules')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('business_id', BIZ)
    .eq('activity_id', activity.id)
    .eq('is_active', true);
  if (deactivateError) throw deactivateError;

  const { error: deleteError } = await supabase
    .from('booking_activity_schedules')
    .delete()
    .eq('business_id', BIZ)
    .eq('activity_id', activity.id)
    .eq('schedule_name', SCHEDULE_NAME);
  if (deleteError) throw deleteError;

  const rows = buildRows(activity.id);
  const { error: insertError } = await supabase
    .from('booking_activity_schedules')
    .insert(rows);
  if (insertError) throw insertError;

  const { count, error: countError } = await supabase
    .from('booking_activity_schedules')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', BIZ)
    .eq('activity_id', activity.id)
    .eq('schedule_name', SCHEDULE_NAME)
    .eq('is_active', true);
  if (countError) throw countError;

  console.log(`  ${count} slots (Red + Yellow Room on every slot)`);
}

async function main() {
  console.log('=== OTWK 20 & 24 party schedule ===');

  for (const activity of ACTIVITIES) {
    await applySchedule(activity);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
