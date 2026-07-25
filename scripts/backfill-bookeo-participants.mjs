/**
 * Backfill booking participants for Bookeo imports (uses booking_customer_participants + participant_id link).
 *
 * Run: node scripts/backfill-bookeo-participants.mjs [--csv=path/to/file.csv]
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const csvArg = process.argv.find((a) => a.startsWith('--csv='));
const CSV_PATH = csvArg
  ? path.resolve(process.cwd(), csvArg.slice('--csv='.length))
  : path.join(__dirname, '..', 'Legacy Bookings', 'report_bookingsJuly4-September31.csv');

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

function parseParticipantsFromDetails(detailsText, fallbackNames) {
  const participants = [];
  const text = String(detailsText || '').trim();
  const sections = text.split(/^###\s+/m).filter(Boolean);

  for (const section of sections) {
    const lines = section.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const header = lines[0];
    const nameLine = lines.find((l) => !/@/.test(l) && !/\(\w+\)/.test(l) && !/^\d/.test(l) && l !== header);
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
        isMinor: false,
      });
    }
  }
  return participants.filter((p) => p.firstName || p.lastName);
}

async function addCustomerParticipant(customerId, firstName, lastName, isMinor) {
  const rpc = isMinor ? 'bookings_add_portal_participant' : 'bookings_add_portal_participant';
  const { data, error } = await supabase.rpc(rpc, {
    p_customer_id: customerId,
    p_business_id: BIZ,
    p_first_name: firstName,
    p_last_name: lastName,
    p_date_of_birth: null,
    p_participant_type: isMinor ? 'minor' : 'additional_adult',
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.id || null;
}

async function main() {
  console.log(`CSV: ${CSV_PATH}`);
  const csv = fs.readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCsv(csv);
  const headers = rows[0];
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const byRef = new Map(rows.slice(1).map((r) => [r[idx['Booking number']]?.trim(), r]));

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, external_reference, customer_id, activity_id')
    .eq('business_id', BIZ)
    .not('external_reference', 'is', null);
  if (error) throw error;

  let linked = 0;
  let skipped = 0;

  for (const booking of bookings || []) {
    const { count: existingCount } = await supabase
      .from('booking_participants')
      .select('*', { count: 'exact', head: true })
      .eq('booking_id', booking.id);
    if (existingCount > 0) { skipped++; continue; }

    const row = byRef.get(booking.external_reference);
    if (!row || !booking.customer_id) continue;

    const participants = parseParticipantsFromDetails(
      row[idx['Participants (details)']],
      row[idx['Participants (names)']],
    );
    if (!participants.length) continue;

    const isParty = /birthday party/i.test(row[idx.Activity] || '');

    for (let i = 0; i < participants.length; i++) {
      const p = participants[i];
      const participantId = await addCustomerParticipant(
        booking.customer_id,
        p.firstName,
        p.lastName,
        p.isMinor,
      );
      if (!participantId) continue;

      const partyRole = isParty && i === 0 ? 'birthday_child' : isParty && i === 1 ? 'host' : null;
      const { error: linkErr } = await supabase.from('booking_participants').insert({
        booking_id: booking.id,
        waiver_participant_id: participantId,
        waiver_status: 'missing',
        camper_registration_status: /camp/i.test(row[idx.Activity] || '') ? 'missing' : 'not_required',
        party_role: partyRole,
      });
      if (linkErr) console.warn(booking.external_reference, linkErr.message);
      else linked++;
    }
  }

  console.log(`Backfill complete: ${linked} participant links, ${skipped} bookings already had participants`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
