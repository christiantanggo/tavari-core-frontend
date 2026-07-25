/**
 * OTWK 30-kid & 36-kid (legacy) party weekly schedule (from Bookeo "Regular Schedule 2026").
 *
 * Weekend (Sun/Sat): 10:15 AM, 1:15 PM, 3:15 PM, 6:15 PM — 1 space each
 * Weekdays (Mon–Fri): 4:00 PM – 6:00 PM every 30 min — 1 space each
 * All slots use Red Room + Yellow Room + Teal Room.
 *
 * Run: node scripts/setup-otwk-party-30-schedule.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const SCHEDULE_NAME = 'Regular Schedule 2026';

const ACTIVITIES = [
  { id: '7815d4a7-6938-4cf8-a7ca-5bb51cc3d308', name: 'Ultimate Birthday Party' },
  { id: '264b29d8-2605-4d7f-ab95-7fd8b933ac0c', name: 'Party for Up to 36 Kids' },
];

const WEEKEND_DAYS = [0, 6];
const WEEKDAY_DAYS = [1, 2, 3, 4, 5];

const WEEKEND_SLOTS = ['10:15 AM', '1:15 PM', '3:15 PM', '6:15 PM'];

const WEEKDAY_SLOTS = ['4:00 PM', '4:30 PM', '5:00 PM', '5:30 PM', '6:00 PM'];

const RESOURCE_ASSIGNMENTS = { 'party-rooms': ['red-room', 'yellow-room', 'teal-room'] };

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

  console.log(`  ${count} slots (Red + Yellow + Teal Room on every slot)`);
}

async function main() {
  console.log('=== OTWK 30 & 36 party schedule ===');

  for (const activity of ACTIVITIES) {
    await applySchedule(activity);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
