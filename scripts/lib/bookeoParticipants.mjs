/**
 * Shared Bookeo participant parsing + Tavari linking helpers.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LEGACY_BOOKINGS_DIR = path.join(__dirname, '..', '..', 'Legacy Bookings');

export function parseCsv(text) {
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

export function parseParticipantsFromDetails(detailsText, fallbackNames) {
  const participants = [];
  const text = String(detailsText || '').trim();
  const sections = text.split(/^###\s+/m).filter(Boolean);

  for (const section of sections) {
    const lines = section.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const header = lines[0];
    const nameLine = lines.find((l) => !/@/.test(l) && !/\(\w+\)/.test(l) && !/^\d/.test(l) && l !== header && !/^-- not specified --$/i.test(l));
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
      if (!name || name === ',') continue;
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

export function loadAllBookeoCsvRows() {
  const byRef = new Map();
  if (!fs.existsSync(LEGACY_BOOKINGS_DIR)) return { byRef, idx: {} };

  const files = fs.readdirSync(LEGACY_BOOKINGS_DIR).filter((f) => f.endsWith('.csv'));
  let idx = null;

  for (const file of files) {
    const csv = fs.readFileSync(path.join(LEGACY_BOOKINGS_DIR, file), 'utf8').replace(/^\uFEFF/, '');
    const rows = parseCsv(csv);
    if (!rows.length) continue;
    const fileIdx = Object.fromEntries(rows[0].map((h, i) => [h, i]));
    idx = idx || fileIdx;
    for (const row of rows.slice(1)) {
      const ref = row[fileIdx['Booking number']]?.trim();
      if (ref) byRef.set(ref, row);
    }
  }
  return { byRef, idx: idx || {} };
}

export async function addCustomerParticipant(supabase, businessId, customerId, { firstName, lastName, isMinor }) {
  const { data, error } = await supabase.rpc('bookings_add_portal_participant', {
    p_customer_id: customerId,
    p_business_id: businessId,
    p_first_name: firstName,
    p_last_name: lastName,
    p_date_of_birth: null,
    p_participant_type: isMinor ? 'minor' : 'additional_adult',
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.id || null;
}

export async function linkParticipantsToBooking(supabase, {
  businessId,
  bookingId,
  customerId,
  participants,
  activityName,
  isParty,
}) {
  if (!participants.length || !customerId) return 0;

  let linked = 0;
  for (let i = 0; i < participants.length; i++) {
    const p = participants[i];
    const waiverParticipantId = await addCustomerParticipant(supabase, businessId, customerId, p);
    if (!waiverParticipantId) continue;

    const partyRole = isParty && i === 0 ? 'birthday_child' : isParty && i === 1 ? 'host_adult' : null;
    const { error } = await supabase.from('booking_participants').insert({
      booking_id: bookingId,
      waiver_participant_id: waiverParticipantId,
      waiver_status: 'missing',
      camper_registration_status: /camp/i.test(activityName || '') ? 'missing' : 'not_required',
      party_role: partyRole,
    });
    if (error) throw error;
    linked++;
  }
  return linked;
}

export async function copyParticipantsToDayRows(supabase, parentBookingId) {
  const { data: parentParts, error: parentErr } = await supabase
    .from('booking_participants')
    .select('participant_id, waiver_participant_id, waiver_status, party_role, camper_registration_status, inventory_item_id')
    .eq('booking_id', parentBookingId);
  if (parentErr) throw parentErr;
  if (!parentParts?.length) return 0;

  const { data: dayRows, error: dayErr } = await supabase
    .from('bookings')
    .select('id')
    .eq('parent_booking_id', parentBookingId)
    .eq('multi_day_role', 'day');
  if (dayErr) throw dayErr;
  if (!dayRows?.length) return 0;

  let copied = 0;
  for (const day of dayRows) {
    const { count } = await supabase
      .from('booking_participants')
      .select('*', { count: 'exact', head: true })
      .eq('booking_id', day.id);
    if (count > 0) continue;

    for (const p of parentParts) {
      const { error } = await supabase.from('booking_participants').insert({
        booking_id: day.id,
        participant_id: p.participant_id,
        waiver_participant_id: p.waiver_participant_id,
        waiver_status: p.waiver_status,
        party_role: p.party_role,
        camper_registration_status: p.camper_registration_status,
        inventory_item_id: p.inventory_item_id,
      });
      if (error) throw error;
      copied++;
    }
  }
  return copied;
}
