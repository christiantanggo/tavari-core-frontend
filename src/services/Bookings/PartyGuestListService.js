import { supabase } from '../../supabaseClient';
import {
  buildGuestEntriesFromBookingParticipants,
  dedupeGuestEntriesByIdentity,
  findMissingGuestEntries,
  participantHasResolvableName,
} from '../../helpers/Bookings/partyGuestListFromParticipants';
import { normalizePhoneDigits } from '../../utils/waiverExistingViewerAccess';
import {
  DEFAULT_PARTY_GUEST_OVERAGE_FOOD,
  DEFAULT_PARTY_GUEST_OVERAGE_PAYMENT,
  DEFAULT_PARTY_GUEST_OVERAGE_SOCKS,
} from '../../utils/partyGuestList';

const FN = 'tavari-api-party-guest-list';

// Note: booking_participants has no is_minor column — minor status comes from linked
// waiver_signatures / DOB helpers (participantMinorFlags).
const BOOKING_PARTICIPANTS_FOR_GUEST_LIST = `
  id,
  party_role,
  waiver_id,
  waiver_signature_id,
  waiver_status,
  waiver_participant_id,
  participant_id,
  booking_customer_participants!booking_participants_participant_id_fkey (
    first_name,
    last_name,
    phone_number,
    date_of_birth
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
    is_minor
  ),
  ws_via_signature_id:waiver_signatures!booking_participants_waiver_signature_id_fkey (
    first_name,
    last_name,
    phone_number,
    is_minor
  )
`;

async function callPartyGuestListApi(businessId, payload, sessionToken = null) {
  const headers = {
    'Content-Type': 'application/json',
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
  };
  if (sessionToken) {
    headers['X-Party-Guest-Session'] = sessionToken;
  }

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${FN}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      businessId,
      ...payload,
      ...(sessionToken ? { sessionToken } : {}),
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data;
}

class PartyGuestListService {
  constructor() {
    this.syncInFlight = new Map();
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  async sendOtp(phoneNumber, email = null) {
    return callPartyGuestListApi(this.businessId, {
      action: 'sendOtp',
      phoneNumber: normalizePhoneDigits(phoneNumber),
      email,
    });
  }

  async verifyOtp(phoneNumber, otpCode) {
    return callPartyGuestListApi(this.businessId, {
      action: 'verifyOtp',
      phoneNumber: normalizePhoneDigits(phoneNumber),
      otpCode,
    });
  }

  async selectBooking(phoneNumber, bookingId, sessionToken = null) {
    return callPartyGuestListApi(
      this.businessId,
      {
        action: 'selectBooking',
        phoneNumber: normalizePhoneDigits(phoneNumber),
        bookingId,
      },
      sessionToken,
    );
  }

  async getList(sessionToken) {
    return callPartyGuestListApi(this.businessId, { action: 'getList' }, sessionToken);
  }

  async saveList(sessionToken, entries, preferences = {}, submit = false) {
    const opts = typeof preferences === 'string'
      ? { overagePayment: preferences }
      : preferences;

    return callPartyGuestListApi(
      this.businessId,
      {
        action: submit ? 'submitList' : 'saveList',
        entries,
        overagePayment: opts.overagePayment,
        overageFood: opts.overageFood,
        overageFoodOther: opts.overageFoodOther,
        overageSocks: opts.overageSocks,
      },
      sessionToken,
    );
  }

  async loadSettings() {
    const { data, error } = await supabase
      .from('party_guest_list_settings')
      .select('*')
      .eq('business_id', this.businessId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async loadOverageInventoryItems() {
    const settings = await this.loadSettings();
    const childId = settings?.extra_child_inventory_item_id;
    const adultId = settings?.extra_adult_inventory_item_id;
    const ids = [childId, adultId].filter(Boolean);
    const orFilter = ids.length > 0
      ? [
        'name.ilike.%2-17%',
        'name.ilike.%additional%adult%',
        ...ids.map((id) => `id.eq.${id}`),
      ].join(',')
      : 'name.ilike.%2-17%,name.ilike.%additional%adult%';

    const { data, error } = await supabase
      .from('pos_inventory')
      .select('id, name, price, website_online_price')
      .eq('business_id', this.businessId)
      .or(orFilter)
      .eq('is_active', true);
    if (error) throw error;
    return data || [];
  }

  async saveSettings(settings) {
    const { data, error } = await supabase
      .from('party_guest_list_settings')
      .upsert({ business_id: this.businessId, ...settings, updated_at: new Date().toISOString() })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async listGuestLists({ fromDate, toDate, status } = {}) {
    let q = supabase
      .from('party_guest_lists')
      .select(`
        *,
        bookings (
          id,
          booking_number,
          booking_date,
          booking_time,
          booking_end_time,
          duration_minutes,
          customer_phone,
          booking_resource_assignments ( category_id, resource_id ),
          booking_activities ( activity_name ),
          booking_participants (${BOOKING_PARTICIPANTS_FOR_GUEST_LIST})
        ),
        party_guest_entries (
          id,
          guest_type,
          is_attending,
          waiver_status,
          checked_in_at,
          first_name,
          last_name,
          is_birthday_child
        )
      `)
      .eq('business_id', this.businessId)
      .order('party_date', { ascending: true, nullsFirst: false });

    if (fromDate) q = q.gte('party_date', fromDate);
    if (toDate) q = q.lte('party_date', toDate);
    if (status) q = q.eq('status', status);

    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async _syncGuestListPartyDate(guestList) {
    if (!guestList?.id || !guestList?.booking_id) return guestList;

    const { data: booking, error } = await supabase
      .from('bookings')
      .select('booking_date')
      .eq('id', guestList.booking_id)
      .eq('business_id', this.businessId)
      .maybeSingle();
    if (error) throw error;

    const bookingDate = booking?.booking_date
      ? String(booking.booking_date).slice(0, 10)
      : null;
    if (!bookingDate) return guestList;

    const currentDate = guestList.party_date
      ? String(guestList.party_date).slice(0, 10)
      : null;
    if (currentDate === bookingDate) return guestList;

    const { error: updateError } = await supabase
      .from('party_guest_lists')
      .update({ party_date: bookingDate, updated_at: new Date().toISOString() })
      .eq('id', guestList.id);
    if (updateError) throw updateError;

    return { ...guestList, party_date: bookingDate };
  }

  async getGuestListById(guestListId) {
    const { data: guestList, error } = await supabase
      .from('party_guest_lists')
      .select(`
        *,
        bookings (
          id,
          booking_number,
          booking_date,
          booking_time,
          booking_end_time,
          duration_minutes,
          customer_phone,
          booking_resource_assignments ( category_id, resource_id ),
          booking_activities ( activity_name )
        )
      `)
      .eq('business_id', this.businessId)
      .eq('id', guestListId)
      .single();
    if (error) throw error;

    const { data: entries, error: entriesError } = await supabase
      .from('party_guest_entries')
      .select('*')
      .eq('guest_list_id', guestListId)
      .order('display_sort_order')
      .order('sort_order');
    if (entriesError) throw entriesError;

    const syncedGuestList = await this._syncGuestListPartyDate(guestList);
    return { guestList: syncedGuestList, entries: entries || [] };
  }

  async getGuestListForBooking(bookingId) {
    const { data, error } = await supabase
      .from('party_guest_lists')
      .select('id')
      .eq('business_id', this.businessId)
      .eq('booking_id', bookingId)
      .maybeSingle();
    if (error) throw error;
    if (!data?.id) return null;
    return this.getGuestListById(data.id);
  }

  async ensureGuestListForBooking(booking) {
    return this.syncGuestListFromBookingParticipants(booking);
  }

  async _resolveBookingParticipants(booking) {
    const embedded = booking?.booking_participants || [];
    if (embedded.length > 0 && embedded.some(participantHasResolvableName)) {
      return embedded;
    }

    const { data, error } = await supabase
      .from('bookings')
      .select(`id, customer_phone, booking_participants (${BOOKING_PARTICIPANTS_FOR_GUEST_LIST})`)
      .eq('business_id', this.businessId)
      .eq('id', booking.id)
      .single();
    if (error) throw error;
    return data?.booking_participants || [];
  }

  async syncGuestListFromBookingParticipants(booking, guestListId = null) {
    if (!booking?.id) return null;

    const syncKey = guestListId || booking.id;
    if (this.syncInFlight.has(syncKey)) {
      return this.syncInFlight.get(syncKey);
    }

    const syncPromise = this._syncGuestListFromBookingParticipants(booking, guestListId);
    this.syncInFlight.set(syncKey, syncPromise);
    try {
      return await syncPromise;
    } finally {
      this.syncInFlight.delete(syncKey);
    }
  }

  async _removeDuplicateGuestEntries(guestListId, entries = []) {
    const { duplicateIds } = dedupeGuestEntriesByIdentity(entries);
    if (!duplicateIds.length) return entries;

    const { error } = await supabase
      .from('party_guest_entries')
      .delete()
      .in('id', duplicateIds);
    if (error) throw error;

    const { data: refreshed, error: refreshError } = await supabase
      .from('party_guest_entries')
      .select('*')
      .eq('guest_list_id', guestListId)
      .order('display_sort_order')
      .order('sort_order');
    if (refreshError) throw refreshError;
    return refreshed || [];
  }

  async _resolveGuestListSettingsSnapshot(booking) {
    const settings = await this.loadSettings();
    let activity = null;

    if (booking?.activity_id) {
      const { data: activityRow } = await supabase
        .from('booking_activities')
        .select('party_included_kids, party_included_adults, party_one_adult_per_child')
        .eq('id', booking.activity_id)
        .eq('business_id', this.businessId)
        .maybeSingle();
      activity = activityRow;
    }

    const includedKids = activity?.party_included_kids != null
      ? Number(activity.party_included_kids)
      : (settings?.default_included_kids ?? 12);
    const includedAdults = activity?.party_included_adults != null
      ? Number(activity.party_included_adults)
      : (settings?.default_included_adults ?? 12);
    const oneAdultPerChildEnabled = activity?.party_one_adult_per_child != null
      ? activity.party_one_adult_per_child === true
      : settings?.one_adult_per_child_enabled === true;

    return {
      includedKids,
      includedAdults,
      kidsChairLimit: settings?.kids_chair_limit_per_room ?? 18,
      editDeadlineDays: settings?.edit_deadline_days_before_party ?? 7,
      oneAdultPerChildEnabled,
    };
  }

  async _syncGuestListFromBookingParticipants(booking, guestListId = null) {
    if (!booking?.id) return null;

    let guestListData = guestListId
      ? await this.getGuestListById(guestListId)
      : await this.getGuestListForBooking(booking.id);

    if (!guestListData) {
      const phone = normalizePhoneDigits(booking.customer_phone || '');
      const snapshot = await this._resolveGuestListSettingsSnapshot(booking);
      const { data, error } = await supabase
        .from('party_guest_lists')
        .insert({
          business_id: this.businessId,
          booking_id: booking.id,
          booker_phone: phone || 'unknown',
          booker_customer_id: booking.customer_id || null,
          party_date: booking.booking_date || null,
          overage_payment: DEFAULT_PARTY_GUEST_OVERAGE_PAYMENT,
          overage_food: DEFAULT_PARTY_GUEST_OVERAGE_FOOD,
          overage_socks: DEFAULT_PARTY_GUEST_OVERAGE_SOCKS,
          settings_snapshot: snapshot,
        })
        .select('id')
        .single();
      if (error) throw error;
      guestListData = await this.getGuestListById(data.id);
    }

    const cleanedEntries = await this._removeDuplicateGuestEntries(
      guestListData.guestList.id,
      guestListData.entries || [],
    );
    guestListData = { ...guestListData, entries: cleanedEntries };

    const participants = await this._resolveBookingParticipants(booking);
    if (!participants.length) return guestListData;

    const bookerPhone = booking.customer_phone || guestListData.guestList?.booker_phone || '';
    const candidates = buildGuestEntriesFromBookingParticipants(participants, bookerPhone);
    const missing = findMissingGuestEntries(guestListData.entries || [], candidates);
    if (!missing.length) return guestListData;

    const maxSort = Math.max(
      -1,
      ...(guestListData.entries || []).map((entry) => Number(entry.sort_order) || 0),
    );

    const rows = missing.map((entry, index) => ({
      guest_list_id: guestListData.guestList.id,
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

    const { error: insertError } = await supabase.from('party_guest_entries').insert(rows);
    if (insertError) throw insertError;

    const result = await this.getGuestListById(guestListData.guestList.id);
    const dedupedEntries = await this._removeDuplicateGuestEntries(
      guestListData.guestList.id,
      result.entries || [],
    );
    return { ...result, entries: dedupedEntries };
  }

  async loadGuestListForBooking(booking) {
    return this.syncGuestListFromBookingParticipants(booking);
  }

  async staffSaveEntries(guestListId, entries, preferences = {}) {
    const opts = typeof preferences === 'string'
      ? { overagePayment: preferences }
      : preferences;
    await supabase.from('party_guest_entries').delete().eq('guest_list_id', guestListId);

    if (entries.length) {
      const rows = entries.map((entry, index) => ({
        guest_list_id: guestListId,
        sort_order: entry.sort_order ?? index,
        display_sort_order: entry.display_sort_order ?? index,
        guest_type: entry.guest_type,
        first_name: String(entry.first_name || '').trim(),
        last_name: String(entry.last_name || '').trim(),
        parent_last_name: entry.parent_last_name || null,
        household_phone: normalizePhoneDigits(entry.household_phone || ''),
        role_tag: entry.role_tag || (entry.guest_type === 'adult' ? 'adult' : entry.is_birthday_child ? 'birthday_child' : 'child'),
        is_attending: entry.is_attending !== false,
        is_birthday_child: entry.is_birthday_child === true,
        waiver_signature_id: entry.waiver_signature_id || null,
        waiver_status: entry.waiver_status || 'not_verified',
        waiver_review_note: entry.waiver_review_note || null,
        source: entry.source || 'staff',
      })).filter((r) => r.first_name && r.last_name);

      if (rows.length) {
        const { error } = await supabase.from('party_guest_entries').insert(rows);
        if (error) throw error;
      }
    }

    const update = { updated_at: new Date().toISOString() };
    if (opts.overagePayment) update.overage_payment = opts.overagePayment;
    if (opts.overageFood) {
      update.overage_food = opts.overageFood;
      update.overage_food_other = opts.overageFood === 'other'
        ? String(opts.overageFoodOther || '').trim() || null
        : null;
    } else if (Object.prototype.hasOwnProperty.call(opts, 'overageFoodOther')) {
      update.overage_food_other = String(opts.overageFoodOther || '').trim() || null;
    }
    if (opts.overageSocks) update.overage_socks = opts.overageSocks;

    const { error: listError } = await supabase
      .from('party_guest_lists')
      .update(update)
      .eq('id', guestListId);
    if (listError) throw listError;

    return this.getGuestListById(guestListId);
  }

  async checkInEntry(entryId, checkedIn = true) {
    const { error } = await supabase
      .from('party_guest_entries')
      .update({ checked_in_at: checkedIn ? new Date().toISOString() : null })
      .eq('id', entryId);
    if (error) throw error;
  }

  async addWalkIn(guestListId, entry) {
    const { data: maxRow } = await supabase
      .from('party_guest_entries')
      .select('sort_order')
      .eq('guest_list_id', guestListId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const sortOrder = (maxRow?.sort_order ?? -1) + 1;
    const { data, error } = await supabase
      .from('party_guest_entries')
      .insert({
        guest_list_id: guestListId,
        sort_order: sortOrder,
        display_sort_order: sortOrder,
        guest_type: entry.guest_type || 'adult',
        first_name: entry.first_name,
        last_name: entry.last_name,
        household_phone: normalizePhoneDigits(entry.household_phone || ''),
        role_tag: entry.guest_type === 'child' ? 'child' : 'adult',
        is_attending: true,
        source: 'walk_in',
        waiver_status: 'not_verified',
      })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async refreshWaiverStatuses(guestListId) {
    const { entries } = await this.getGuestListById(guestListId);
    const res = await callPartyGuestListApi(
      this.businessId,
      { action: 'getList' },
      null,
    );
    void res;
    return entries;
  }
}

const partyGuestListService = new PartyGuestListService();
export default partyGuestListService;
