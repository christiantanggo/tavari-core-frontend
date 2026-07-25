/**
 * OTWK 12-kid party weekly schedule (from Bookeo "Regular Schedule 2026").
 *
 * Weekend (Sun/Sat): 10:15 AM – 6:15 PM party slots (1 space each)
 * Weekdays (Mon–Fri): 4:00 PM – 6:00 PM party slots (1 space each)
 *
 * Run: node scripts/setup-otwk-party-12-schedule.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const SCHEDULE_NAME = 'Regular Schedule 2026';

const ACTIVITIES = [
  { id: 'ec8c38d6-5e61-4640-9be8-52ea886b5df3', name: 'Party for Up to 12 Kids' },
  { id: 'd4f2f7a0-d20e-4045-90dd-09a94765a4fa', name: 'Classic Birthday Party' },
];

const WEEKEND_DAYS = [0, 6]; // Sun, Sat
const WEEKDAY_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri

const WEEKEND_SLOTS = [
  '10:15 AM', '10:45 AM', '11:15 AM',
  '12:15 PM', '12:45 PM', '1:15 PM',
  '3:15 PM', '3:45 PM', '4:15 PM',
  '5:15 PM', '5:45 PM', '6:15 PM',
];

const WEEKDAY_SLOTS = [
  '4:00 PM', '4:30 PM', '5:00 PM', '5:30 PM', '6:00 PM',
];

/** Bookeo: these slots use the Red Room (both 10-kid and 12-kid party activities). */
const RED_ROOM_TIMES = new Set(['10:15 AM', '12:15 PM', '3:15 PM', '5:15 PM']);

/** These weekend slots use the Yellow Room. */
const YELLOW_ROOM_TIMES = new Set(['10:45 AM', '12:45 PM', '3:45 PM', '5:45 PM']);

function partyRoomPool(count = 1) {
  return {
    'party-rooms': {
      mode: 'pool',
      count,
      pool: ['red-room', 'yellow-room', 'teal-room'],
    },
  };
}

function partyRoomResource(roomId) {
  return { 'party-rooms': [roomId] };
}

function resourceForSlot(startTime, isWeekend) {
  if (!isWeekend) {
    // Weekday Classic: any 1 of 3 rooms (auto-assigned at booking time).
    return partyRoomPool(1);
  }
  if (RED_ROOM_TIMES.has(startTime)) return partyRoomResource('red-room');
  if (YELLOW_ROOM_TIMES.has(startTime)) return partyRoomResource('yellow-room');
  return partyRoomResource('teal-room');
}

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
        resource_assignments: resourceForSlot(startTime, true),
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
        resource_assignments: resourceForSlot(startTime, false),
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

  console.log(`  ${count} slots (${WEEKEND_SLOTS.length}×2 weekend days + ${WEEKDAY_SLOTS.length}×5 weekdays, 1 space each)`);
}

async function main() {
  console.log('=== OTWK 12-kid party schedule ===');
  console.log(`Schedule: "${SCHEDULE_NAME}"`);

  for (const activity of ACTIVITIES) {
    await applySchedule(activity);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
