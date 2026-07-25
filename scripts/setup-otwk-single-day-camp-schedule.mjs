/**
 * OTWK SINGLE DAYS - Summer Camp 2026 — every weekday @ 8:30 AM through Sep 4, 2026.
 *
 * Run: node scripts/setup-otwk-single-day-camp-schedule.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const ACTIVITY_ID = '25477f78-90a9-4f80-bf4e-155f25d4d550';
const SCHEDULE_NAME = 'Single Day Summer Camp 2026';
const START_TIME = '8:30 AM';
const SPACES = 20;

/** Day camp uses all party rooms for the full session. */
const DAY_CAMP_RESOURCE_ASSIGNMENTS = {
  'party-rooms': ['red-room', 'yellow-room', 'teal-room'],
};

/** First weekday of OTWK summer single-day camp season (Tue after week-camp Mon Jun 29). */
const SEASON_START = '2026-06-30';
/** Last single-day camp date (inclusive). */
const SEASON_END = '2026-09-04';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function weekdayDatesInclusive(startIso, endIso) {
  const dates = [];
  const cursor = new Date(`${startIso}T12:00:00`);
  const end = new Date(`${endIso}T12:00:00`);
  while (cursor <= end) {
    const dow = cursor.getDay();
    if (dow >= 1 && dow <= 5) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

async function main() {
  console.log('=== OTWK Single Day Summer Camp schedule ===');

  const { data: activity, error: actErr } = await supabase
    .from('booking_activities')
    .select('activity_name')
    .eq('id', ACTIVITY_ID)
    .single();
  if (actErr) throw actErr;
  console.log(`Activity: ${activity.activity_name}`);

  const campDates = weekdayDatesInclusive(SEASON_START, SEASON_END);
  console.log(`Weekdays ${SEASON_START} → ${SEASON_END}: ${campDates.length} days`);

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

  const rows = campDates.map((dateStr) => ({
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

  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const { error: insertError } = await supabase
      .from('booking_activity_schedules')
      .insert(rows.slice(i, i + batchSize));
    if (insertError) throw insertError;
  }

  const { count, error: countError } = await supabase
    .from('booking_activity_schedules')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', BIZ)
    .eq('activity_id', ACTIVITY_ID)
    .eq('schedule_name', SCHEDULE_NAME)
    .eq('is_active', true);
  if (countError) throw countError;

  console.log(`Created ${count} weekday sessions (${START_TIME}, ${SPACES} spaces each)`);
  console.log(`First: ${campDates[0]}, Last: ${campDates[campDates.length - 1]}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
