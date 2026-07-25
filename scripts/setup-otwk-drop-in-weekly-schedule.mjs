/**
 * OTWK Drop-In: indefinite weekly schedule — 20 spaces every 30 min, 10:00 AM–6:00 PM, all 7 days.
 *
 * Run: node scripts/setup-otwk-drop-in-weekly-schedule.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const DROP_IN_ACTIVITY_ID = '59cf5820-0ec2-49d4-b1d3-8c7475d72e47';
const SCHEDULE_NAME = 'Weekly Drop-In';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function formatTime12(totalMinutes) {
  const hours24 = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hour12 = hours24 % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${period}`;
}

function buildHalfHourSlots(startHour, startMinute, endHour, endMinute) {
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  const slots = [];
  for (let t = start; t <= end; t += 30) {
    slots.push(formatTime12(t));
  }
  return slots;
}

async function main() {
  console.log('=== OTWK Drop-In weekly schedule ===');

  const timeSlots = buildHalfHourSlots(10, 0, 18, 0);
  console.log(`Slots per day (${timeSlots.length}):`, timeSlots.join(', '));

  const { error: deactivateError } = await supabase
    .from('booking_activity_schedules')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('business_id', BIZ)
    .eq('activity_id', DROP_IN_ACTIVITY_ID)
    .eq('is_active', true);

  if (deactivateError) throw deactivateError;

  const { error: deleteError } = await supabase
    .from('booking_activity_schedules')
    .delete()
    .eq('business_id', BIZ)
    .eq('activity_id', DROP_IN_ACTIVITY_ID)
    .eq('schedule_name', SCHEDULE_NAME);

  if (deleteError) throw deleteError;

  const rows = [];
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek += 1) {
    for (const startTime of timeSlots) {
      rows.push({
        activity_id: DROP_IN_ACTIVITY_ID,
        business_id: BIZ,
        day_of_week: dayOfWeek,
        start_time: startTime,
        spaces: 20,
        nominal_max_spaces: 20,
        resource_assignments: { 'play-area': ['play-area'] },
        schedule_name: SCHEDULE_NAME,
        start_date: null,
        end_date: null,
        is_active: true,
      });
    }
  }

  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error: insertError } = await supabase
      .from('booking_activity_schedules')
      .insert(batch);
    if (insertError) throw insertError;
  }

  const { count, error: countError } = await supabase
    .from('booking_activity_schedules')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', BIZ)
    .eq('activity_id', DROP_IN_ACTIVITY_ID)
    .eq('schedule_name', SCHEDULE_NAME)
    .eq('is_active', true);

  if (countError) throw countError;

  console.log(`\nCreated "${SCHEDULE_NAME}": ${count} active rows (7 days × ${timeSlots.length} slots, 20 spaces each)`);
  console.log('Previous drop-in schedules deactivated.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
