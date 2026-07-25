/**
 * Import Bookeo CSV bookings into Tavari for Off The Wall Kids London.
 *
 * Usage:
 *   node scripts/import-bookeo-bookings.mjs              # dry-run (default)
 *   node scripts/import-bookeo-bookings.mjs --apply        # write to database
 *   node scripts/import-bookeo-bookings.mjs --apply --limit 5
 *   node scripts/import-bookeo-bookings.mjs --csv="Legacy Bookings/report_bookingsSept1-Nov30.csv"
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import {
  createMultiDayBookingRows,
  parseMultiDaySettings,
} from './lib/bookingMultiDay.mjs';
import {
  linkParticipantsToBooking,
} from './lib/bookeoParticipants.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const csvArg = process.argv.find((a) => a.startsWith('--csv='));
const CSV_PATH = csvArg
  ? path.resolve(process.cwd(), csvArg.slice('--csv='.length))
  : path.join(__dirname, '..', 'Legacy Bookings', 'report_bookingsJuly4-September31.csv');

const TYPE_IDS = {
  birthday: 'e87ee858-1f8c-4a39-b169-f3e9afbfe97d',
  dropIn: '2676aa5c-54a0-44fa-bd98-1854cd93fbcf',
  dayCamp: '87cb7e10-0e87-43b8-a512-d07243db9117',
};

const ACTIVITY_IDS = {
  dropIn: '59cf5820-0ec2-49d4-b1d3-8c7475d72e47',
  party12: 'ec8c38d6-5e61-4640-9be8-52ea886b5df3',
  party24: 'cfb7c4fb-b0b6-499c-b612-6366a22e56e5',
  party36: '264b29d8-2605-4d7f-ab95-7fd8b933ac0c',
  weekCamp: '509bdac0-30fd-400c-a03b-889eb2c80e62',
};

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : null;

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const WEEK_CAMP_MULTI_DAY = {
  enabled: true,
  dayCount: 5,
  daysOfWeek: [1, 2, 3, 4, 5],
  dailyDurationMinutes: 480,
};

async function loadWeekCampMultiDayConfig() {
  if (!ACTIVITY_IDS.weekCamp) return WEEK_CAMP_MULTI_DAY;
  const { data } = await supabase
    .from('booking_activities')
    .select('ticket_settings, duration_minutes')
    .eq('id', ACTIVITY_IDS.weekCamp)
    .maybeSingle();
  return parseMultiDaySettings(data?.ticket_settings, data?.duration_minutes) || WEEK_CAMP_MULTI_DAY;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || (c === '\r' && next === '\n')) {
      row.push(field); rows.push(row); row = []; field = '';
      if (c === '\r') i++;
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseMoney(value) {
  const n = parseFloat(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseBookeoDateTime(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  const [, d, m, y, h, min, ampm] = match;
  let hour = parseInt(h, 10);
  const minute = parseInt(min, 10);
  if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
  if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
  const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  return { date, time };
}

function durationMinutesFromRange(startRaw, endRaw) {
  const start = parseBookeoDateTime(startRaw);
  const end = parseBookeoDateTime(endRaw);
  if (!start || !end) return null;
  const startMs = new Date(`${start.date}T${start.time}`).getTime();
  const endMs = new Date(`${end.date}T${end.time}`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return Math.round((endMs - startMs) / 60000);
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return digits || null;
}

function resolveActivity(row, idx) {
  const activityName = row[idx.Activity]?.trim() || '';
  const p12 = parseInt(row[idx['Party for up to 12 Kids']] || '0', 10) || 0;
  const p24 = parseInt(row[idx['Party for up to 24 Kids']] || '0', 10) || 0;
  const p36 = parseInt(row[idx['Party for up to 36 Kids:']] || '0', 10) || 0;

  if (/up to 36/i.test(activityName) || p36 > 0) {
    return { activityId: ACTIVITY_IDS.party36, typeId: TYPE_IDS.birthday, isParty: true };
  }
  if (/up to 24/i.test(activityName) || p24 > 0) {
    return { activityId: ACTIVITY_IDS.party24, typeId: TYPE_IDS.birthday, isParty: true };
  }
  if (/birthday party/i.test(activityName) || p12 > 0) {
    return { activityId: ACTIVITY_IDS.party12, typeId: TYPE_IDS.birthday, isParty: true };
  }
  if (/drop-in/i.test(activityName)) {
    return { activityId: ACTIVITY_IDS.dropIn, typeId: TYPE_IDS.dropIn, isParty: false };
  }
  if (/week long summer camp/i.test(activityName)) {
    return { activityId: ACTIVITY_IDS.weekCamp, typeId: TYPE_IDS.dayCamp, isParty: false };
  }
  if (/single days.*summer camp/i.test(activityName)) {
    return { activityId: ACTIVITY_IDS.singleDayCamp, typeId: TYPE_IDS.dayCamp, isParty: false };
  }
  if (/pa\s*day.*camp/i.test(activityName)) {
    return { activityId: ACTIVITY_IDS.paDayCamp, typeId: TYPE_IDS.dayCamp, isParty: false };
  }
  if (/community partner/i.test(activityName)) {
    return { activityId: ACTIVITY_IDS.communityPartner, typeId: TYPE_IDS.dropIn, isParty: false };
  }
  return null;
}

function mapStatus(row, idx) {
  const canceledAt = row[idx.Canceled]?.trim();
  const bookingStatus = (row[idx['Booking status']] || row[idx.Status] || '').trim().toLowerCase();
  if (canceledAt || bookingStatus === 'canceled' || bookingStatus === 'cancelled') {
    return { status: 'cancelled', cancelledAt: canceledAt || null };
  }
  return { status: 'confirmed', cancelledAt: null };
}

function mapPaymentStatus(totalPaid, totalDue) {
  if (totalDue <= 0 && totalPaid > 0) return 'paid';
  if (totalPaid > 0 && totalDue > 0) return 'partial';
  if (totalPaid <= 0 && totalDue <= 0) return 'paid';
  return 'unpaid';
}

function parseParticipantsFromDetails(detailsText, fallbackNames) {
  const participants = [];
  const text = String(detailsText || '').trim();
  const sections = text.split(/^###\s+/m).filter(Boolean);

  for (const section of sections) {
    const lines = section.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const header = lines[0];
    const nameLine = lines.find((l) => !/@/.test(l) && !/\(\w+\)/.test(l) && !/^\d/.test(l) && l !== header);
    const emailLine = lines.find((l) => /@/.test(l));
    const phoneLine = lines.find((l) => /\(\w+\)/.test(l) || /^\d{10,}$/.test(l.replace(/\D/g, '')));

    let firstName = '';
    let lastName = '';
    if (nameLine) {
      const parts = nameLine.split(/\s+/);
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ') || '';
    }

    participants.push({
      ticketType: header.replace(/\s+\d+:$/, '').trim(),
      firstName,
      lastName,
      email: emailLine || null,
      phoneNumber: phoneLine ? normalizePhone(phoneLine) : null,
      isMinor: /child|baby|aged|months|kid/i.test(header),
    });
  }

  if (!participants.length && fallbackNames) {
    for (const name of String(fallbackNames).split(',').map((n) => n.trim()).filter(Boolean)) {
      const parts = name.split(/\s+/);
      participants.push({
        ticketType: null,
        firstName: parts[0] || '',
        lastName: parts.slice(1).join(' ') || '',
        email: null,
        phoneNumber: null,
        isMinor: false,
      });
    }
  }

  return participants;
}

async function loadActivityIdMap() {
  const { data, error } = await supabase
    .from('booking_activities')
    .select('id, activity_name')
    .eq('business_id', BIZ);
  if (error) throw error;
  const byName = Object.fromEntries((data || []).map((a) => [a.activity_name, a.id]));
  ACTIVITY_IDS.singleDayCamp = byName['SINGLE DAYS - Summer Camp 2026'] || null;
  ACTIVITY_IDS.paDayCamp = byName['PA DAY - Day Camp 2026-2027']
    || byName['PA Day - Day Camp 2026-2027']
    || byName['PA Day - Day Camp 2025-2026']
    || null;
  ACTIVITY_IDS.communityPartner = byName['Community Partner Night'] || null;

  const missing = [];
  if (!ACTIVITY_IDS.singleDayCamp) missing.push('SINGLE DAYS - Summer Camp 2026');
  if (!ACTIVITY_IDS.paDayCamp) missing.push('PA DAY - Day Camp 2026-2027');
  if (!ACTIVITY_IDS.communityPartner) missing.push('Community Partner Night');
  if (missing.length) {
    throw new Error(`Missing activities: ${missing.join(', ')}. Run setup-otwk-bookeo-import-activities.mjs first.`);
  }
}

async function getOrCreateCustomer({ firstName, lastName, email, phone, externalRef }) {
  const normalizedPhone = normalizePhone(phone);
  const phoneForRpc = normalizedPhone
    || (email && externalRef ? `555${String(externalRef).slice(-7).padStart(7, '0')}` : null);
  if (!phoneForRpc && !email) return null;

  const { data, error } = await supabase.rpc('bookings_create_or_get_portal_customer', {
    p_business_id: BIZ,
    p_phone_number: phoneForRpc || '',
    p_email: email || `${phoneForRpc || 'import'}@bookeo-import.local`,
    p_first_name: firstName || 'Guest',
    p_last_name: lastName || '',
    p_city: null,
  });
  if (error) throw error;
  const customer = Array.isArray(data) ? data[0] : data;
  return customer?.id || null;
}

async function existingExternalRef(ref) {
  const { data, error } = await supabase
    .from('bookings')
    .select('id, booking_number')
    .eq('business_id', BIZ)
    .eq('external_reference', ref)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function importRow(row, idx, stats) {
  const externalRef = row[idx['Booking number']]?.trim();
  if (!externalRef) {
    stats.skipped++;
    stats.errors.push('missing booking number');
    return;
  }

  const existing = await existingExternalRef(externalRef);
  if (existing) {
    stats.skipped++;
    stats.skippedExisting.push(externalRef);
    return;
  }

  const activity = resolveActivity(row, idx);
  if (!activity) {
    stats.skipped++;
    stats.errors.push(`${externalRef}: unmapped activity "${row[idx.Activity]?.trim()}"`);
    return;
  }

  const start = parseBookeoDateTime(row[idx.Start]);
  if (!start) {
    stats.skipped++;
    stats.errors.push(`${externalRef}: invalid start datetime "${row[idx.Start]}"`);
    return;
  }

  const { status, cancelledAt } = mapStatus(row, idx);
  const totalGross = parseMoney(row[idx['Total gross']]);
  const totalPaid = parseMoney(row[idx['Total paid']]);
  const totalDue = parseMoney(row[idx['Total due']]);
  const hst = parseMoney(row[idx.HST]);
  const gst = parseMoney(row[idx.GST]);
  const pst = parseMoney(row[idx.PST]);
  const taxAmount = hst + gst + pst;
  const durationMinutes = durationMinutesFromRange(row[idx.Start], row[idx.End]);
  const isWeekCamp = activity.activityId === ACTIVITY_IDS.weekCamp;
  const effectiveDuration = isWeekCamp ? WEEK_CAMP_MULTI_DAY.dailyDurationMinutes : durationMinutes;

  const firstName = row[idx['First name']]?.trim() || '';
  const lastName = row[idx['Last name']]?.trim() || '';
  const email = row[idx['Email address']]?.trim() || null;
  const phone = row[idx.Phone]?.trim() || null;

  const participants = parseParticipantsFromDetails(
    row[idx['Participants (details)']],
    row[idx['Participants (names)']],
  );

  const bookeoNote = [
    `Bookeo import #${externalRef}`,
    row[idx['Booking status']]?.trim() ? `Bookeo status: ${row[idx['Booking status']].trim()}` : null,
    row[idx.Source]?.trim() ? `Source: ${row[idx.Source].trim()}` : null,
  ].filter(Boolean).join(' | ');

  if (!APPLY) {
    stats.planned++;
    console.log(`  [dry-run] ${externalRef} | ${row[idx.Activity]?.trim()} | ${start.date} ${start.time} | ${status} | paid $${totalPaid.toFixed(2)} | ${participants.length} participants`);
    return;
  }

  const customerId = await getOrCreateCustomer({ firstName, lastName, email, phone, externalRef });

  const { data: bookingNumber, error: numberError } = await supabase.rpc('generate_booking_number', {
    business_uuid: BIZ,
  });
  if (numberError) throw numberError;

  const bookingRecord = {
    booking_number: bookingNumber,
    customer_id: customerId,
    customer_email: email,
    customer_phone: normalizePhone(phone),
    booking_date: start.date,
    booking_time: start.time,
    duration_minutes: effectiveDuration,
    status,
    payment_status: mapPaymentStatus(totalPaid, totalDue),
    source: 'staff',
    requires_approval: false,
    approved_at: activity.isParty && status === 'confirmed' ? new Date().toISOString() : null,
    notes: bookeoNote,
    external_reference: externalRef,
    order_total: totalGross,
    tax_amount: taxAmount,
    cancelled_at: cancelledAt ? new Date().toISOString() : null,
    cancellation_reason: cancelledAt ? 'Imported from Bookeo as cancelled' : null,
  };

  let booking;
  if (isWeekCamp) {
    const multiDayConfig = await loadWeekCampMultiDayConfig();
    booking = await createMultiDayBookingRows(supabase, {
      businessId: BIZ,
      activityId: activity.activityId,
      bookingTypeId: activity.typeId,
      multiDayConfig,
      anchorDate: start.date,
      bookingTime: start.time,
      parentRecord: bookingRecord,
    });
  } else {
    const { data, error: bookingError } = await supabase
      .from('bookings')
      .insert({
        ...bookingRecord,
        business_id: BIZ,
        activity_id: activity.activityId,
        booking_type_id: activity.typeId,
      })
      .select('id, booking_number')
      .single();
    if (bookingError) throw bookingError;
    booking = data;
    await supabase.rpc('generate_booking_qr_code', { booking_uuid: booking.id });
  }

  if (participants.length > 0 && customerId) {
    try {
      await linkParticipantsToBooking(supabase, {
        businessId: BIZ,
        bookingId: booking.id,
        customerId,
        participants,
        activityName: row[idx.Activity]?.trim() || '',
        isParty: activity.isParty,
      });
    } catch (pErr) {
      console.warn(`  participants warning ${externalRef}:`, pErr.message);
    }
  }

  if (totalPaid > 0) {
    const { error: payErr } = await supabase.from('booking_payments').insert({
      booking_id: booking.id,
      payment_type: totalDue > 0 ? 'deposit' : 'full',
      amount_paid: totalPaid,
      deposit_amount: totalDue > 0 ? totalPaid : null,
      remaining_balance: totalDue > 0 ? totalDue : 0,
      payment_method: 'manual',
      transaction_id: `bookeo-${externalRef}`,
      status: 'completed',
    });
    if (payErr) console.warn(`  payment warning ${externalRef}:`, payErr.message);
  }

  stats.imported++;
  console.log(`  imported ${booking.booking_number} (Bookeo ${externalRef})`);
}

async function main() {
  console.log(`=== Bookeo import (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
  console.log(`CSV: ${CSV_PATH}`);
  if (!fs.existsSync(CSV_PATH)) throw new Error(`CSV not found: ${CSV_PATH}`);

  await loadActivityIdMap();

  const csv = fs.readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCsv(csv);
  const headers = rows[0];
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const dataRows = rows.slice(1).filter((r) => r.some((c) => String(c || '').trim()));

  const stats = { planned: 0, imported: 0, skipped: 0, skippedExisting: [], errors: [] };
  const toProcess = LIMIT ? dataRows.slice(0, LIMIT) : dataRows;

  console.log(`Processing ${toProcess.length} of ${dataRows.length} rows...\n`);

  for (const row of toProcess) {
    try {
      await importRow(row, idx, stats);
    } catch (err) {
      stats.skipped++;
      stats.errors.push(`${row[idx['Booking number']] || '?'}: ${err.message}`);
      console.error('  error:', err.message);
    }
  }

  console.log('\n--- Summary ---');
  console.log(APPLY ? `Imported: ${stats.imported}` : `Would import: ${stats.planned}`);
  console.log(`Skipped: ${stats.skipped}`);
  if (stats.skippedExisting.length) console.log(`Already imported: ${stats.skippedExisting.length}`);
  if (stats.errors.length) {
    console.log('Issues:');
    stats.errors.forEach((e) => console.log('  -', e));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
