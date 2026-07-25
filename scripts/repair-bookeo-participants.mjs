/**
 * Repair Bookeo-import participant names:
 * 1. Re-link participants from CSV when booking has none
 * 2. Copy parent participants onto multi-day day rows (schedule shows day rows)
 *
 * Usage:
 *   node scripts/repair-bookeo-participants.mjs           # dry-run
 *   node scripts/repair-bookeo-participants.mjs --apply
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  loadAllBookeoCsvRows,
  parseParticipantsFromDetails,
  linkParticipantsToBooking,
  copyParticipantsToDayRows,
} from './lib/bookeoParticipants.mjs';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const APPLY = process.argv.includes('--apply');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function main() {
  console.log(`=== Repair Bookeo participants (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

  const { byRef, idx } = loadAllBookeoCsvRows();
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, booking_number, external_reference, customer_id, multi_day_role, parent_booking_id')
    .eq('business_id', BIZ)
    .not('external_reference', 'is', null);
  if (error) throw error;

  let relinked = 0;
  let dayCopies = 0;

  for (const booking of bookings || []) {
    if (booking.multi_day_role === 'day') continue;

    const row = byRef.get(booking.external_reference);
    const { count: partCount } = await supabase
      .from('booking_participants')
      .select('*', { count: 'exact', head: true })
      .eq('booking_id', booking.id);

    if (partCount === 0 && row && booking.customer_id) {
      const participants = parseParticipantsFromDetails(
        row[idx['Participants (details)']],
        row[idx['Participants (names)']],
      );
      const activityName = row[idx.Activity] || '';
      const isParty = /birthday party|party for up to/i.test(activityName);
      if (participants.length) {
        console.log(`  ${APPLY ? 'link' : '[dry-run] link'} ${booking.booking_number}: ${participants.map((p) => `${p.firstName} ${p.lastName}`.trim()).join(', ')}`);
        if (APPLY) {
          relinked += await linkParticipantsToBooking(supabase, {
            businessId: BIZ,
            bookingId: booking.id,
            customerId: booking.customer_id,
            participants,
            activityName,
            isParty,
          });
        } else {
          relinked += participants.length;
        }
      }
    }

    if (booking.multi_day_role === 'parent' || !booking.multi_day_role) {
      const { data: days } = await supabase
        .from('bookings')
        .select('id')
        .eq('parent_booking_id', booking.id)
        .eq('multi_day_role', 'day');
      if (days?.length) {
        const { count: parentPartCount } = await supabase
          .from('booking_participants')
          .select('*', { count: 'exact', head: true })
          .eq('booking_id', booking.id);
        if (parentPartCount > 0) {
          let needsCopy = 0;
          for (const day of days) {
            const { count: dayPartCount } = await supabase
              .from('booking_participants')
              .select('*', { count: 'exact', head: true })
              .eq('booking_id', day.id);
            if (dayPartCount === 0) needsCopy += parentPartCount;
          }
          if (needsCopy > 0) {
            console.log(`  ${APPLY ? 'copy' : '[dry-run] copy'} ${booking.booking_number}: ${needsCopy} participant row(s) → ${days.length} day(s)`);
            if (APPLY) {
              dayCopies += await copyParticipantsToDayRows(supabase, booking.id);
            } else {
              dayCopies += needsCopy;
            }
          }
        }
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Participants ${APPLY ? 'linked' : 'to link'}: ${relinked}`);
  console.log(`Day-row copies ${APPLY ? 'created' : 'planned'}: ${dayCopies}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
