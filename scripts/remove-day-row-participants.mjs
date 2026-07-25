/**
 * Remove duplicate participant rows copied onto multi-day day bookings.
 * Parent booking keeps participants; schedule UI inherits via resolveBookingParticipants.
 *
 * Usage: node scripts/remove-day-row-participants.mjs [--apply]
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const APPLY = process.argv.includes('--apply');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function main() {
  const { data: dayBookings, error } = await supabase
    .from('bookings')
    .select('id, booking_number, parent_booking_id')
    .eq('business_id', BIZ)
    .eq('multi_day_role', 'day');
  if (error) throw error;

  let removed = 0;
  for (const day of dayBookings || []) {
    const { count, error: countErr } = await supabase
      .from('booking_participants')
      .select('*', { count: 'exact', head: true })
      .eq('booking_id', day.id);
    if (countErr) throw countErr;
    if (!count) continue;

    console.log(`${APPLY ? 'remove' : '[dry-run] remove'} ${count} participant(s) from day booking ${day.id.slice(0, 8)}…`);
    if (APPLY) {
      const { error: delErr } = await supabase
        .from('booking_participants')
        .delete()
        .eq('booking_id', day.id);
      if (delErr) throw delErr;
      removed += count;
    } else {
      removed += count;
    }
  }

  console.log(`\n${APPLY ? 'Removed' : 'Would remove'} ${removed} day-row participant row(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
