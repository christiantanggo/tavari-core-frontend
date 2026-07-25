/**
 * Convert existing OTWK week-long camp bookings into parent + daily attendance rows.
 *
 * Run: node scripts/migrate-otwk-week-camp-multiday.mjs
 *      node scripts/migrate-otwk-week-camp-multiday.mjs --apply
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  computeMultiDayDates,
  createMultiDayBookingRows,
  parseMultiDaySettings,
  syncDayResourceAssignments,
} from './lib/bookingMultiDay.mjs';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const WEEK_CAMP_ACTIVITY_ID = '509bdac0-30fd-400c-a03b-889eb2c80e62';
const APPLY = process.argv.includes('--apply');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function loadMultiDayConfig() {
  const { data, error } = await supabase
    .from('booking_activities')
    .select('ticket_settings, duration_minutes')
    .eq('id', WEEK_CAMP_ACTIVITY_ID)
    .single();
  if (error) throw error;
  return parseMultiDaySettings(data?.ticket_settings, data?.duration_minutes) || {
    enabled: true,
    dayCount: 5,
    daysOfWeek: [1, 2, 3, 4, 5],
    dailyDurationMinutes: 480,
  };
}

async function migrateBooking(booking, multiDayConfig) {
  const attendanceDates = computeMultiDayDates(booking.booking_date, multiDayConfig);
  if (attendanceDates.length === 0) {
    throw new Error(`No attendance dates for ${booking.booking_number || booking.id}`);
  }

  if (!APPLY) {
    console.log(`  [dry-run] ${booking.booking_number || booking.id} -> parent + ${attendanceDates.length} days (${attendanceDates.join(', ')})`);
    return;
  }

  const { error: parentUpdateError } = await supabase
    .from('bookings')
    .update({
      multi_day_role: 'parent',
      duration_minutes: multiDayConfig.dailyDurationMinutes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', booking.id);
  if (parentUpdateError) throw parentUpdateError;

  await supabase
    .from('booking_resource_assignments')
    .delete()
    .eq('booking_id', booking.id)
    .eq('business_id', BIZ);

  for (const attendanceDate of attendanceDates) {
    const { data: dayBooking, error: dayError } = await supabase
      .from('bookings')
      .insert({
        business_id: BIZ,
        activity_id: booking.activity_id,
        booking_type_id: booking.booking_type_id,
        customer_id: booking.customer_id,
        customer_email: booking.customer_email,
        customer_phone: booking.customer_phone,
        booking_date: attendanceDate,
        booking_time: booking.booking_time,
        duration_minutes: multiDayConfig.dailyDurationMinutes,
        status: booking.status,
        payment_status: booking.payment_status,
        source: booking.source,
        requires_approval: booking.requires_approval,
        approved_at: booking.approved_at,
        notes: booking.notes
          ? `${booking.notes} | Multi-day attendance ${attendanceDate}`
          : `Multi-day attendance ${attendanceDate}`,
        parent_booking_id: booking.id,
        multi_day_role: 'day',
        cancelled_at: booking.cancelled_at,
        cancellation_reason: booking.cancellation_reason,
      })
      .select('id')
      .single();
    if (dayError) throw dayError;

    await syncDayResourceAssignments(supabase, {
      businessId: BIZ,
      bookingId: dayBooking.id,
      activityId: booking.activity_id,
      bookingDate: attendanceDate,
      bookingTime: booking.booking_time,
    });
  }

  console.log(`  migrated ${booking.booking_number || booking.id} -> ${attendanceDates.length} day rows`);
}

async function main() {
  console.log(`=== OTWK week camp multi-day migration (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);

  const multiDayConfig = await loadMultiDayConfig();

  const { data: candidates, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('business_id', BIZ)
    .eq('activity_id', WEEK_CAMP_ACTIVITY_ID)
    .is('multi_day_role', null)
    .order('booking_date');
  if (error) throw error;

  console.log(`Found ${candidates?.length || 0} week camp bookings to convert`);

  for (const booking of candidates || []) {
    try {
      await migrateBooking(booking, multiDayConfig);
    } catch (err) {
      console.error(`  failed ${booking.booking_number || booking.id}:`, err.message);
    }
  }

  if (APPLY) {
    const { count } = await supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', BIZ)
      .eq('activity_id', WEEK_CAMP_ACTIVITY_ID)
      .eq('multi_day_role', 'day');
    console.log(`Day rows now on week camp activity: ${count}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
