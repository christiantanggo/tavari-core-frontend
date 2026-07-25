import {
  computeDisplaySortOrder,
  deriveRoleTag,
  normalizeGuestPhone,
} from "./partyGuestList.ts";

type BookingParticipantRow = {
  id?: string;
  party_role?: string | null;
  waiver_id?: string | null;
  waiver_signature_id?: string | null;
  waiver_status?: string | null;
  is_minor?: boolean | null;
  booking_customer_participants?: {
    first_name?: string | null;
    last_name?: string | null;
    phone_number?: string | null;
  } | Array<{
    first_name?: string | null;
    last_name?: string | null;
    phone_number?: string | null;
  }> | null;
  waiver_participants?: {
    first_name?: string | null;
    last_name?: string | null;
    phone_number?: string | null;
    date_of_birth?: string | null;
  } | Array<{
    first_name?: string | null;
    last_name?: string | null;
    phone_number?: string | null;
    date_of_birth?: string | null;
  }> | null;
  ws_via_waiver_id?: {
    first_name?: string | null;
    last_name?: string | null;
    phone_number?: string | null;
    is_minor?: boolean | null;
    date_of_birth?: string | null;
  } | Array<{
    first_name?: string | null;
    last_name?: string | null;
    phone_number?: string | null;
    is_minor?: boolean | null;
    date_of_birth?: string | null;
  }> | null;
  ws_via_signature_id?: {
    first_name?: string | null;
    last_name?: string | null;
    phone_number?: string | null;
    is_minor?: boolean | null;
    date_of_birth?: string | null;
  } | Array<{
    first_name?: string | null;
    last_name?: string | null;
    phone_number?: string | null;
    is_minor?: boolean | null;
    date_of_birth?: string | null;
  }> | null;
};

const firstRelation = <T>(value: T | T[] | null | undefined): T | null => {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
};

const mapWaiverStatus = (waiverStatus: string | null | undefined) => {
  const status = String(waiverStatus || "").toLowerCase();
  if (status === "valid") return "verified";
  if (status === "expired") return "expired";
  if (status === "missing") return "missing";
  return "not_verified";
};

const guestEntryIdentityKey = (entry: { first_name?: string; last_name?: string }) => {
  const first = String(entry.first_name || "").trim().toLowerCase();
  const last = String(entry.last_name || "").trim().toLowerCase();
  return `${first}|${last}`;
};

const guestEntryPreferenceScore = (entry: {
  is_birthday_child?: boolean;
  waiver_status?: string;
  source?: string;
  sort_order?: number;
}) => {
  let score = 0;
  if (entry.is_birthday_child) score += 100;
  if (entry.waiver_status === "verified") score += 50;
  if (entry.source === "staff") score += 10;
  if (entry.source === "host") score += 5;
  score -= Number(entry.sort_order) || 0;
  return score;
};

async function removeDuplicateGuestEntries(
  supabase: { from: (table: string) => any },
  guestListId: string,
) {
  const { data: entries } = await supabase
    .from("party_guest_entries")
    .select("id, first_name, last_name, is_birthday_child, waiver_status, source, sort_order")
    .eq("guest_list_id", guestListId);

  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const entry of entries || []) {
    const key = guestEntryIdentityKey(entry as { first_name?: string; last_name?: string });
    if (!key || key === "|") continue;
    const group = groups.get(key) || [];
    group.push(entry as Record<string, unknown>);
    groups.set(key, group);
  }

  const duplicateIds: string[] = [];
  groups.forEach((group) => {
    if (group.length <= 1) return;
    const sorted = [...group].sort((a, b) =>
      guestEntryPreferenceScore(b as {
        is_birthday_child?: boolean;
        waiver_status?: string;
        source?: string;
        sort_order?: number;
      }) -
      guestEntryPreferenceScore(a as {
        is_birthday_child?: boolean;
        waiver_status?: string;
        source?: string;
        sort_order?: number;
      }));
    sorted.slice(1).forEach((entry) => {
      if (entry.id) duplicateIds.push(String(entry.id));
    });
  });

  if (!duplicateIds.length) return;
  await supabase.from("party_guest_entries").delete().in("id", duplicateIds);
}

const getParticipantNameParts = (participant: BookingParticipantRow) => {
  const bcp = firstRelation(participant.booking_customer_participants);
  const wp = firstRelation(participant.waiver_participants);
  const sig = firstRelation(participant.ws_via_waiver_id) || firstRelation(participant.ws_via_signature_id);
  return {
    first_name: String(bcp?.first_name || wp?.first_name || sig?.first_name || "").trim(),
    last_name: String(bcp?.last_name || wp?.last_name || sig?.last_name || "").trim(),
    phone: String(bcp?.phone_number || wp?.phone_number || sig?.phone_number || "").trim(),
    date_of_birth:
      firstRelation(participant.waiver_participants)?.date_of_birth
      || sig?.date_of_birth
      || null,
    is_minor: participant.is_minor === true || sig?.is_minor === true,
  };
};

const isParticipantMinor = (participant: BookingParticipantRow) => {
  if (participant.party_role === "birthday_child") return true;
  const parts = getParticipantNameParts(participant);
  if (parts.is_minor) return true;
  if (parts.date_of_birth) {
    const dob = new Date(parts.date_of_birth);
    if (!Number.isNaN(dob.getTime())) {
      const ageYears = (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (ageYears < 18) return true;
    }
  }
  return false;
};

const participantSortRank = (participant: BookingParticipantRow) => {
  if (participant.party_role === "birthday_child") return 0;
  if (participant.party_role === "host_adult") return 1;
  if (isParticipantMinor(participant)) return 2;
  return 3;
};

const bookingParticipantToGuestEntry = (
  participant: BookingParticipantRow,
  index: number,
  bookerPhone: string,
) => {
  const parts = getParticipantNameParts(participant);
  if (!parts.first_name || !parts.last_name) return null;

  const isBirthdayChild = participant.party_role === "birthday_child";
  const guestType = isBirthdayChild || isParticipantMinor(participant) ? "child" : "adult";
  const isAttending = true;
  const sortOrder = index;

  return {
    guest_type: guestType as "child" | "adult",
    first_name: parts.first_name,
    last_name: parts.last_name,
    parent_last_name: null as string | null,
    household_phone: normalizeGuestPhone(parts.phone || bookerPhone),
    is_attending: isAttending,
    is_birthday_child: isBirthdayChild,
    role_tag: deriveRoleTag({
      guest_type: guestType,
      is_birthday_child: isBirthdayChild,
    }),
    waiver_signature_id: participant.waiver_id || participant.waiver_signature_id || null,
    waiver_status: mapWaiverStatus(participant.waiver_status),
    sort_order: sortOrder,
    display_sort_order: computeDisplaySortOrder({
      guest_type: guestType,
      is_birthday_child: isBirthdayChild,
      is_attending: isAttending,
      sort_order: sortOrder,
    }),
    source: "staff" as const,
  };
};

const BOOKING_PARTICIPANTS_SELECT = `
  id,
  party_role,
  waiver_id,
  waiver_signature_id,
  waiver_status,
  is_minor,
  booking_customer_participants!booking_participants_participant_id_fkey (
    first_name,
    last_name,
    phone_number
  ),
  waiver_participants!booking_participants_waiver_participant_id_fkey (
    first_name,
    last_name,
    phone_number,
    date_of_birth
  ),
  ws_via_waiver_id:waiver_signatures!booking_participants_waiver_id_fkey1 (
    first_name,
    last_name,
    phone_number,
    is_minor,
    date_of_birth
  ),
  ws_via_signature_id:waiver_signatures!booking_participants_waiver_signature_id_fkey (
    first_name,
    last_name,
    phone_number,
    is_minor,
    date_of_birth
  )
`;

export async function syncGuestListFromBookingParticipants(
  supabase: { from: (table: string) => any },
  businessId: string,
  guestListId: string,
  bookingId: string,
  bookerPhone = "",
) {
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(`id, customer_phone, booking_participants (${BOOKING_PARTICIPANTS_SELECT})`)
    .eq("business_id", businessId)
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingError || !booking) return;

  await removeDuplicateGuestEntries(supabase, guestListId);

  const participants = (booking.booking_participants || []) as BookingParticipantRow[];
  if (!participants.length) return;

  const { data: existingEntries } = await supabase
    .from("party_guest_entries")
    .select("id, first_name, last_name, sort_order, is_birthday_child, waiver_status, source")
    .eq("guest_list_id", guestListId);

  const existingKeys = new Set(
    (existingEntries || []).map((entry: { first_name?: string; last_name?: string }) =>
      guestEntryIdentityKey(entry)),
  );

  const phone = normalizeGuestPhone(String(booking.customer_phone || bookerPhone || ""));
  const seenParticipantKeys = new Set<string>();
  const sorted = [...participants]
    .filter((participant) => {
      const parts = getParticipantNameParts(participant);
      const key = guestEntryIdentityKey(parts);
      if (!key || key === "|" || seenParticipantKeys.has(key)) return false;
      seenParticipantKeys.add(key);
      return true;
    })
    .sort((a, b) => {
    const rankDiff = participantSortRank(a) - participantSortRank(b);
    if (rankDiff !== 0) return rankDiff;
    const aName = getParticipantNameParts(a);
    const bName = getParticipantNameParts(b);
    return `${aName.first_name} ${aName.last_name}`.localeCompare(`${bName.first_name} ${bName.last_name}`);
  });

  const candidates = sorted
    .map((participant, index) => bookingParticipantToGuestEntry(participant, index, phone))
    .filter(Boolean) as Array<NonNullable<ReturnType<typeof bookingParticipantToGuestEntry>>>;

  const missing: typeof candidates = [];
  candidates.forEach((entry) => {
    const key = guestEntryIdentityKey(entry);
    if (!key || key === "|" || existingKeys.has(key)) return;
    existingKeys.add(key);
    missing.push(entry);
  });
  if (!missing.length) return;

  const maxSort = Math.max(
    -1,
    ...(existingEntries || []).map((entry: { sort_order?: number }) => Number(entry.sort_order) || 0),
  );

  const rows = missing.map((entry, index) => ({
    guest_list_id: guestListId,
    sort_order: maxSort + 1 + index,
    display_sort_order: entry.display_sort_order,
    guest_type: entry.guest_type,
    first_name: entry.first_name,
    last_name: entry.last_name,
    parent_last_name: entry.parent_last_name,
    household_phone: entry.household_phone,
    role_tag: entry.role_tag,
    is_attending: entry.is_attending,
    is_birthday_child: entry.is_birthday_child,
    waiver_signature_id: entry.waiver_signature_id,
    waiver_status: entry.waiver_status,
    source: entry.source,
  }));

  await supabase.from("party_guest_entries").insert(rows);
  await removeDuplicateGuestEntries(supabase, guestListId);
}

export async function syncGuestListPartyDateFromBooking(
  supabase: { from: (table: string) => any },
  guestListId: string,
  bookingId: string,
): Promise<string | null> {
  const { data: booking } = await supabase
    .from("bookings")
    .select("booking_date")
    .eq("id", bookingId)
    .maybeSingle();

  const bookingDate = booking?.booking_date
    ? String(booking.booking_date).slice(0, 10)
    : null;
  if (!bookingDate) return null;

  const { data: guestList } = await supabase
    .from("party_guest_lists")
    .select("party_date")
    .eq("id", guestListId)
    .maybeSingle();

  const currentDate = guestList?.party_date
    ? String(guestList.party_date).slice(0, 10)
    : null;

  if (currentDate !== bookingDate) {
    await supabase
      .from("party_guest_lists")
      .update({
        party_date: bookingDate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", guestListId);
  }

  return bookingDate;
}

function pickerFullName(first: unknown, last: unknown) {
  return [String(first || "").trim(), String(last || "").trim()].filter(Boolean).join(" ").trim();
}

export async function enrichPartyPickerBookings(
  supabase: { from: (table: string) => any },
  bookings: Array<Record<string, unknown>>,
) {
  if (!bookings.length) return bookings;

  const bookingIds = bookings
    .map((booking) => String(booking.booking_id || "").trim())
    .filter(Boolean);
  if (!bookingIds.length) return bookings;

  const { data: participants } = await supabase
    .from("booking_participants")
    .select(`
      booking_id,
      party_role,
      booking_customer_participants!booking_participants_participant_id_fkey (first_name, last_name),
      waiver_participants!booking_participants_waiver_participant_id_fkey (first_name, last_name),
      ws_via_waiver_id:waiver_signatures!booking_participants_waiver_id_fkey1 (first_name, last_name)
    `)
    .in("booking_id", bookingIds)
    .eq("party_role", "birthday_child");

  const nameByBooking = new Map<string, string>();
  for (const participant of participants || []) {
    const row = participant as BookingParticipantRow;
    const bcp = firstRelation(row.booking_customer_participants);
    const wp = firstRelation(row.waiver_participants);
    const ws = firstRelation(row.ws_via_waiver_id);
    const name = pickerFullName(
      bcp?.first_name || wp?.first_name || ws?.first_name,
      bcp?.last_name || wp?.last_name || ws?.last_name,
    );
    if (name) nameByBooking.set(String(participant.booking_id), name);
  }

  return bookings.map((booking) => {
    const bookingId = String(booking.booking_id || "");
    const existing = String(booking.birthday_child_name || "").trim();
    return {
      ...booking,
      birthday_child_name: existing || nameByBooking.get(bookingId) || null,
    };
  });
}
