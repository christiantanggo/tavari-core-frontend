/**
 * Random end-to-end spot check of Bookeo-imported bookings vs CSV source.
 * Usage: node scripts/verify-bookeo-spot-check.mjs [--seed=123]
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const CSV_PATH = path.join(__dirname, '..', 'Legacy Bookings', 'report_bookingsJuly4-September31.csv');
const SAMPLE_SIZE = 3;

const seedArg = process.argv.find((a) => a.startsWith('--seed='));
const SEED = seedArg ? Number(seedArg.split('=')[1]) : Date.now();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

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
  const match = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  const [, d, m, y, h, min, ampm] = match;
  let hour = parseInt(h, 10);
  const minute = parseInt(min, 10);
  if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
  if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
  return {
    date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`,
  };
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return digits || null;
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickDiverseSamples(bookings, rand) {
  const buckets = {
    party: [],
    weekCamp: [],
    other: [],
  };
  for (const b of bookings) {
    const name = (b.activity?.activity_name || '').toLowerCase();
    if (/party|birthday/.test(name)) buckets.party.push(b);
    else if (/week long/.test(name)) buckets.weekCamp.push(b);
    else buckets.other.push(b);
  }
  const picks = [];
  for (const key of ['party', 'weekCamp', 'other']) {
    const shuffled = shuffle(buckets[key], rand);
    if (shuffled.length) picks.push(shuffled[0]);
  }
  if (picks.length >= SAMPLE_SIZE) return picks.slice(0, SAMPLE_SIZE);
  const used = new Set(picks.map((p) => p.id));
  const rest = shuffle(bookings.filter((b) => !used.has(b.id)), rand);
  return [...picks, ...rest].slice(0, SAMPLE_SIZE);
}

function expect(label, actual, expected, issues, tolerance = 0) {
  const pass = tolerance
    ? Math.abs(Number(actual) - Number(expected)) <= tolerance
    : actual === expected;
  if (!pass) issues.push({ field: label, expected, actual });
  return pass;
}

function csvFoodLines(row, idx) {
  const foodCols = [
    'Juice Box', 'Medium Cheese Pizza (8 Slices)', 'Medium Pepperoni Pizza (8 Slices)',
    'Pepsi Fountain (Pitcher)', 'French Fry Bowl', 'Character Mascot', 'Breakfast Platter',
    'Chicken Nugget (36) & Fry Platter', 'Hot dog (12) & Fry Platter', 'Fruit Tray',
  ];
  const lines = [];
  for (const col of Object.keys(idx)) {
    if (!/juice|pizza|pepsi|platter|fry|mascot|chip|fruit|vegetable|balloon|nugget|hot dog|breakfast|gold/i.test(col)) continue;
    const qty = parseInt(row[idx[col]] || '0', 10) || 0;
    if (qty > 0) lines.push({ column: col, qty });
  }
  // dedupe by using all food-like columns from idx
  const all = [];
  for (const [col, colIdx] of Object.entries(idx)) {
    if (!/juice|pizza|pepsi|platter|fry|mascot|chip|fruit|vegetable|balloon|nugget|hot dog|breakfast|gold|waffle|drop|pick|host/i.test(col)) continue;
    const qty = parseInt(row[colIdx] || '0', 10) || 0;
    if (qty > 0) all.push({ column: col, qty });
  }
  return all;
}

async function loadBookingDetails(bookingId) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select(`
      id, booking_number, external_reference, booking_date, booking_time,
      duration_minutes, status, payment_status, order_total, tax_amount,
      customer_email, customer_phone, notes, cancelled_at, multi_day_role,
      parent_booking_id, activity_id,
      activity:booking_activities ( activity_name ),
      participants:booking_participants (
        waiver_status, camper_registration_status,
        booking_customer_participants ( first_name, last_name, email, phone_number )
      ),
      payments:booking_payments ( amount_paid, remaining_balance, payment_type, status, transaction_id ),
      addon_items:booking_addon_items (
        quantity, unit_price,
        addon:booking_addons ( addon_name, addon_key )
      )
    `)
    .eq('id', bookingId)
    .single();
  if (error) throw error;

  let childDays = [];
  if (booking.multi_day_role === 'parent' || !booking.multi_day_role) {
    const { data: days } = await supabase
      .from('bookings')
      .select('id, booking_date, booking_time, multi_day_role, status')
      .eq('parent_booking_id', bookingId)
      .order('booking_date');
    childDays = days || [];
  }

  return { booking, childDays };
}

function verifyBooking(booking, childDays, csvRow, idx) {
  const issues = [];
  const extRef = booking.external_reference;
  const start = parseBookeoDateTime(csvRow[idx.Start]);
  const totalGross = parseMoney(csvRow[idx['Total gross']]);
  const totalPaid = parseMoney(csvRow[idx['Total paid']]);
  const totalDue = parseMoney(csvRow[idx['Total due']]);
  const hst = parseMoney(csvRow[idx.HST]);
  const gst = parseMoney(csvRow[idx.GST]);
  const pst = parseMoney(csvRow[idx.PST]);
  const taxAmount = hst + gst + pst;
  const canceledAt = csvRow[idx.Canceled]?.trim();
  const bookingStatus = (csvRow[idx['Booking status']] || csvRow[idx.Status] || '').trim().toLowerCase();
  const csvStatus = canceledAt || bookingStatus === 'canceled' || bookingStatus === 'cancelled'
    ? 'cancelled' : 'confirmed';
  const csvPayment = totalDue <= 0 && totalPaid > 0 ? 'paid'
    : totalPaid > 0 && totalDue > 0 ? 'partial'
    : totalPaid <= 0 && totalDue <= 0 ? 'paid' : 'unpaid';

  expect('external_reference', extRef, csvRow[idx['Booking number']]?.trim(), issues);
  expect('booking_date', booking.booking_date, start?.date, issues);
  expect('booking_time', String(booking.booking_time).slice(0, 8), start?.time, issues);
  expect('status', booking.status, csvStatus, issues);
  expect('payment_status', booking.payment_status, csvPayment, issues);
  expect('order_total', Number(booking.order_total), totalGross, issues, 0.02);
  expect('tax_amount', Number(booking.tax_amount), taxAmount, issues, 0.02);
  expect('customer_email', (booking.customer_email || '').toLowerCase(), (csvRow[idx['Email address']] || '').trim().toLowerCase(), issues);
  expect('customer_phone', booking.customer_phone, normalizePhone(csvRow[idx.Phone]), issues);

  const payment = (booking.payments || [])[0];
  if (totalPaid > 0) {
    if (!payment) issues.push({ field: 'payment_row', expected: `paid $${totalPaid}`, actual: 'missing' });
    else {
      expect('payment.amount_paid', Number(payment.amount_paid), totalPaid, issues, 0.02);
      expect('payment.transaction_id', payment.transaction_id, `bookeo-${extRef}`, issues);
      expect('payment.status', payment.status, 'completed', issues);
    }
  }

  const csvActivity = csvRow[idx.Activity]?.trim() || '';
  const tavariActivity = booking.activity?.activity_name || '';
  if (!tavariActivity.toLowerCase().includes('party') && /party/i.test(csvActivity)) {
    issues.push({ field: 'activity', expected: csvActivity, actual: tavariActivity });
  } else if (/week long/i.test(csvActivity) && !/week long/i.test(tavariActivity)) {
    issues.push({ field: 'activity', expected: csvActivity, actual: tavariActivity });
  } else if (/drop-in/i.test(csvActivity) && !/drop/i.test(tavariActivity)) {
    issues.push({ field: 'activity', expected: csvActivity, actual: tavariActivity });
  }

  if (/week long/i.test(csvActivity)) {
    if (childDays.length !== 5) {
      issues.push({ field: 'week_camp_day_rows', expected: 5, actual: childDays.length });
    }
    const csvEnd = parseBookeoDateTime(csvRow[idx.End]);
    if (csvEnd && childDays.length) {
      const lastDay = childDays[childDays.length - 1]?.booking_date;
      expect('week_camp_last_day', lastDay, csvEnd.date, issues);
    }
  }

  const csvFood = csvFoodLines(csvRow, idx);
  const tavariAddons = booking.addon_items || [];
  const tavariAddonQty = tavariAddons.reduce((s, a) => s + (a.quantity || 0), 0);
  const csvFoodQty = csvFood.reduce((s, f) => s + f.qty, 0);
  if (csvFoodQty > 0) {
    if (tavariAddons.length === 0) {
      issues.push({ field: 'food_addons', expected: `${csvFood.length} line(s), ${csvFoodQty} units`, actual: 'none' });
    } else {
      // Rough qty check — merged lines may differ in count but total units should be close
      if (Math.abs(tavariAddonQty - csvFoodQty) > 2) {
        issues.push({ field: 'food_addon_qty', expected: csvFoodQty, actual: tavariAddonQty });
      }
    }
  }

  const notesOk = String(booking.notes || '').includes(`Bookeo import #${extRef}`);
  if (!notesOk) issues.push({ field: 'notes', expected: `contains Bookeo import #${extRef}`, actual: booking.notes });

  return { issues, csvFood, tavariAddons, csvActivity, tavariActivity, start, totalGross, totalPaid, csvStatus };
}

async function main() {
  console.log(`=== Bookeo spot-check (seed ${SEED}) ===\n`);

  const csv = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(csv);
  const headers = rows[0];
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const csvByRef = new Map();
  for (const row of rows.slice(1)) {
    const ref = row[idx['Booking number']]?.trim();
    if (ref) csvByRef.set(ref, row);
  }

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select(`
      id, booking_number, external_reference, activity_id, multi_day_role,
      activity:booking_activities ( activity_name )
    `)
    .eq('business_id', BIZ)
    .not('external_reference', 'is', null)
    .or('multi_day_role.is.null,multi_day_role.eq.parent');
  if (error) throw error;

  const rand = mulberry32(SEED);
  const samples = pickDiverseSamples(bookings || [], rand);

  console.log(`Checking ${samples.length} bookings from ${bookings.length} Bookeo imports:\n`);

  let allPass = true;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const { booking, childDays } = await loadBookingDetails(sample.id);
    const csvRow = csvByRef.get(booking.external_reference);
    if (!csvRow) {
      console.log(`${i + 1}. ${booking.booking_number} — CSV row NOT FOUND`);
      allPass = false;
      continue;
    }

    const result = verifyBooking(booking, childDays, csvRow, idx);
    const pass = result.issues.length === 0;
    if (!pass) allPass = false;

    console.log(`${i + 1}. ${booking.booking_number} (Bookeo #${booking.external_reference})`);
    console.log(`   Activity: ${result.tavariActivity}`);
    console.log(`   Date/time: ${booking.booking_date} ${String(booking.booking_time).slice(0, 5)} | Status: ${booking.status} | Payment: ${booking.payment_status}`);
    console.log(`   Total: $${Number(booking.order_total).toFixed(2)} (CSV gross $${result.totalGross.toFixed(2)}) | Paid: $${result.totalPaid.toFixed(2)}`);
    console.log(`   Participants: ${(booking.participants || []).length} | Payments: ${(booking.payments || []).length} | Food add-ons: ${(booking.addon_items || []).length}`);
    if (childDays.length) console.log(`   Week-camp day rows: ${childDays.length} (${childDays.map((d) => d.booking_date).join(', ')})`);
    if (result.csvFood.length) {
      console.log(`   CSV food: ${result.csvFood.map((f) => `${f.qty}× ${f.column}`).join('; ')}`);
      console.log(`   Tavari food: ${(booking.addon_items || []).map((a) => `${a.quantity}× ${a.addon?.addon_name}`).join('; ')}`);
    }
    console.log(`   Result: ${pass ? '✓ PASS' : '✗ FAIL'}`);
    if (result.issues.length) {
      for (const issue of result.issues) {
        console.log(`     - ${issue.field}: expected ${JSON.stringify(issue.expected)}, got ${JSON.stringify(issue.actual)}`);
      }
    }
    console.log('');
  }

  console.log(allPass ? 'Overall: ALL SPOT CHECKS PASSED' : 'Overall: ISSUES FOUND — review above');
  process.exitCode = allPass ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
