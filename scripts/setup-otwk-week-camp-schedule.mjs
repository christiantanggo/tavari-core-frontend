/**
 * OTWK Week Long Summer Camp 2026 — individual Monday session dates @ 8:30 AM, 20 spaces.
 *
 * Run: node scripts/setup-otwk-week-camp-schedule.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const ACTIVITY_ID = '509bdac0-30fd-400c-a03b-889eb2c80e62';
const START_TIME = '08:30:00';
const SPACES = 20;

/** Day camp uses all party rooms for the full session. */
const DAY_CAMP_RESOURCE_ASSIGNMENTS = {
  'party-rooms': ['red-room', 'yellow-room', 'teal-room'],
};

/** Monday week-start dates from Bookeo weekly camp schedule. */
const CAMP_WEEK_START_DATES = [
  '2026-06-29',
  '2026-07-06',
  '2026-07-13',
  '2026-07-20',
  '2026-07-27',
  '2026-08-03',
  '2026-08-10',
  '2026-08-17',
  '2026-08-24',
  '2026-08-31',
];

function listWeekdaysFromMonday(mondayIso) {
  const out = [];
  const cursor = new Date(`${mondayIso}T12:00:00`);
  for (let i = 0; i < 5; i += 1) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

const SCHEDULE_NAME_PREFIX = 'Multi-day: Summer Camp Week';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function main() {
  console.log('=== OTWK Week Long Summer Camp schedule (multi-day Mon–Fri) ===');

  const { data: activity, error: actErr } = await supabase
    .from('booking_activities')
    .select('activity_name')
    .eq('id', ACTIVITY_ID)
    .single();
  if (actErr) throw actErr;
  console.log(`Activity: ${activity.activity_name}`);

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
    .eq('activity_id', ACTIVITY_ID);
  if (deleteError) throw deleteError;

  const rows = [];
  for (const monday of CAMP_WEEK_START_DATES) {
    const weekDates = listWeekdaysFromMonday(monday);
    const scheduleName = `${SCHEDULE_NAME_PREFIX} ${monday}`;
    for (const dateStr of weekDates) {
      const dayOfWeek = new Date(`${dateStr}T12:00:00`).getDay();
      rows.push({
        activity_id: ACTIVITY_ID,
        business_id: BIZ,
        day_of_week: dayOfWeek,
        start_time: START_TIME,
        spaces: SPACES,
        nominal_max_spaces: SPACES,
        resource_assignments: DAY_CAMP_RESOURCE_ASSIGNMENTS,
        schedule_name: scheduleName,
        start_date: dateStr,
        end_date: dateStr,
        is_active: true,
      });
    }
  }

  const { error: insertError } = await supabase.from('booking_activity_schedules').insert(rows);
  if (insertError) throw insertError;

  const { data: activityFull, error: actFullErr } = await supabase
    .from('booking_activities')
    .select('ticket_settings')
    .eq('id', ACTIVITY_ID)
    .single();
  if (actFullErr) throw actFullErr;

  const { error: portalError } = await supabase
    .from('booking_activities')
    .update({
      portal_visible: true,
      ticket_settings: {
        ...(activityFull?.ticket_settings && typeof activityFull.ticket_settings === 'object'
          ? activityFull.ticket_settings
          : {}),
        multiDay: {
          enabled: true,
          dayCount: 5,
          daysOfWeek: [1, 2, 3, 4, 5],
          anchorDayOfWeek: 1,
          dailyDurationMinutes: 480,
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', ACTIVITY_ID);
  if (portalError) throw portalError;

  console.log(`Inserted ${rows.length} multi-day rows (${CAMP_WEEK_START_DATES.length} weeks × 5 days) @ ${START_TIME}, ${SPACES} spaces.`);
  console.log('portal_visible: true; multiDay ticket_settings enabled');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
