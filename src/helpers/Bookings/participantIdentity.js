/**
 * Resolve participant ticket / person labels from nested booking_participants joins
 * (booking_customer_participants, waiver_participants, waiver_signatures, mail_contacts via _mail_contact).
 */

export function participantTicketLabel(p) {
  const inv = p?.pos_inventory;
  if (inv && typeof inv === 'object' && !Array.isArray(inv) && inv.name) {
    return String(inv.name).trim();
  }
  if (p?.inventory_item_id) return 'Ticket';
  return 'Guest';
}

export function linkedCustomerParticipant(p) {
  const b = p?.booking_customer_participants;
  if (!b) return null;
  return Array.isArray(b) ? b[0] : b;
}

export function linkedWaiverParticipant(p) {
  const w = p?.waiver_participants;
  if (!w) return null;
  return Array.isArray(w) ? w[0] : w;
}

export function waiverSigViaWaiverId(p) {
  const x = p?.ws_via_waiver_id;
  if (!x) return null;
  return Array.isArray(x) ? x[0] : x;
}

export function waiverSigViaSignatureId(p) {
  const x = p?.ws_via_signature_id;
  if (!x) return null;
  return Array.isArray(x) ? x[0] : x;
}

/** waiver_signatures.id for dashboard `/dashboard/waivers/:id` when participant is linked to a signed waiver. */
export function getViewableWaiverSignatureId(p) {
  if (p?.waiver_id) return p.waiver_id;
  if (p?.waiver_signature_id) return p.waiver_signature_id;
  const sigW = waiverSigViaWaiverId(p);
  const sigS = waiverSigViaSignatureId(p);
  return sigW?.id || sigS?.id || null;
}

export function fullNameFromParts(...parts) {
  const s = parts
    .map((x) => (x == null || x === '' ? '' : String(x).trim()))
    .filter(Boolean)
    .join(' ')
    .trim();
  return s || '';
}

/**
 * Human-readable name for a booking_participants row (never uses email as title).
 * Optional mail marketing match on `_mail_contact` after waiver/profile/signature sources.
 */
export function getParticipantDisplayName(p, index = 0) {
  const bcp = linkedCustomerParticipant(p);
  const wp = linkedWaiverParticipant(p);
  const sigW = waiverSigViaWaiverId(p);
  const sigS = waiverSigViaSignatureId(p);

  const fromRow = fullNameFromParts(p.first_name, p.last_name);
  if (fromRow) return fromRow;

  const fromBcp = fullNameFromParts(bcp?.first_name, bcp?.last_name);
  if (fromBcp) return fromBcp;

  const fromWp = fullNameFromParts(wp?.first_name, wp?.last_name);
  if (fromWp) return fromWp;

  const fromSigW = fullNameFromParts(sigW?.first_name, sigW?.last_name);
  if (fromSigW) return fromSigW;

  const fromSigS = fullNameFromParts(sigS?.first_name, sigS?.last_name);
  if (fromSigS) return fromSigS;

  const fromMail = fullNameFromParts(p._mail_contact?.first_name, p._mail_contact?.last_name);
  if (fromMail) return fromMail;

  const partyRole = String(p?.party_role || '').trim().toLowerCase();
  if (partyRole === 'host_adult' || partyRole === 'birthday_child') {
    return `Guest ${index + 1}`;
  }

  const ticket = participantTicketLabel(p);
  if (ticket && ticket !== 'Guest') return ticket;

  return `Guest ${index + 1}`;
}

const isPlaceholderGuestName = (name) => /^Guest \d+$/i.test(String(name || '').trim());

/**
 * Primary adult / booker label for dashboard cards (party host, first adult, or booker).
 */
export function getBookingAdultDisplayName(booking) {
  const parts = booking?.booking_participants || [];
  const host = parts.find((p) => p.party_role === 'host_adult');
  if (host) {
    const hostName = getParticipantDisplayName(host, 0);
    if (hostName && !isPlaceholderGuestName(hostName)) return hostName;
  }

  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i];
    if (p.party_role === 'birthday_child') continue;
    const { showBadge } = participantMinorFlags(p);
    if (showBadge) continue;
    const name = getParticipantDisplayName(p, i);
    if (name && !isPlaceholderGuestName(name)) return name;
  }

  for (let i = 0; i < parts.length; i += 1) {
    const name = getParticipantDisplayName(parts[i], i);
    if (name && !isPlaceholderGuestName(name)) return name;
  }

  const customerName = fullNameFromParts(booking?.first_name, booking?.last_name)
    || String(booking?.customer_name ?? '').trim();
  if (customerName) return customerName;

  const email = String(booking?.customer_email ?? '').trim();
  const phone = String(booking?.customer_phone ?? '').trim();
  return email || phone || 'Guest';
}

export function getParticipantContactBits(p) {
  const bcp = linkedCustomerParticipant(p);
  const wp = linkedWaiverParticipant(p);
  const sigW = waiverSigViaWaiverId(p);
  const sigS = waiverSigViaSignatureId(p);
  const email = (
    p?.email ||
    bcp?.email ||
    wp?.email ||
    sigW?.email ||
    sigS?.email ||
    p._mail_contact?.email ||
    ''
  ).trim();
  const phone = (
    p?.phone_number ||
    bcp?.phone_number ||
    wp?.phone_number ||
    sigW?.phone_number ||
    sigS?.phone_number ||
    ''
  ).trim();
  const dateOfBirth =
    bcp?.date_of_birth ||
    wp?.date_of_birth ||
    sigW?.date_of_birth ||
    sigS?.date_of_birth ||
    null;
  return { email, phone, dateOfBirth };
}

export function ageYearsFromDob(dobStr) {
  if (!dobStr) return null;
  const d = new Date(dobStr);
  if (Number.isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

export function participantMinorFlags(p) {
  const sigW = waiverSigViaWaiverId(p);
  const sigS = waiverSigViaSignatureId(p);
  const { dateOfBirth } = getParticipantContactBits(p);
  const ageYears = ageYearsFromDob(dateOfBirth);
  const sigMinor = sigW?.is_minor === true || sigS?.is_minor === true;
  const showBadge =
    p.is_minor === true || sigMinor || (ageYears != null && ageYears < 18);
  return { sigW, sigS, ageYears, showBadge };
}

/** Stable identity for deduplication: same person = same key. Prefer IDs over names. */
export function participantIdentityKey(p) {
  const bcpId =
    p?.participant_id
    || p?.booking_customer_participant_id
    || linkedCustomerParticipant(p)?.id
    || null;
  if (bcpId) return `bcp:${bcpId}`;

  const wpId = p?.waiver_participant_id || linkedWaiverParticipant(p)?.id || null;
  if (wpId) return `wp:${wpId}`;

  const first = (p?.first_name || linkedCustomerParticipant(p)?.first_name || linkedWaiverParticipant(p)?.first_name || '').trim().toLowerCase();
  const last = (p?.last_name || linkedCustomerParticipant(p)?.last_name || linkedWaiverParticipant(p)?.last_name || '').trim().toLowerCase();
  const contact = getParticipantContactBits(p);
  const dob = contact.dateOfBirth != null ? String(contact.dateOfBirth).split('T')[0] : '';
  return `${first}|${last}|${dob}`;
}

/**
 * Hard guard: the same person cannot fill more than one attending seat.
 * Prefer stable IDs (participant_id / waiver_participant_id) over display names.
 */
export function assertUniqueBookingParticipantIdentities(rows = []) {
  const seenParticipantIds = new Set();
  const seenWaiverParticipantIds = new Set();
  const seenNameKeys = new Set();
  let anonymousCount = 0;

  for (const row of rows) {
    const participantId = String(row?.participant_id || row?.booking_customer_participant_id || '').trim();
    const waiverParticipantId = String(row?.waiver_participant_id || '').trim();
    const firstName = String(row?.first_name || '').trim().toLowerCase();
    const lastName = String(row?.last_name || '').trim().toLowerCase();
    const dob =
      row?.date_of_birth != null && String(row.date_of_birth).trim()
        ? String(row.date_of_birth).trim().split('T')[0]
        : '';

    if (participantId) {
      if (seenParticipantIds.has(participantId)) {
        return {
          ok: false,
          message:
            'Each attending seat must be a different person. The same participant is linked more than once.',
        };
      }
      seenParticipantIds.add(participantId);
    }

    if (waiverParticipantId) {
      if (seenWaiverParticipantIds.has(waiverParticipantId)) {
        return {
          ok: false,
          message:
            'Each attending seat must be a different person. The same waiver participant is linked more than once.',
        };
      }
      seenWaiverParticipantIds.add(waiverParticipantId);
    }

    if (!participantId && !waiverParticipantId) {
      if (firstName || lastName) {
        const nameKey = `${firstName}|${lastName}|${dob}`;
        if (seenNameKeys.has(nameKey)) {
          return {
            ok: false,
            message:
              'Each attending seat must be a different person. The same name is linked more than once.',
          };
        }
        seenNameKeys.add(nameKey);
      } else {
        anonymousCount += 1;
        if (anonymousCount > 1) {
          return {
            ok: false,
            message:
              'Each attending seat must identify a person. Multiple unnamed seats cannot be verified.',
          };
        }
      }
    }
  }

  return { ok: true };
}

/** Distinct people among booking participants (for waiver / attending counts). */
export function uniqueBookingParticipantIdentities(participants = []) {
  const seen = new Set();
  const unique = [];
  for (const participant of participants || []) {
    const key = participantIdentityKey(participant);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(participant);
  }
  return unique;
}

/** True when every attending seat is a distinct person with a valid (or not-required) waiver. */
export function areDistinctParticipantWaiversVerified(participants = []) {
  const list = Array.isArray(participants) ? participants : [];
  if (list.length === 0) return false;
  const unique = uniqueBookingParticipantIdentities(list);
  // Duplicate seats for the same person must never count as fully verified.
  if (unique.length !== list.length) return false;
  return unique.every(
    (p) => p.waiver_status === 'valid' || p.waiver_status === 'not_required',
  );
}
