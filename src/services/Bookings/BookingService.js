// src/services/Bookings/BookingService.js
import { supabase } from '../../supabaseClient';
import { fetchPosBusinessSettings } from '../../utils/posSettingsQuery';
import {
  getActivityTicketLimits,
  validateParticipantCountAgainstTicketLimits,
} from '../../utils/bookingTicketAssignment';
import {
  fetchActivitySchedules,
  findMatchingScheduleSlots,
  mergeScheduleResourceAssignments,
  pickSchedulesForActivityOnDate,
} from '../../helpers/Bookings/bookingActivityScheduleHelpers';
import {
  ACTIVE_BOOKING_STATUSES_FOR_RESOURCE,
  resolveConcreteResourceAssignmentsForSchedule,
  filterPeerSchedulesOverlappingWindow,
} from '../../helpers/Bookings/bookingResourceAvailability';
import { listScheduleResourceRequirements } from '../../helpers/Bookings/bookingScheduleResourceRequirements';
import { getBusinessTimezone } from '../../utils/businessDateFormat';
import { buildPortalOptionCheckoutRows } from '../../utils/bookingActivityOptions';
import { extractPortalOptionIdFromAddon } from '../../helpers/Bookings/bookingOptionsDisplay';
import { checkoutBaselineFromFullPricing, computeBookingPricingWithPortalAddonSubtotal, sumPortalBookingAddonTotals } from '../../utils/bookingPricing';
import {
  checkoutBaselineForIndianStatus,
  isBookingIndianStatusActive,
} from '../../utils/bookingIndianStatus';
import {
  BOOKING_HISTORY_ACTIONS,
  describeScheduleChanges,
  describeStatusChanges,
  mergeHistoryWithSyntheticCreated,
  participantLabelFromBooking,
  summarizePortalOptionChanges,
} from '../../helpers/Bookings/bookingHistory';
import { getParticipantDisplayName, participantIdentityKey, assertUniqueBookingParticipantIdentities } from '../../helpers/Bookings/participantIdentity';
import { validateBookingWithinBusinessHours } from '../../helpers/Bookings/businessHoursValidation';
import {
  estimateBookingCapacityUnits,
  fetchEffectiveSlotCapacity,
  validateCategoryCapacity,
  effectiveSpacesLeftFromCapacityContext,
} from '../../helpers/Bookings/bookingCategoryCapacity';
import {
  computeMultiDayDates,
  parseMultiDaySettings,
} from '../../helpers/Bookings/bookingMultiDay';
import { activityUsesPendingTermsOnBooking } from '../../utils/bookingTermsAcknowledgment';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const MISSING_BOOKING_PARTICIPANT_CHECKED_IN_AT =
  'Per-participant check-in requires booking_participants.checked_in_at. Apply supabase/migrations/20260426180000_booking_participant_check_in.sql on your Supabase project, then refresh this page.';

class BookingService {
  constructor() {
    this.businessId = null;
    /**
     * null = unknown; true = booking_participants.checked_in_at exists; false = not migrated yet.
     * Avoids repeated 400s when the column has not been added (run 20260426180000_booking_participant_check_in.sql).
     */
    this._participantCheckedInColumnAvailable = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  async _staffCanOverrideTicketLimits(userId) {
    if (!userId || !this.businessId) return false;
    const elevatedRoles = new Set(['owner', 'manager', 'admin']);

    const { data: userRole } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('business_id', this.businessId)
      .maybeSingle();

    if (userRole?.role && elevatedRoles.has(userRole.role)) {
      return true;
    }

    const { data: businessUser } = await supabase
      .from('business_users')
      .select('role')
      .eq('user_id', userId)
      .eq('business_id', this.businessId)
      .maybeSingle();

    return !!(businessUser?.role && elevatedRoles.has(businessUser.role));
  }

  async _assertBookingTicketLimits(activityId, participantCount, { ticketLimitOverride = false, createdBy = null } = {}) {
    const { data: activity, error } = await supabase
      .from('booking_activities')
      .select('ticket_settings')
      .eq('id', activityId)
      .eq('business_id', this.businessId)
      .maybeSingle();

    if (error) {
      console.error('Error loading activity ticket settings:', error);
      throw error;
    }

    const limits = getActivityTicketLimits(activity?.ticket_settings, 'staff');
    if (!limits.enforced) return;

    let override = false;
    if (ticketLimitOverride && createdBy) {
      override = await this._staffCanOverrideTicketLimits(createdBy);
    }

    const check = validateParticipantCountAgainstTicketLimits(participantCount, limits, { override });
    if (!check.ok) {
      throw new Error(check.message);
    }
  }

  async _loadBusinessHoursContext() {
    const { data, error } = await supabase
      .from('businesses')
      .select('operating_hours, holiday_hours')
      .eq('id', this.businessId)
      .maybeSingle();
    if (error) throw error;
    return data || {};
  }

  async _resolveActivityDurationMinutes(activityId, explicitDuration) {
    if (Number(explicitDuration) > 0) return Number(explicitDuration);
    if (!activityId) return 60;
    const { data } = await supabase
      .from('booking_activities')
      .select('duration_minutes')
      .eq('id', activityId)
      .eq('business_id', this.businessId)
      .maybeSingle();
    const duration = Number(data?.duration_minutes);
    return Number.isFinite(duration) && duration > 0 ? duration : 60;
  }

  async _assertCategoryCapacity({
    activityId,
    bookingDate,
    bookingTime,
    participants = [],
    categoryCapacityOverrideId = null,
    typeKey = null,
  }) {
    let resolvedTypeKey = typeKey;
    if (!resolvedTypeKey) {
      const { data: activityRow } = await supabase
        .from('booking_activities')
        .select('booking_types:type_id ( type_key )')
        .eq('id', activityId)
        .eq('business_id', this.businessId)
        .maybeSingle();
      resolvedTypeKey = activityRow?.booking_types?.type_key || '';
    }

    const unitsRequested = estimateBookingCapacityUnits({
      participants,
      typeKey: resolvedTypeKey,
      fallbackCount: participants?.length || 1,
    });

    const capacityCtx = await fetchEffectiveSlotCapacity({
      businessId: this.businessId,
      activityId,
      bookingDate,
      bookingTime,
    });

    const effectiveRemaining = effectiveSpacesLeftFromCapacityContext(capacityCtx);
    if (effectiveRemaining != null && unitsRequested > effectiveRemaining) {
      const categoryLimited = capacityCtx?.category_enabled === true
        && capacityCtx?.category_bypass_active !== true
        && capacityCtx?.category_remaining != null
        && Number(capacityCtx.category_remaining) <= Number(capacityCtx.slot_remaining ?? effectiveRemaining);

      if (categoryLimited) {
        const categoryCheck = await validateCategoryCapacity({
          businessId: this.businessId,
          activityId,
          bookingDate,
          bookingTime,
          unitsRequested,
          overrideId: categoryCapacityOverrideId,
        });
        if (!categoryCheck?.ok) {
          const err = new Error(categoryCheck.message || 'Category capacity exceeded.');
          err.code = categoryCheck.code || 'category_capacity';
          err.requiresOverride = categoryCheck.requires_override === true;
          err.capacityDetails = categoryCheck;
          throw err;
        }
        return;
      }

      throw new Error(
        capacityCtx?.category_enabled
          ? 'Not enough space available for this booking.'
          : 'This time slot is full.',
      );
    }

    const categoryCheck = await validateCategoryCapacity({
      businessId: this.businessId,
      activityId,
      bookingDate,
      bookingTime,
      unitsRequested,
      overrideId: categoryCapacityOverrideId,
    });
    if (!categoryCheck?.ok) {
      const err = new Error(categoryCheck.message || 'Category capacity exceeded.');
      err.code = categoryCheck.code || 'category_capacity';
      err.requiresOverride = categoryCheck.requires_override === true;
      err.capacityDetails = categoryCheck;
      throw err;
    }
  }

  async _assertBusinessHours({
    bookingDate,
    bookingTime,
    durationMinutes,
    activityId,
    businessHoursOverrideApprovedBy = null,
  }) {
    const { operating_hours: operatingHours, holiday_hours: holidayHours } = await this._loadBusinessHoursContext();
    const resolvedDuration = await this._resolveActivityDurationMinutes(activityId, durationMinutes);
    const check = validateBookingWithinBusinessHours({
      bookingDate,
      bookingTime,
      durationMinutes: resolvedDuration,
      operatingHours,
      holidayHours,
    });
    if (check.ok) return;
    if (businessHoursOverrideApprovedBy && check.requiresOverride) return;
    throw new Error(check.message || 'Booking is outside business hours.');
  }

  _isMissingCheckedInAtColumn(error) {
    return (
      error?.code === '42703' && String(error.message || '').includes('checked_in_at')
    );
  }

  _relOne(rel) {
    if (rel == null) return null;
    return Array.isArray(rel) ? rel[0] : rel;
  }

  /**
   * Emails we can use to match `mail_contacts` (same marketing list as Campaign Sender / contacts UI).
   */
  _emailsFromParticipantForMailLookup(p, booking) {
    const out = [];
    const add = (e) => {
      const s = e && String(e).trim();
      if (s) out.push(s);
    };
    add(this._relOne(p.booking_customer_participants)?.email);
    add(this._relOne(p.waiver_participants)?.email);
    const sw = this._relOne(p.ws_via_waiver_id) || p.ws_via_waiver_id;
    const ss = this._relOne(p.ws_via_signature_id) || p.ws_via_signature_id;
    add(sw?.email);
    add(ss?.email);
    const uniq = [...new Set(out)];
    if (uniq.length === 0 && booking.customer_email) {
      const isSoloGuest = booking?.booking_participants?.length === 1;
      const isPartyHost = p.party_role === 'host_adult';
      if (isSoloGuest || isPartyHost) {
        add(booking.customer_email);
      }
    }
    return uniq;
  }

  /**
   * Attach `mail_contacts` row as `_mail_contact` when participant email matches marketing contact (first/last live there).
   */
  async enrichBookingWithMailContactNames(booking) {
    if (!this.businessId || !booking?.booking_participants?.length) return booking;

    const originals = [];
    for (const p of booking.booking_participants) {
      originals.push(...this._emailsFromParticipantForMailLookup(p, booking));
    }
    const uniqueOriginal = [...new Set(originals.map((e) => String(e).trim()))];
    if (!uniqueOriginal.length) return booking;

    const emailVariants = new Set();
    for (const e of uniqueOriginal) {
      const t = String(e).trim();
      if (!t) continue;
      emailVariants.add(t);
      emailVariants.add(t.toLowerCase());
    }
    const inList = [...emailVariants].slice(0, 100);

    const { data: rows, error } = await supabase
      .from('mail_contacts')
      .select('email, first_name, last_name')
      .eq('business_id', this.businessId)
      .in('email', inList);

    if (error) {
      console.warn('[BookingService] mail_contacts lookup:', error.message);
      return booking;
    }

    const byLower = {};
    for (const c of rows || []) {
      byLower[String(c.email || '').trim().toLowerCase()] = c;
    }

    const enriched = booking.booking_participants.map((p) => {
      const emails = this._emailsFromParticipantForMailLookup(p, booking);
      let mc = null;
      for (const em of emails) {
        const hit = byLower[String(em).trim().toLowerCase()];
        if (hit) {
          mc = hit;
          break;
        }
      }
      return mc ? { ...p, _mail_contact: mc } : p;
    });

    return { ...booking, booking_participants: enriched };
  }

  /**
   * Same mail_contacts merge as enrichBookingWithMailContactNames, batched for list endpoints (dashboard/schedule).
   */
  async enrichBookingsListWithMailContactNames(bookings) {
    if (!this.businessId || !Array.isArray(bookings) || !bookings.length) return bookings;

    const originals = [];
    for (const booking of bookings) {
      for (const p of booking.booking_participants || []) {
        originals.push(...this._emailsFromParticipantForMailLookup(p, booking));
      }
    }
    const uniqueOriginal = [...new Set(originals.map((e) => String(e).trim()))];
    if (!uniqueOriginal.length) return bookings;

    const emailVariants = new Set();
    for (const e of uniqueOriginal) {
      const t = String(e).trim();
      if (!t) continue;
      emailVariants.add(t);
      emailVariants.add(t.toLowerCase());
    }
    const inList = [...emailVariants].slice(0, 200);

    const { data: rows, error } = await supabase
      .from('mail_contacts')
      .select('email, first_name, last_name')
      .eq('business_id', this.businessId)
      .in('email', inList);

    if (error) {
      console.warn('[BookingService] mail_contacts list enrich:', error.message);
      return bookings;
    }

    const byLower = {};
    for (const c of rows || []) {
      byLower[String(c.email || '').trim().toLowerCase()] = c;
    }

    return bookings.map((booking) => {
      if (!booking.booking_participants?.length) return booking;
      const enriched = booking.booking_participants.map((p) => {
        const emails = this._emailsFromParticipantForMailLookup(p, booking);
        let mc = null;
        for (const em of emails) {
          const hit = byLower[String(em).trim().toLowerCase()];
          if (hit) {
            mc = hit;
            break;
          }
        }
        return mc ? { ...p, _mail_contact: mc } : p;
      });
      return { ...booking, booking_participants: enriched };
    });
  }

  /** Attach pos_loyalty_accounts.customer_name for schedule/dashboard booker labels. */
  async enrichBookingsListWithCustomerAccountNames(bookings) {
    if (!this.businessId || !Array.isArray(bookings) || !bookings.length) return bookings;

    const customerIds = [
      ...new Set(
        bookings
          .map((b) => b?.customer_id)
          .filter((id) => typeof id === 'string' && id.trim()),
      ),
    ];
    if (!customerIds.length) return bookings;

    const { data: rows, error } = await supabase
      .from('pos_loyalty_accounts')
      .select('id, customer_name, customer_email, customer_phone')
      .eq('business_id', this.businessId)
      .in('id', customerIds.slice(0, 200));

    if (error) {
      console.warn('[BookingService] loyalty account list enrich:', error.message);
      return bookings;
    }

    const byId = new Map((rows || []).map((row) => [row.id, row]));
    return bookings.map((booking) => {
      const account = booking?.customer_id ? byId.get(booking.customer_id) : null;
      if (!account) return booking;
      return {
        ...booking,
        customer_name: account.customer_name ?? booking.customer_name ?? null,
        customer_email: booking.customer_email || account.customer_email || null,
        customer_phone: booking.customer_phone || account.customer_phone || null,
      };
    });
  }

  /**
   * Participant names are not stored on booking_participants (prod). They come from:
   * - booking_customer_participants (participant_id)
   * - waiver_participants (waiver_participant_id) — additional signers / minors on the waiver
   * - waiver_signatures (waiver_id / waiver_signature_id) — primary signer on the linked waiver record;
   *   staff verification sets waiver_id on the participant row, so we must embed signatures too.
   */
  _bookingParticipantsNested(includeParticipantCheckedIn) {
    const checkedInLine = includeParticipantCheckedIn
      ? '          checked_in_at,\n'
      : '';
    return `booking_participants (
          id,
          participant_id,
          inventory_item_id,
          waiver_participant_id,
          waiver_id,
          waiver_signature_id,
          waiver_status,
          party_role,
          camper_registration_document_id,
          camper_registration_status,
${checkedInLine}          booking_customer_participants!booking_participants_participant_id_fkey (
            id,
            first_name,
            last_name,
            email,
            phone_number,
            date_of_birth
          ),
          waiver_participants!booking_participants_waiver_participant_id_fkey (
            id,
            first_name,
            last_name,
            email,
            phone_number,
            date_of_birth,
            participant_type
          ),
          ws_via_waiver_id:waiver_signatures!booking_participants_waiver_id_fkey1 (
            id,
            first_name,
            last_name,
            email,
            phone_number,
            date_of_birth,
            is_minor
          ),
          ws_via_signature_id:waiver_signatures!booking_participants_waiver_signature_id_fkey (
            id,
            first_name,
            last_name,
            email,
            phone_number,
            date_of_birth,
            is_minor
          ),
          pos_inventory (
            id,
            name
          ),
          camper_registration_documents (
            id,
            first_name,
            last_name,
            date_of_birth,
            medical_summary,
            authorized_pickups,
            signed_at,
            expires_at,
            is_valid
          )
        ),`;
  }

  /** Lighter participant embed for list/schedule endpoints (avoids statement timeouts). */
  _bookingParticipantsListNested(includeParticipantCheckedIn) {
    const checkedInLine = includeParticipantCheckedIn
      ? '          checked_in_at,\n'
      : '';
    return `booking_participants (
          id,
          participant_id,
          inventory_item_id,
          waiver_participant_id,
          waiver_id,
          waiver_signature_id,
          waiver_status,
          party_role,
          camper_registration_status,
${checkedInLine}          booking_customer_participants!booking_participants_participant_id_fkey (
            id,
            first_name,
            last_name,
            email,
            phone_number,
            date_of_birth
          ),
          waiver_participants!booking_participants_waiver_participant_id_fkey (
            id,
            first_name,
            last_name,
            email,
            phone_number,
            date_of_birth,
            participant_type
          ),
          pos_inventory (
            id,
            name
          )
        ),`;
  }

  /** Minimal participant embed for dashboard overview (avoids heavy waiver/customer joins). */
  _bookingDashboardParticipantsNested() {
    return `booking_participants (
          id,
          inventory_item_id,
          pos_inventory (
            id,
            name
          )
        ),`;
  }

  /** Lighter booking embed for dashboard stats/queues (avoids statement timeouts). */
  _bookingDashboardSelect() {
    const participants = this._bookingDashboardParticipantsNested();

    return `
        *,
        booking_activities:activity_id (
          id,
          activity_name,
          ticket_settings
        ),
        booking_types:booking_type_id (
          id,
          type_name,
          type_key,
          display_name,
          requires_payment
        ),
        ${participants}
        active_payment_request:booking_payment_requests!bookings_active_payment_request_id_fkey (
          id,
          request_type,
          amount,
          due_at,
          status
        ),
        booking_payments (
          id,
          payment_type,
          amount_paid,
          status,
          payment_method
        ),
        booking_addon_items (
          id,
          addon_id,
          quantity,
          unit_price,
          total_price,
          booking_addons:addon_id (
            id,
            addon_name,
            addon_key,
            description,
            price
          )
        ),
        booking_time_extensions (
          id,
          extension_type,
          amount_charged
        )
      `;
  }

  _bookingListSelect(includeParticipantCheckedIn) {
    const participants = this._bookingParticipantsListNested(includeParticipantCheckedIn);

    return `
        *,
        booking_activities:activity_id (
          id,
          activity_name,
          description,
          duration_minutes,
          max_capacity,
          requires_waiver,
          requires_camper_registration,
          ticket_settings
        ),
        booking_types:booking_type_id (
          id,
          type_name,
          type_key,
          display_name,
          requires_waiver,
          requires_camper_registration,
          requires_payment
        ),
        ${participants}
        active_payment_request:booking_payment_requests!bookings_active_payment_request_id_fkey (
          id,
          request_type,
          amount,
          due_at,
          status
        ),
        booking_payments (
          id,
          payment_type,
          amount_paid,
          status,
          payment_method
        ),
        booking_addon_items (
          id,
          addon_id,
          quantity,
          unit_price,
          total_price,
          booking_addons:addon_id (
            id,
            addon_name,
            description,
            price
          )
        ),
        booking_resource_assignments (
          id,
          category_id,
          resource_id,
          source,
          notes
        ),
        booking_time_extensions (
          id,
          added_minutes,
          extension_type,
          amount_charged,
          reason,
          created_at
        )
      `;
  }

  _bookingDetailSelect(includeParticipantCheckedIn) {
    const participants = this._bookingParticipantsNested(includeParticipantCheckedIn);

    return `
        *,
        booking_activities:activity_id (*),
        booking_types:booking_type_id (*),
        ${participants}
        booking_payments (*),
        booking_addon_items (
          *,
          booking_addons:addon_id (*)
        ),
        booking_resource_assignments (
          id,
          category_id,
          resource_id,
          source,
          notes
        ),
        booking_time_extensions (
          id,
          added_minutes,
          extension_type,
          amount_charged,
          reason,
          previous_end_time,
          new_end_time,
          created_at
        )
      `;
  }

  _applyGetBookingsFilters(query, filters) {
    let q = query;
    if (filters.status) {
      q = q.eq('status', filters.status);
    }
    if (filters.paymentStatus) {
      q = q.eq('payment_status', filters.paymentStatus);
    }
    if (filters.customerId) {
      q = q.eq('customer_id', filters.customerId);
    }
    if (filters.activityId) {
      q = q.eq('activity_id', filters.activityId);
    }
    if (filters.startDate) {
      q = q.gte('booking_date', filters.startDate);
    }
    if (filters.endDate) {
      q = q.lte('booking_date', filters.endDate);
    }
    if (filters.search) {
      q = q.or(
        `customer_email.ilike.%${filters.search}%,customer_phone.ilike.%${filters.search}%,booking_number.ilike.%${filters.search}%`
      );
    }
    return q;
  }

  // Get all bookings with filters
  async getBookings(filters = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const tryIncludeCi =
      this._participantCheckedInColumnAvailable !== false;
    const useDashboardSelect = filters.selectMode === 'dashboard';

    const buildQuery = (includeCi) =>
      this._applyGetBookingsFilters(
        supabase
          .from('bookings')
          .select(
            useDashboardSelect
              ? this._bookingDashboardSelect()
              : this._bookingListSelect(includeCi)
          )
          .eq('business_id', this.businessId)
          .order('booking_date', { ascending: false })
          .order('booking_time', { ascending: false }),
        filters
      );

    let { data, error } = useDashboardSelect
      ? await buildQuery(false)
      : await buildQuery(tryIncludeCi);

    if (!useDashboardSelect && this._isMissingCheckedInAtColumn(error) && tryIncludeCi) {
      this._participantCheckedInColumnAvailable = false;
      ({ data, error } = await buildQuery(false));
    } else if (!error && tryIncludeCi && !useDashboardSelect) {
      this._participantCheckedInColumnAvailable = true;
    }

    if (error) {
      console.error('Error fetching bookings:', error);
      throw error;
    }

    const list = data || [];
    const withMail = await this.enrichBookingsListWithMailContactNames(list);
    return this.enrichBookingsListWithCustomerAccountNames(withMail);
  }

  // Get single booking by ID
  async getBookingById(bookingId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const tryIncludeCi =
      this._participantCheckedInColumnAvailable !== false;

    let q = supabase
      .from('bookings')
      .select(this._bookingDetailSelect(tryIncludeCi))
      .eq('id', bookingId)
      .eq('business_id', this.businessId)
      .single();

    let { data, error } = await q;

    if (this._isMissingCheckedInAtColumn(error) && tryIncludeCi) {
      this._participantCheckedInColumnAvailable = false;
      ({ data, error } = await supabase
        .from('bookings')
        .select(this._bookingDetailSelect(false))
        .eq('id', bookingId)
        .eq('business_id', this.businessId)
        .single());
    } else if (!error && tryIncludeCi) {
      this._participantCheckedInColumnAvailable = true;
    }

    if (error) {
      console.error('Error fetching booking:', error);
      throw error;
    }

    return data;
  }

  /** Same as getBookingById plus mail_contacts names (marketing DB) matched by email. */
  async getBookingByIdWithMailNames(bookingId) {
    const booking = await this.getBookingById(bookingId);
    const withMail = await this.enrichBookingWithMailContactNames(booking);
    const [withAccount] = await this.enrichBookingsListWithCustomerAccountNames([withMail]);
    return withAccount || withMail;
  }

  async _loadMultiDayConfig(activityId) {
    if (!activityId) return null;
    const { data, error } = await supabase
      .from('booking_activities')
      .select('ticket_settings, duration_minutes')
      .eq('id', activityId)
      .eq('business_id', this.businessId)
      .maybeSingle();
    if (error) throw error;
    return parseMultiDaySettings(data?.ticket_settings, data?.duration_minutes);
  }

  async _insertBookingRecord(record) {
    const { data, error } = await supabase
      .from('bookings')
      .insert(record)
      .select()
      .single();
    if (error) {
      console.error('Error creating booking:', error);
      throw error;
    }
    return data;
  }

  async _createMultiDayBooking(bookingData, multiDayConfig) {
    const attendanceDates = computeMultiDayDates(bookingData.bookingDate, multiDayConfig);
    if (attendanceDates.length === 0) {
      throw new Error('Could not determine attendance dates for this multi-day booking.');
    }

    for (const attendanceDate of attendanceDates) {
      await this._assertCategoryCapacity({
        activityId: bookingData.activityId,
        bookingDate: attendanceDate,
        bookingTime: bookingData.bookingTime,
        participants: bookingData.participants || [],
        categoryCapacityOverrideId: bookingData.categoryCapacityOverrideId || null,
      });
    }

    const dailyDuration = multiDayConfig.dailyDurationMinutes;
    const customerId = await this._ensureCustomerIdForBooking(bookingData);

    const { data: bookingNumber, error: numberError } = await supabase.rpc('generate_booking_number', {
      business_uuid: this.businessId,
    });
    if (numberError) throw numberError;

    const parentRecord = {
      business_id: this.businessId,
      activity_id: bookingData.activityId,
      booking_type_id: bookingData.bookingTypeId || null,
      session_id: bookingData.sessionId || null,
      booking_number: bookingNumber,
      customer_id: customerId,
      customer_email: bookingData.customerEmail,
      customer_phone: bookingData.customerPhone,
      booking_date: attendanceDates[0],
      booking_time: bookingData.bookingTime,
      duration_minutes: dailyDuration,
      status: bookingData.status || 'pending',
      payment_status: bookingData.paymentStatus || 'unpaid',
      source: bookingData.source || 'staff',
      requires_approval: bookingData.requiresApproval || false,
      notes: bookingData.notes || null,
      created_by: bookingData.createdBy || null,
      created_ip: bookingData.createdIp || null,
      business_hours_override_by: bookingData.businessHoursOverrideApprovedBy || null,
      business_hours_override_at: bookingData.businessHoursOverrideApprovedBy
        ? new Date().toISOString()
        : null,
      multi_day_role: 'parent',
      external_reference: bookingData.externalReference || null,
      order_total: bookingData.orderTotal ?? null,
      tax_amount: bookingData.taxAmount ?? null,
    };

    const parent = await this._insertBookingRecord(parentRecord);

    await supabase.rpc('generate_booking_qr_code', { booking_uuid: parent.id });

    await this._insertParticipantsForNewBooking(
      parent.id,
      customerId,
      bookingData.participants || []
    );

    if (bookingData.addons?.length > 0) {
      await this._createBookingAddonItems(parent.id, bookingData.activityId, bookingData.addons);
    }

    for (const attendanceDate of attendanceDates) {
      const dayRecord = {
        business_id: this.businessId,
        activity_id: bookingData.activityId,
        booking_type_id: bookingData.bookingTypeId || null,
        customer_id: customerId,
        customer_email: bookingData.customerEmail,
        customer_phone: bookingData.customerPhone,
        booking_date: attendanceDate,
        booking_time: bookingData.bookingTime,
        duration_minutes: dailyDuration,
        status: parentRecord.status,
        payment_status: parentRecord.payment_status,
        source: parentRecord.source,
        requires_approval: parentRecord.requires_approval,
        approved_at: parentRecord.requires_approval && parentRecord.status === 'confirmed'
          ? new Date().toISOString()
          : null,
        notes: bookingData.notes
          ? `${bookingData.notes} | Multi-day attendance ${attendanceDate}`
          : `Multi-day attendance ${attendanceDate}`,
        created_by: bookingData.createdBy || null,
        created_ip: bookingData.createdIp || null,
        parent_booking_id: parent.id,
        multi_day_role: 'day',
      };

      const dayBooking = await this._insertBookingRecord(dayRecord);

      if (Array.isArray(bookingData.resourceAssignments) && bookingData.resourceAssignments.length > 0) {
        await this.replaceResourceAssignments(
          dayBooking.id,
          bookingData.resourceAssignments,
          bookingData.resourceAssignmentSource || 'schedule',
        );
      } else {
        await this.syncResourceAssignmentsFromSchedule(
          dayBooking.id,
          bookingData.activityId,
          attendanceDate,
          bookingData.bookingTime,
        );
      }
    }

    const fullBooking = await this.getBookingById(parent.id);

    await this._logBookingHistory({
      bookingId: parent.id,
      actionType: BOOKING_HISTORY_ACTIONS.CREATED,
      summary: `Multi-day booking created (${attendanceDates.length} days)`,
      details: {
        changes: [
          { field: 'Booking number', from: null, to: bookingNumber },
          { field: 'Anchor date', from: null, to: attendanceDates[0] || null },
          { field: 'Attendance days', from: null, to: attendanceDates.join(', ') },
          { field: 'Source', from: null, to: bookingData.source || 'staff' },
        ].filter((row) => row.to != null),
      },
      audit: {
        updatedBy: bookingData.createdBy || null,
        updatedIp: bookingData.createdIp || null,
      },
    });

    return fullBooking;
  }

  async _createBookingAddonItems(bookingId, activityId, addons) {
    if (!addons?.length) return;

    const requestedTaxRateIds = Array.from(new Set(
      addons.flatMap((addon) => {
        if (Array.isArray(addon.taxRateIds)) {
          return addon.taxRateIds.filter(Boolean);
        }
        return addon.taxRateId ? [addon.taxRateId] : [];
      }),
    ));
    let taxRateMap = new Map();

    if (requestedTaxRateIds.length > 0) {
      const { data: taxRates, error: taxRatesError } = await supabase
        .from('pos_tax_categories')
        .select('id, name, rate, category_type')
        .eq('business_id', this.businessId)
        .in('id', requestedTaxRateIds);

      if (taxRatesError) {
        console.error('Error loading tax rates for booking addons:', taxRatesError);
      } else {
        taxRateMap = new Map(
          (taxRates || [])
            .filter((taxRate) => taxRate.category_type === 'tax')
            .map((taxRate) => [taxRate.id, taxRate]),
        );
      }
    }

    const resolvedAddonItems = [];

    for (const addon of addons) {
      let addonId = addon.addonId || null;
      const quantity = Math.max(1, parseInt(addon.quantity, 10) || 1);
      const unitPrice = Number.parseFloat(addon.unitPrice) || 0;
      const itemSubtotal = quantity * unitPrice;
      const selectedTaxRateIds = Array.isArray(addon.taxRateIds)
        ? addon.taxRateIds.filter(Boolean)
        : addon.taxRateId ? [addon.taxRateId] : [];
      const selectedTaxRates = selectedTaxRateIds
        .map((taxRateId) => taxRateMap.get(taxRateId))
        .filter(Boolean);
      const appliedTaxRate = selectedTaxRates.reduce(
        (sum, taxRate) => sum + (Number.parseFloat(taxRate?.rate) || 0),
        0,
      );
      const taxAmount = itemSubtotal * appliedTaxRate;
      const taxDescription = selectedTaxRates.length > 0
        ? `Manual booking item. Taxes: ${selectedTaxRates
            .map((taxRate) => `${taxRate.name} (${((Number.parseFloat(taxRate.rate) || 0) * 100).toFixed(2)}%)`)
            .join(', ')}. Total tax amount: ${taxAmount.toFixed(2)}.`
        : 'Manual booking item. No tax applied.';

      if (!addonId && addon.addonName) {
        const addonKey = `manual-${bookingId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { data: createdAddon, error: createdAddonError } = await supabase
          .from('booking_addons')
          .insert({
            business_id: this.businessId,
            addon_name: addon.addonName,
            addon_key: addonKey,
            description: taxDescription,
            price: unitPrice,
            is_global: false,
            activity_ids: activityId ? [activityId] : null,
            inventory_tracked: false,
            current_stock: null,
            is_active: false,
          })
          .select('id')
          .single();

        if (createdAddonError) {
          console.error('Error creating manual booking addon:', createdAddonError);
          continue;
        }

        addonId = createdAddon?.id || null;
      }

      if (!addonId) continue;

      resolvedAddonItems.push({
        booking_id: bookingId,
        addon_id: addonId,
        quantity,
        unit_price: unitPrice,
      });
    }

    if (resolvedAddonItems.length === 0) return;

    const { error: addonsError } = await supabase
      .from('booking_addon_items')
      .insert(resolvedAddonItems);

    if (addonsError) {
      console.error('Error creating addon items:', addonsError);
    }
  }

  // Create new booking
  async createBooking(bookingData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const participantCount = Array.isArray(bookingData.participants) && bookingData.participants.length > 0
      ? bookingData.participants.length
      : 1;

    await this._assertBookingTicketLimits(bookingData.activityId, participantCount, {
      ticketLimitOverride: bookingData.ticketLimitOverride === true,
      createdBy: bookingData.createdBy || null,
    });

    const multiDayConfig = await this._loadMultiDayConfig(bookingData.activityId);
    const bookingDuration = multiDayConfig?.dailyDurationMinutes ?? bookingData.durationMinutes;

    await this._assertBusinessHours({
      bookingDate: bookingData.bookingDate,
      bookingTime: bookingData.bookingTime,
      durationMinutes: bookingDuration,
      activityId: bookingData.activityId,
      businessHoursOverrideApprovedBy: bookingData.businessHoursOverrideApprovedBy || null,
    });

    if (!multiDayConfig?.enabled) {
      await this._assertCategoryCapacity({
        activityId: bookingData.activityId,
        bookingDate: bookingData.bookingDate,
        bookingTime: bookingData.bookingTime,
        participants: bookingData.participants || [],
        categoryCapacityOverrideId: bookingData.categoryCapacityOverrideId || null,
      });
    }

    if (multiDayConfig?.enabled) {
      return this._createMultiDayBooking(bookingData, multiDayConfig);
    }

    const customerId = await this._ensureCustomerIdForBooking(bookingData);

    const { data: bookingNumber, error: numberError } = await supabase.rpc('generate_booking_number', {
      business_uuid: this.businessId,
    });

    if (numberError) {
      console.error('Error generating booking number:', numberError);
      throw numberError;
    }

    const bookingRecord = {
      business_id: this.businessId,
      activity_id: bookingData.activityId,
      booking_type_id: bookingData.bookingTypeId || null,
      session_id: bookingData.sessionId || null,
      booking_number: bookingNumber,
      customer_id: customerId,
      customer_email: bookingData.customerEmail,
      customer_phone: bookingData.customerPhone,
      booking_date: bookingData.bookingDate,
      booking_time: bookingData.bookingTime,
      duration_minutes: bookingData.durationMinutes || null,
      status: bookingData.status || 'pending',
      payment_status: bookingData.paymentStatus || 'unpaid',
      source: bookingData.source || 'staff',
      requires_approval: bookingData.requiresApproval || false,
      notes: bookingData.notes || null,
      created_by: bookingData.createdBy || null,
      created_ip: bookingData.createdIp || null,
      business_hours_override_by: bookingData.businessHoursOverrideApprovedBy || null,
      business_hours_override_at: bookingData.businessHoursOverrideApprovedBy
        ? new Date().toISOString()
        : null,
    };

    // Attach Terms package when activity opts into confirmation-page acknowledgment.
    if (bookingData.activityId) {
      const { data: activityTerms } = await supabase
        .from('booking_activities')
        .select('terms_package_id, terms_show_on_confirmation')
        .eq('id', bookingData.activityId)
        .eq('business_id', this.businessId)
        .maybeSingle();
      if (
        activityUsesPendingTermsOnBooking(activityTerms)
      ) {
        bookingRecord.terms_package_id = activityTerms.terms_package_id;
        bookingRecord.terms_status = 'pending';
        bookingRecord.terms_ack_token =
          crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
      }
    }

    const booking = await this._insertBookingRecord(bookingRecord);

    await supabase.rpc('generate_booking_qr_code', {
      booking_uuid: booking.id,
    });

    await this._insertParticipantsForNewBooking(
      booking.id,
      customerId,
      bookingData.participants || []
    );

    if (bookingData.addons?.length > 0) {
      await this._createBookingAddonItems(booking.id, bookingData.activityId, bookingData.addons);
    }

    if (Array.isArray(bookingData.resourceAssignments) && bookingData.resourceAssignments.length > 0) {
      await this.replaceResourceAssignments(
        booking.id,
        bookingData.resourceAssignments,
        bookingData.resourceAssignmentSource || 'manual',
      );
    } else {
      await this.syncResourceAssignmentsFromSchedule(
        booking.id,
        bookingData.activityId,
        bookingData.bookingDate,
        bookingData.bookingTime,
      );
    }

    const fullBooking = await this.getBookingById(booking.id);

    await this._logBookingHistory({
      bookingId: booking.id,
      actionType: BOOKING_HISTORY_ACTIONS.CREATED,
      summary: 'Booking created',
      details: {
        changes: [
          { field: 'Booking number', from: null, to: bookingNumber },
          { field: 'Date', from: null, to: bookingData.bookingDate || null },
          { field: 'Time', from: null, to: bookingData.bookingTime || null },
          { field: 'Source', from: null, to: bookingData.source || 'staff' },
        ].filter((row) => row.to != null),
      },
      audit: {
        updatedBy: bookingData.createdBy || null,
        updatedIp: bookingData.createdIp || null,
      },
    });

    return fullBooking;
  }

  // Update booking
  async updateBooking(bookingId, updates, audit = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let before = null;
    if (audit.logHistory !== false) {
      before = await this.getBookingById(bookingId);
    }

    const scheduleTouched = ['booking_date', 'booking_time', 'duration_minutes', 'activity_id'].some(
      (key) => Object.prototype.hasOwnProperty.call(updates, key),
    );
    if (scheduleTouched) {
      const source = before || await this.getBookingById(bookingId);
      await this._assertBusinessHours({
        bookingDate: updates.booking_date ?? source?.booking_date,
        bookingTime: updates.booking_time ?? source?.booking_time,
        durationMinutes: updates.duration_minutes ?? source?.duration_minutes,
        activityId: updates.activity_id ?? source?.activity_id,
        businessHoursOverrideApprovedBy:
          audit.businessHoursOverrideApprovedBy || updates.business_hours_override_by || null,
      });
    }

    const auditPatch = {};
    if (audit.updatedBy) auditPatch.updated_by = audit.updatedBy;
    if (audit.updatedIp) auditPatch.updated_ip = audit.updatedIp;

    const updatePayload = {
      ...updates,
      ...auditPatch,
      updated_at: new Date().toISOString(),
    };
    if (audit.businessHoursOverrideApprovedBy && scheduleTouched) {
      updatePayload.business_hours_override_by = audit.businessHoursOverrideApprovedBy;
      updatePayload.business_hours_override_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('bookings')
      .update(updatePayload)
      .eq('id', bookingId)
      .eq('business_id', this.businessId)
      .select()
      .single();

    if (error) {
      console.error('Error updating booking:', error);
      throw error;
    }

    if (before && audit.logHistory !== false) {
      const context = audit.historyContext || {};
      const scheduleChanges = describeScheduleChanges(before, data, context);
      const statusChanges = describeStatusChanges(before, data);
      const changes = [...scheduleChanges, ...statusChanges];

      if (changes.length > 0) {
        const isScheduleOnly = scheduleChanges.length > 0 && statusChanges.length === 0;
        await this._logBookingHistory({
          bookingId,
          actionType: isScheduleOnly
            ? BOOKING_HISTORY_ACTIONS.SCHEDULE_UPDATED
            : BOOKING_HISTORY_ACTIONS.STATUS_CHANGED,
          summary: isScheduleOnly ? 'Schedule updated' : 'Booking updated',
          details: { changes },
          audit,
        });
      }
    }

    return data;
  }

  async touchBookingAudit(bookingId, audit = {}) {
    if (!this.businessId || !bookingId) return;
    if (!audit.updatedBy && !audit.updatedIp) return;

    const patch = { updated_at: new Date().toISOString() };
    if (audit.updatedBy) patch.updated_by = audit.updatedBy;
    if (audit.updatedIp) patch.updated_ip = audit.updatedIp;

    const { error } = await supabase
      .from('bookings')
      .update(patch)
      .eq('id', bookingId)
      .eq('business_id', this.businessId);

    if (error) {
      console.error('Error recording booking audit:', error);
      throw error;
    }
  }

  async _logBookingHistory({
    bookingId,
    actionType,
    summary,
    details = {},
    audit = {},
  }) {
    if (!this.businessId || !bookingId || !actionType || !summary) return;

    try {
      const { error } = await supabase.from('booking_history').insert({
        business_id: this.businessId,
        booking_id: bookingId,
        action_type: actionType,
        summary,
        details,
        changed_by: audit.updatedBy || audit.changedBy || null,
        changed_ip: audit.updatedIp || audit.changedIp || null,
      });

      if (error) {
        console.warn('Could not write booking history:', error.message || error);
      }
    } catch (err) {
      console.warn('Could not write booking history:', err);
    }
  }

  async logBookingHistoryEvent(bookingId, actionType, summary, details = {}, audit = {}) {
    await this._logBookingHistory({ bookingId, actionType, summary, details, audit });
  }

  async listBookingHistory(bookingId, bookingForSynthetic = null) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    try {
      const { data, error } = await supabase
        .from('booking_history')
        .select('id, booking_id, action_type, summary, details, changed_by, changed_ip, created_at')
        .eq('booking_id', bookingId)
        .eq('business_id', this.businessId)
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Could not load booking history:', error.message || error);
        return mergeHistoryWithSyntheticCreated([], bookingForSynthetic);
      }

      return mergeHistoryWithSyntheticCreated(data || [], bookingForSynthetic);
    } catch (err) {
      console.warn('Could not load booking history:', err);
      return mergeHistoryWithSyntheticCreated([], bookingForSynthetic);
    }
  }

  async listRecentBusinessHistory({ limit = 100 } = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('booking_history')
      .select('id, booking_id, action_type, summary, details, changed_by, changed_ip, created_at')
      .eq('business_id', this.businessId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('Could not load recent booking history:', error.message || error);
      return [];
    }

    return data || [];
  }

  _snapshotResourceAssignments(booking) {
    return (booking?.booking_resource_assignments || [])
      .map((row) => ({
        category_id: row.category_id,
        resource_id: row.resource_id,
        source: row.source || null,
      }))
      .sort((a, b) => `${a.category_id}-${a.resource_id}`.localeCompare(`${b.category_id}-${b.resource_id}`));
  }

  _describeResourceAssignmentChanges(beforeRows, afterRows) {
    const beforeKey = (beforeRows || []).map((r) => `${r.category_id}:${r.resource_id}`).join('|') || 'none';
    const afterKey = (afterRows || []).map((r) => `${r.category_id}:${r.resource_id}`).join('|') || 'none';
    if (beforeKey === afterKey) return [];
    return [{
      field: 'Resource assignments',
      from: beforeKey === 'none' ? 'None' : beforeKey.replace(/:/g, ' → ').replace(/\|/g, ', '),
      to: afterKey === 'none' ? 'None' : afterKey.replace(/:/g, ' → ').replace(/\|/g, ', '),
    }];
  }

  _portalOptionItemsFromBooking(booking, bookingId) {
    return (booking?.booking_addon_items || []).filter((item) => {
      const key = String(item?.booking_addons?.addon_key || '');
      return key.startsWith(`portal-${bookingId}-`);
    });
  }

  async _getPosIndianStatusSettings() {
    const { data, error } = await fetchPosBusinessSettings(
      this.businessId,
      'indian_status_gst_rate, indian_status_tax_label',
    );

    if (error) throw error;

    const gstR = parseFloat(data?.indian_status_gst_rate);
    return {
      gstRate: Number.isFinite(gstR) ? Math.min(1, Math.max(0, gstR)) : 0.05,
      taxLabel: (data?.indian_status_tax_label || 'GST (Indian Status)').trim() || 'GST (Indian Status)',
    };
  }

  async _syncBookingCheckoutBaseline(bookingId, audit = {}) {
    if (!this.businessId || !bookingId) return;

    const booking = await this.getBookingById(bookingId);
    const portalPretax = sumPortalBookingAddonTotals(booking);
    const pricing = computeBookingPricingWithPortalAddonSubtotal(booking, portalPretax);

    let baseline;
    if (isBookingIndianStatusActive(booking)) {
      const { gstRate } = await this._getPosIndianStatusSettings();
      const standardPricing = computeBookingPricingWithPortalAddonSubtotal(
        { ...booking, indian_status_gst_only: false },
        portalPretax,
      );
      baseline = checkoutBaselineForIndianStatus(standardPricing, booking, gstRate);
    } else {
      baseline = checkoutBaselineFromFullPricing(pricing, booking);
    }

    const patch = {
      order_total: baseline.order_total,
      tax_amount: baseline.tax_amount,
      updated_at: new Date().toISOString(),
    };
    if (audit.updatedBy) patch.updated_by = audit.updatedBy;
    if (audit.updatedIp) patch.updated_ip = audit.updatedIp;

    const { error: updateError } = await supabase
      .from('bookings')
      .update(patch)
      .eq('id', bookingId)
      .eq('business_id', this.businessId);

    if (updateError) throw updateError;
  }

  async applyIndianStatusToBooking(bookingId, certificateNumber, audit = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const cert = String(certificateNumber || '').trim();
    if (!cert) {
      throw new Error('Indian Status certificate number is required');
    }

    const beforeBooking = await this.getBookingById(bookingId);
    const { gstRate } = await this._getPosIndianStatusSettings();
    const portalPretax = sumPortalBookingAddonTotals(beforeBooking);
    const pricing = computeBookingPricingWithPortalAddonSubtotal(
      { ...beforeBooking, indian_status_gst_only: false },
      portalPretax,
    );
    const baseline = checkoutBaselineForIndianStatus(pricing, beforeBooking, gstRate);

    const patch = {
      indian_status_gst_only: true,
      indian_status_certificate_number: cert,
      order_total: baseline.order_total,
      tax_amount: baseline.tax_amount,
      updated_at: new Date().toISOString(),
    };

    if (!beforeBooking.indian_status_gst_only) {
      patch.indian_status_restore_order_total = Number(beforeBooking.order_total) || 0;
      patch.indian_status_restore_tax_amount = Number(beforeBooking.tax_amount) || 0;
    }

    if (audit.updatedBy) patch.updated_by = audit.updatedBy;
    if (audit.updatedIp) patch.updated_ip = audit.updatedIp;

    const { error } = await supabase
      .from('bookings')
      .update(patch)
      .eq('id', bookingId)
      .eq('business_id', this.businessId);

    if (error) throw error;

    await this.touchBookingAudit(bookingId, audit);
    await this._logBookingHistory({
      bookingId,
      actionType: BOOKING_HISTORY_ACTIONS.PRICING_UPDATED,
      summary: 'Indian Status (GST only) applied',
      details: {
        certificate_number: cert,
        gst_rate: gstRate,
        order_total: baseline.order_total,
        tax_amount: baseline.tax_amount,
      },
      audit,
    });

    return this.getBookingById(bookingId);
  }

  async clearIndianStatusFromBooking(bookingId, audit = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const beforeBooking = await this.getBookingById(bookingId);
    if (!isBookingIndianStatusActive(beforeBooking) && !beforeBooking.indian_status_gst_only) {
      return beforeBooking;
    }

    const restoreOrderTotal = beforeBooking.indian_status_restore_order_total;
    const restoreTaxAmount = beforeBooking.indian_status_restore_tax_amount;
    const hasRestore = restoreOrderTotal != null && restoreTaxAmount != null;

    const patch = {
      indian_status_gst_only: false,
      indian_status_certificate_number: null,
      indian_status_restore_order_total: null,
      indian_status_restore_tax_amount: null,
      updated_at: new Date().toISOString(),
    };

    if (hasRestore) {
      patch.order_total = Number(restoreOrderTotal) || 0;
      patch.tax_amount = Number(restoreTaxAmount) || 0;
    }

    if (audit.updatedBy) patch.updated_by = audit.updatedBy;
    if (audit.updatedIp) patch.updated_ip = audit.updatedIp;

    const { error } = await supabase
      .from('bookings')
      .update(patch)
      .eq('id', bookingId)
      .eq('business_id', this.businessId);

    if (error) throw error;

    if (!hasRestore) {
      await this._syncBookingCheckoutBaseline(bookingId, audit);
    } else {
      await this.touchBookingAudit(bookingId, audit);
    }

    await this._logBookingHistory({
      bookingId,
      actionType: BOOKING_HISTORY_ACTIONS.PRICING_UPDATED,
      summary: 'Indian Status (GST only) removed',
      details: { restored: hasRestore },
      audit,
    });

    return this.getBookingById(bookingId);
  }

  async listBookingNotes(bookingId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('booking_notes')
      .select('id, booking_id, note_text, created_by, updated_by, created_at, updated_at')
      .eq('booking_id', bookingId)
      .eq('business_id', this.businessId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading booking notes:', error);
      throw error;
    }

    return data || [];
  }

  async createBookingNote(bookingId, noteText, createdBy, audit = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const text = String(noteText || '').trim();
    if (!text) {
      throw new Error('Note text is required');
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('booking_notes')
      .insert({
        business_id: this.businessId,
        booking_id: bookingId,
        note_text: text,
        created_by: createdBy || null,
        updated_by: createdBy || null,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating booking note:', error);
      throw error;
    }

    await this.touchBookingAudit(bookingId, audit);

    const excerpt = text.length > 120 ? `${text.slice(0, 117)}…` : text;
    await this._logBookingHistory({
      bookingId,
      actionType: BOOKING_HISTORY_ACTIONS.NOTE_ADDED,
      summary: `Note added: ${excerpt}`,
      details: { note_excerpt: text, note_id: data?.id || null },
      audit,
    });

    return data;
  }

  async updateBookingNote(noteId, noteText, updatedBy, audit = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const text = String(noteText || '').trim();
    if (!text) {
      throw new Error('Note text is required');
    }

    const { data: existing, error: existingError } = await supabase
      .from('booking_notes')
      .select('id, booking_id, created_by, note_text')
      .eq('id', noteId)
      .eq('business_id', this.businessId)
      .maybeSingle();

    if (existingError || !existing) {
      throw new Error('Note not found');
    }

    if (updatedBy && existing.created_by && existing.created_by !== updatedBy) {
      throw new Error('You can only edit your own notes');
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('booking_notes')
      .update({
        note_text: text,
        updated_by: updatedBy || null,
        updated_at: now,
      })
      .eq('id', noteId)
      .eq('business_id', this.businessId)
      .select()
      .single();

    if (error) {
      console.error('Error updating booking note:', error);
      throw error;
    }

    await this.touchBookingAudit(existing.booking_id, audit);

    const excerpt = text.length > 120 ? `${text.slice(0, 117)}…` : text;
    await this._logBookingHistory({
      bookingId: existing.booking_id,
      actionType: BOOKING_HISTORY_ACTIONS.NOTE_UPDATED,
      summary: `Note updated: ${excerpt}`,
      details: {
        note_id: noteId,
        note_excerpt: text,
        previous_excerpt: existing.note_text || null,
      },
      audit,
    });

    return data;
  }

  async deleteBookingNote(noteId, deletedBy = null, audit = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: existing, error: existingError } = await supabase
      .from('booking_notes')
      .select('id, booking_id, created_by, note_text')
      .eq('id', noteId)
      .eq('business_id', this.businessId)
      .maybeSingle();

    if (existingError || !existing) {
      throw new Error('Note not found');
    }

    if (deletedBy && existing.created_by && existing.created_by !== deletedBy) {
      throw new Error('You can only delete your own notes');
    }

    const { error } = await supabase
      .from('booking_notes')
      .delete()
      .eq('id', noteId)
      .eq('business_id', this.businessId);

    if (error) {
      console.error('Error deleting booking note:', error);
      throw error;
    }

    await this.touchBookingAudit(existing.booking_id, audit);

    const excerpt = String(existing.note_text || '').trim();
    const summaryExcerpt = excerpt.length > 120 ? `${excerpt.slice(0, 117)}…` : excerpt;
    await this._logBookingHistory({
      bookingId: existing.booking_id,
      actionType: BOOKING_HISTORY_ACTIONS.NOTE_DELETED,
      summary: summaryExcerpt ? `Note deleted: ${summaryExcerpt}` : 'Note deleted',
      details: { note_id: noteId, note_excerpt: excerpt || null },
      audit,
    });

    return true;
  }

  async replaceResourceAssignments(bookingId, assignments = [], source = 'manual', audit = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const beforeBooking = await this.getBookingById(bookingId);
    const beforeAssignments = this._snapshotResourceAssignments(beforeBooking);

    const normalized = (Array.isArray(assignments) ? assignments : [])
      .map((assignment) => ({
        categoryId: assignment.categoryId || assignment.category_id,
        resourceId: assignment.resourceId || assignment.resource_id,
        notes: assignment.notes || null
      }))
      .filter((assignment) => assignment.categoryId && assignment.resourceId);

    const { error } = await supabase.rpc('replace_booking_resource_assignments', {
      booking_uuid: bookingId,
      business_uuid: this.businessId,
      assignments: normalized,
      assignment_source: source
    });

    if (error) {
      console.error('Error replacing booking resource assignments:', error);
      throw error;
    }

    await this.touchBookingAudit(bookingId, audit);

    const updatedBooking = await this.getBookingById(bookingId);
    const afterAssignments = this._snapshotResourceAssignments(updatedBooking);
    const changes = this._describeResourceAssignmentChanges(beforeAssignments, afterAssignments);
    if (changes.length > 0) {
      await this._logBookingHistory({
        bookingId,
        actionType: BOOKING_HISTORY_ACTIONS.RESOURCE_UPDATED,
        summary: source === 'schedule' ? 'Resources updated from schedule' : 'Room / resource updated',
        details: { changes, source },
        audit,
      });
    }

    return updatedBooking;
  }

  async _resolveBookingCustomerParticipantId(customerId, row = {}) {
    const explicitId = row.participant_id || row.booking_customer_participant_id;
    if (explicitId) return explicitId;
    if (!this.businessId || !customerId) return null;

    const firstName = String(row.first_name || '').trim();
    const lastName = String(row.last_name || '').trim();
    if (!firstName && !lastName) return null;

    const { data: matches } = await supabase
      .from('booking_customer_participants')
      .select('id')
      .eq('business_id', this.businessId)
      .eq('customer_id', customerId)
      .ilike('first_name', firstName)
      .ilike('last_name', lastName)
      .limit(1);

    if (matches?.[0]?.id) return matches[0].id;

    const { data: created, error } = await supabase
      .from('booking_customer_participants')
      .insert({
        business_id: this.businessId,
        customer_id: customerId,
        first_name: firstName || 'Guest',
        last_name: lastName,
        date_of_birth: row.date_of_birth || null,
        email: row.email || null,
        phone_number: row.phone_number || null,
        is_account_owner: row.party_role === 'host_adult',
        is_active: true,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[BookingService] booking_customer_participants insert failed:', error);
      throw new Error(error.message || 'Could not save participant profile');
    }

    return created?.id ?? null;
  }

  /**
   * Staff/portal create: resolve booking_customer_participants then insert valid
   * booking_participants link rows (no denormalized name columns).
   */
  async _insertParticipantsForNewBooking(bookingId, customerId, participants = []) {
    if (!bookingId || !Array.isArray(participants) || participants.length === 0) return;

    if (!customerId) {
      throw new Error(
        'A customer account is required before saving participants. Add a customer name and try again.'
      );
    }

    const rows = [];
    for (const p of participants) {
      const payload = {
        first_name: p.firstName || p.first_name || '',
        last_name: p.lastName || p.last_name || '',
        date_of_birth: p.dateOfBirth || p.date_of_birth || null,
        email: p.email || null,
        phone_number: p.phoneNumber || p.phone_number || null,
        party_role: p.partyRole || p.party_role || null,
        inventory_item_id: p.inventoryItemId || p.inventory_item_id || null,
        waiver_status: p.waiverStatus || p.waiver_status || 'missing',
        waiver_id: p.waiverId || p.waiver_id || null,
        waiver_participant_id: p.waiverParticipantId || p.waiver_participant_id || null,
        camper_registration_document_id:
          p.camperRegistrationDocumentId || p.camper_registration_document_id || null,
        camper_registration_status:
          p.camperRegistrationStatus || p.camper_registration_status || 'not_required',
      };

      const participantId = await this._resolveBookingCustomerParticipantId(customerId, payload);
      if (!participantId) {
        const label = `${payload.first_name} ${payload.last_name}`.trim() || 'participant';
        throw new Error(`Could not save ${label}`);
      }

      const waiverStatus = payload.waiver_status || 'missing';
      rows.push({
        booking_id: bookingId,
        participant_id: participantId,
        waiver_participant_id: payload.waiver_participant_id || null,
        inventory_item_id: payload.inventory_item_id || null,
        party_role: payload.party_role || null,
        waiver_id: waiverStatus === 'valid' ? payload.waiver_id : null,
        waiver_status: waiverStatus,
        camper_registration_document_id: payload.camper_registration_document_id,
        camper_registration_status: payload.camper_registration_status,
      });
    }

    const uniqueCheck = assertUniqueBookingParticipantIdentities(rows);
    if (!uniqueCheck.ok) {
      throw new Error(uniqueCheck.message);
    }

    const { error } = await supabase.from('booking_participants').insert(rows);
    if (error) {
      console.error('Error creating booking participants:', error);
      throw error;
    }
  }

  /**
   * Ensure a loyalty customer exists for staff walk-ups (name-only allowed).
   */
  async _ensureCustomerIdForBooking(bookingData = {}) {
    if (bookingData.customerId) return bookingData.customerId;

    const email = String(bookingData.customerEmail || '').trim().toLowerCase();
    const phoneDigits = String(bookingData.customerPhone || '').replace(/\D/g, '');
    const firstFromParticipants = bookingData.participants?.[0];
    const firstName = String(
      bookingData.customerFirstName
      || firstFromParticipants?.firstName
      || firstFromParticipants?.first_name
      || ''
    ).trim();
    const lastName = String(
      bookingData.customerLastName
      || firstFromParticipants?.lastName
      || firstFromParticipants?.last_name
      || ''
    ).trim();

    if (email || phoneDigits) {
      const { data: customerRows, error } = await supabase.rpc(
        'bookings_create_or_get_portal_customer',
        {
          p_business_id: this.businessId,
          p_phone_number: phoneDigits || null,
          p_email: email || null,
          p_first_name: firstName || '',
          p_last_name: lastName || '',
          p_city: null,
        }
      );
      if (error) throw new Error(error.message || 'Could not create customer account');
      const customer = Array.isArray(customerRows) ? customerRows[0] : customerRows;
      if (!customer?.id) throw new Error('Could not create customer account');
      return customer.id;
    }

    const customerName = `${firstName} ${lastName}`.trim() || 'Guest';
    const { data: created, error: insertError } = await supabase
      .from('pos_loyalty_accounts')
      .insert({
        business_id: this.businessId,
        customer_name: customerName,
        customer_email: null,
        customer_phone: null,
      })
      .select('id')
      .single();

    if (insertError) {
      throw new Error(insertError.message || 'Could not create customer account');
    }
    return created.id;
  }

  _snapshotBookingParticipants(booking) {
    return (booking?.booking_participants || []).map((participant) => ({
      id: participant.id,
      name: getParticipantDisplayName(participant),
      party_role: participant.party_role || null,
    }));
  }

  async replaceBookingParticipants(bookingId, participantPayloads = [], audit = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const beforeBooking = await this.getBookingById(bookingId);
    const existingParticipants = beforeBooking?.booking_participants || [];
    const existingByIdentity = new Map();
    existingParticipants.forEach((participant) => {
      existingByIdentity.set(participantIdentityKey(participant), participant);
      if (participant.id) existingByIdentity.set(`id:${participant.id}`, participant);
    });

    const payloadUniqueCheck = assertUniqueBookingParticipantIdentities(participantPayloads);
    if (!payloadUniqueCheck.ok) {
      throw new Error(payloadUniqueCheck.message);
    }

    const rows = [];
    for (const payload of participantPayloads) {
      const existingMatch =
        payload.bookingParticipant
        || existingByIdentity.get(participantIdentityKey(payload))
        || null;

      const participantId = await this._resolveBookingCustomerParticipantId(
        beforeBooking.customer_id,
        payload,
      );

      const waiverStatus = payload.waiver_status || existingMatch?.waiver_status || 'missing';
      const waiverId = waiverStatus === 'valid'
        ? (payload.waiver_id || existingMatch?.waiver_id || null)
        : (existingMatch?.waiver_id || null);

      const insertRow = {
        booking_id: bookingId,
        participant_id: participantId,
        waiver_participant_id: payload.waiver_participant_id || existingMatch?.waiver_participant_id || null,
        inventory_item_id: existingMatch?.inventory_item_id || null,
        party_role: payload.party_role || null,
        waiver_id: waiverId,
        waiver_status: waiverStatus,
        camper_registration_document_id: existingMatch?.camper_registration_document_id || null,
        camper_registration_status: existingMatch?.camper_registration_status || 'not_required',
      };

      if (this._participantCheckedInColumnAvailable !== false && existingMatch?.checked_in_at) {
        insertRow.checked_in_at = existingMatch.checked_in_at;
      }

      rows.push(insertRow);
    }

    const uniqueCheck = assertUniqueBookingParticipantIdentities(rows);
    if (!uniqueCheck.ok) {
      throw new Error(uniqueCheck.message);
    }

    const { error: deleteError } = await supabase
      .from('booking_participants')
      .delete()
      .eq('booking_id', bookingId);

    if (deleteError) {
      console.error('Error clearing booking participants:', deleteError);
      throw deleteError;
    }

    if (rows.length > 0) {
      const { error: insertError } = await supabase
        .from('booking_participants')
        .insert(rows);

      if (insertError) {
        console.error('Error inserting booking participants:', insertError);
        throw insertError;
      }
    }

    await this.touchBookingAudit(bookingId, audit);

    try {
      await this._syncBookingStatusFromParticipants(bookingId);
    } catch (syncError) {
      console.warn('[BookingService] participant sync status:', syncError);
    }

    const updatedBooking = await this.getBookingById(bookingId);
    const beforeNames = this._snapshotBookingParticipants(beforeBooking).map((row) => row.name);
    const afterNames = this._snapshotBookingParticipants(updatedBooking).map((row) => row.name);

    if (beforeNames.join('|') !== afterNames.join('|')) {
      await this._logBookingHistory({
        bookingId,
        actionType: BOOKING_HISTORY_ACTIONS.PARTICIPANTS_UPDATED,
        summary: `Party attendees updated (${afterNames.length} attending)`,
        details: {
          before_count: beforeNames.length,
          after_count: afterNames.length,
          attendees: afterNames,
        },
        audit,
      });
    }

    return updatedBooking;
  }

  async _rebalancePoolOccupantsOffNeededRooms({
    bookingDate,
    bookingTime,
    durationMinutes,
    neededResourceIds = [],
    dayBookings = [],
    businessTimezone,
    excludeBookingId = null,
  } = {}) {
    const needed = new Set((neededResourceIds || []).map(String).filter(Boolean));
    if (!needed.size || !this.businessId) return dayBookings;

    const mutable = [...(dayBookings || [])];

    for (const booking of [...mutable]) {
      if (!booking?.id || booking.id === excludeBookingId) continue;
      const assignments = Array.isArray(booking.booking_resource_assignments)
        ? booking.booking_resource_assignments
        : [];
      const conflicting = assignments.filter((row) => needed.has(String(row.resource_id || '')));
      if (!conflicting.length || !booking.activity_id) continue;

      const schedules = await fetchActivitySchedules(supabase, this.businessId, booking.activity_id);
      const matches = findMatchingScheduleSlots(
        schedules,
        bookingDate,
        booking.booking_time || bookingTime,
        businessTimezone,
      );
      const merged = mergeScheduleResourceAssignments(matches);
      const requirements = listScheduleResourceRequirements(merged);
      if (!requirements.some((row) => row.mode === 'pool')) continue;

      const withoutThis = mutable.map((row) => (
        row.id === booking.id
          ? { ...row, booking_resource_assignments: [] }
          : row
      ));

      const reassigned = resolveConcreteResourceAssignmentsForSchedule({
        schedule: { resource_assignments: merged },
        bookingDate,
        bookingTime: booking.booking_time || bookingTime,
        durationMinutes:
          Number(booking.duration_minutes)
          || Number(booking.booking_activities?.duration_minutes)
          || durationMinutes
          || 90,
        dayBookings: withoutThis,
        excludeBookingId: booking.id,
        preferredResourceIds: requirements
          .flatMap((row) => row.pool)
          .filter((id) => !needed.has(id)),
      });

      if (!reassigned.ok || !reassigned.assignments?.length) continue;
      if (reassigned.assignments.some((row) => needed.has(row.resourceId))) continue;

      await this.replaceResourceAssignments(
        booking.id,
        reassigned.assignments.map((row) => ({
          categoryId: row.categoryId,
          resourceId: row.resourceId,
        })),
        'schedule',
        { source: 'pool_rebalance' },
      );

      const idx = mutable.findIndex((row) => row.id === booking.id);
      if (idx >= 0) {
        mutable[idx] = {
          ...mutable[idx],
          booking_resource_assignments: reassigned.assignments.map((row) => ({
            category_id: row.categoryId,
            resource_id: row.resourceId,
          })),
        };
      }
    }

    return mutable;
  }

  async resolveScheduleResourceAssignments(activityId, bookingDate, bookingTime, businessTimezone, {
    excludeBookingId = null,
    durationMinutes = null,
  } = {}) {
    if (!this.businessId || !activityId || !bookingDate || !bookingTime) {
      return [];
    }

    const schedules = await fetchActivitySchedules(supabase, this.businessId, activityId);
    const matches = findMatchingScheduleSlots(
      schedules,
      bookingDate,
      bookingTime,
      businessTimezone,
    );
    const merged = mergeScheduleResourceAssignments(matches);
    if (!listScheduleResourceRequirements(merged).length) {
      return [];
    }

    const [{ data: dayBookings }, { data: peerSchedules }] = await Promise.all([
      supabase
        .from('bookings')
        .select(`
          id,
          status,
          booking_time,
          duration_minutes,
          activity_id,
          booking_activities ( duration_minutes ),
          booking_resource_assignments ( category_id, resource_id )
        `)
        .eq('business_id', this.businessId)
        .eq('booking_date', bookingDate)
        .in('status', ACTIVE_BOOKING_STATUSES_FOR_RESOURCE),
      supabase
        .from('booking_activity_schedules')
        .select('id, activity_id, day_of_week, start_time, start_date, end_date, resource_assignments')
        .eq('business_id', this.businessId)
        .eq('is_active', true)
        .neq('activity_id', activityId),
    ]);

    const peerDaySchedules = (peerSchedules || []).filter((schedule) => {
      const date = dayjs.tz(bookingDate, businessTimezone).toDate();
      return pickSchedulesForActivityOnDate([schedule], date, businessTimezone).length > 0;
    });
    const peerMatches = filterPeerSchedulesOverlappingWindow({
      peerSchedules: peerDaySchedules,
      bookingTime,
      durationMinutes: durationMinutes || 90,
      peerDurationMinutes: 90,
      fixedOnly: true,
    });

    let workingDayBookings = (dayBookings || []).filter((row) => row.id !== excludeBookingId);

    // Move flexible (pool) bookings off rooms needed by fixed multi-room packages.
    const neededFixedIds = listScheduleResourceRequirements(merged)
      .filter((row) => row.mode === 'fixed')
      .flatMap((row) => row.resourceIds);
    if (neededFixedIds.length) {
      workingDayBookings = await this._rebalancePoolOccupantsOffNeededRooms({
        bookingDate,
        bookingTime,
        durationMinutes,
        neededResourceIds: neededFixedIds,
        dayBookings: workingDayBookings,
        businessTimezone,
        excludeBookingId,
      });
    }

    const resolved = resolveConcreteResourceAssignmentsForSchedule({
      schedule: { resource_assignments: merged },
      bookingDate,
      bookingTime,
      durationMinutes,
      dayBookings: workingDayBookings,
      excludeBookingId,
      peerSchedules: peerMatches,
    });

    if (!resolved.ok) {
      throw new Error(
        resolved.message ||
          'Required party room(s) are not available for this time. Choose another time.',
      );
    }

    return (resolved.assignments || []).map((row) => ({
      categoryId: row.categoryId,
      resourceId: row.resourceId,
      source: 'schedule',
    }));
  }

  async syncResourceAssignmentsFromSchedule(
    bookingId,
    activityId,
    bookingDate,
    bookingTime,
    { replaceExisting = false, businessData = null, audit = {}, durationMinutes = null } = {},
  ) {
    if (!this.businessId || !bookingId || !activityId || !bookingDate || !bookingTime) {
      return [];
    }

    const businessTimezone = getBusinessTimezone(businessData);
    const assignments = await this.resolveScheduleResourceAssignments(
      activityId,
      bookingDate,
      bookingTime,
      businessTimezone,
      { excludeBookingId: bookingId, durationMinutes },
    );

    if (assignments.length === 0) {
      if (replaceExisting) {
        await this.replaceResourceAssignments(bookingId, [], 'schedule', audit);
      }
      return [];
    }

    await this.replaceResourceAssignments(bookingId, assignments, 'schedule', audit);
    return assignments;
  }

  async extendBookingTime(bookingId, {
    addedMinutes,
    extensionType = 'courtesy',
    reason = '',
    amountCharged = null,
    calculatedCharge = null,
    priceOverridden = false,
    audit = {},
  } = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const minutes = parseInt(addedMinutes, 10);
    if (!Number.isFinite(minutes) || minutes === 0) {
      throw new Error('Enter a valid number of minutes to add.');
    }

    const { error } = await supabase.rpc('extend_booking_time', {
      booking_uuid: bookingId,
      business_uuid: this.businessId,
      added_minutes_param: minutes,
      extension_type_param: extensionType || 'courtesy',
      reason_param: reason || null,
      amount_charged_param: amountCharged == null || amountCharged === ''
        ? null
        : Number(amountCharged)
    });

    if (error) {
      console.error('Error extending booking time:', error);
      throw error;
    }

    const paidCharge = extensionType === 'paid'
      ? Math.max(0, Math.round((Number(amountCharged) || 0) * 100) / 100)
      : 0;

    if (paidCharge > 0) {
      await this.addManualAddonLinesToBooking(
        bookingId,
        [{
          addonName: `Time extension (+${minutes} min)`,
          quantity: 1,
          unitPrice: paidCharge,
        }],
        audit,
        { skipHistoryLog: true },
      );
    } else {
      await this.touchBookingAudit(bookingId, audit);
    }

    const historyChanges = [
      { field: 'Minutes added', from: null, to: String(minutes) },
      { field: 'Extension type', from: null, to: extensionType || 'courtesy' },
    ];
    if (paidCharge > 0) {
      historyChanges.push({ field: 'Extension charge', from: null, to: `$${paidCharge.toFixed(2)}` });
    }

    await this._logBookingHistory({
      bookingId,
      actionType: BOOKING_HISTORY_ACTIONS.EXTENDED,
      summary: paidCharge > 0
        ? `Booking extended by ${minutes} minute${Math.abs(minutes) === 1 ? '' : 's'} · $${paidCharge.toFixed(2)} added to balance`
        : `Booking extended by ${minutes} minute${Math.abs(minutes) === 1 ? '' : 's'}`,
      details: {
        changes: historyChanges,
        reason: reason || null,
        amount_charged: paidCharge > 0 ? paidCharge : amountCharged,
        calculated_charge: calculatedCharge,
        price_overridden: priceOverridden === true,
      },
      audit,
    });

    return this.getBookingById(bookingId);
  }

  /**
   * Append manual addon line items to an existing booking (same pattern as createBooking addons).
   * Each line: { addonName, quantity, unitPrice, taxRateIds?: [], taxRateId?: id }
   */
  async addManualAddonLinesToBooking(bookingId, lines, audit = {}, options = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }
    if (!bookingId || !Array.isArray(lines) || lines.length === 0) {
      return this.getBookingById(bookingId);
    }

    const booking = await this.getBookingById(bookingId);

    const requestedTaxRateIds = Array.from(
      new Set(
        lines.flatMap((addon) => {
          if (Array.isArray(addon.taxRateIds)) {
            return addon.taxRateIds.filter(Boolean);
          }
          return addon.taxRateId ? [addon.taxRateId] : [];
        })
      )
    );

    let taxRateMap = new Map();
    if (requestedTaxRateIds.length > 0) {
      const { data: taxRates, error: taxRatesError } = await supabase
        .from('pos_tax_categories')
        .select('id, name, rate, category_type')
        .eq('business_id', this.businessId)
        .in('id', requestedTaxRateIds);

      if (taxRatesError) {
        console.error('Error loading tax rates for booking addons:', taxRatesError);
      } else {
        taxRateMap = new Map(
          (taxRates || [])
            .filter((taxRate) => taxRate.category_type === 'tax')
            .map((taxRate) => [taxRate.id, taxRate])
        );
      }
    }

    const resolvedAddonItems = [];
    const addedItemSummaries = [];

    for (const addon of lines) {
      let addonId = addon.addonId || null;
      const quantity = Math.max(1, parseInt(addon.quantity, 10) || 1);
      const unitPrice = Number.parseFloat(addon.unitPrice) || 0;
      const itemSubtotal = quantity * unitPrice;
      const selectedTaxRateIds = Array.isArray(addon.taxRateIds)
        ? addon.taxRateIds.filter(Boolean)
        : addon.taxRateId
          ? [addon.taxRateId]
          : [];
      const selectedTaxRates = selectedTaxRateIds
        .map((taxRateId) => taxRateMap.get(taxRateId))
        .filter(Boolean);
      const appliedTaxRate = selectedTaxRates.reduce(
        (sum, taxRate) => sum + (Number.parseFloat(taxRate?.rate) || 0),
        0
      );
      const taxAmount = itemSubtotal * appliedTaxRate;
      const taxDescription = selectedTaxRates.length > 0
        ? `Manual booking item. Taxes: ${selectedTaxRates
            .map(
              (taxRate) =>
                `${taxRate.name} (${((Number.parseFloat(taxRate.rate) || 0) * 100).toFixed(2)}%)`
            )
            .join(', ')}. Total tax amount: ${taxAmount.toFixed(2)}.`
        : 'Manual booking item. No tax applied.';

      if (!addonId && addon.addonName) {
        const addonKey = `manual-${bookingId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { data: createdAddon, error: createdAddonError } = await supabase
          .from('booking_addons')
          .insert({
            business_id: this.businessId,
            addon_name: addon.addonName,
            addon_key: addonKey,
            description: taxDescription,
            price: unitPrice,
            is_global: false,
            activity_ids: booking.activity_id ? [booking.activity_id] : null,
            inventory_tracked: false,
            current_stock: null,
            is_active: false
          })
          .select('id')
          .single();

        if (createdAddonError) {
          console.error('Error creating manual booking addon:', createdAddonError);
          continue;
        }

        addonId = createdAddon?.id || null;
      }

      if (!addonId) continue;

      resolvedAddonItems.push({
        booking_id: bookingId,
        addon_id: addonId,
        quantity,
        unit_price: unitPrice
      });

      addedItemSummaries.push({
        name: addon.addonName || 'Additional item',
        quantity,
        unit_price: unitPrice,
      });
    }

    if (resolvedAddonItems.length > 0) {
      const { error: addonsError } = await supabase
        .from('booking_addon_items')
        .insert(resolvedAddonItems);

      if (addonsError) {
        throw addonsError;
      }
    }

    await this.touchBookingAudit(bookingId, audit);

    if (addedItemSummaries.length > 0 && !options.skipHistoryLog) {
      const first = addedItemSummaries[0];
      const summary = addedItemSummaries.length === 1
        ? `Added ${first.name} × ${first.quantity}`
        : `Added ${addedItemSummaries.length} additional items`;
      await this._logBookingHistory({
        bookingId,
        actionType: BOOKING_HISTORY_ACTIONS.MANUAL_ITEM_ADDED,
        summary,
        details: { items: addedItemSummaries },
        audit,
      });
    }

    return this.getBookingById(bookingId);
  }

  async deleteBookingAddonItem(lineItemId, audit = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }
    const { data: item, error: e1 } = await supabase
      .from('booking_addon_items')
      .select('id, booking_id, quantity, unit_price, booking_addons:addon_id (addon_name, addon_key)')
      .eq('id', lineItemId)
      .maybeSingle();
    if (e1) throw e1;
    if (!item) {
      throw new Error('Addon line not found');
    }
    const { data: booking, error: e2 } = await supabase
      .from('bookings')
      .select('id')
      .eq('id', item.booking_id)
      .eq('business_id', this.businessId)
      .maybeSingle();
    if (e2) throw e2;
    if (!booking) {
      throw new Error('Addon line not found');
    }
    const { error } = await supabase.from('booking_addon_items').delete().eq('id', lineItemId);
    if (error) throw error;

    await this.touchBookingAudit(item.booking_id, audit);

    const addonName = item?.booking_addons?.addon_name || 'Additional item';
    const qty = item.quantity ?? 1;
    await this._logBookingHistory({
      bookingId: item.booking_id,
      actionType: BOOKING_HISTORY_ACTIONS.MANUAL_ITEM_REMOVED,
      summary: `Removed ${addonName} × ${qty}`,
      details: {
        items: [{
          name: addonName,
          quantity: qty,
          unit_price: item.unit_price ?? null,
        }],
      },
      audit,
    });

    return this.getBookingById(item.booking_id);
  }

  /**
   * Replace portal option line items for a booking from staff selections.
   * Non-portal (manual) addon lines are left unchanged.
   */
  async syncPortalOptionSelectionsForBooking(
    bookingId,
    selections,
    { inventoryItems = [], bundleContext = {}, audit = {} } = {},
  ) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }
    if (!bookingId) {
      throw new Error('Booking ID is required');
    }

    const booking = await this.getBookingById(bookingId);
    const beforePortalItems = this._portalOptionItemsFromBooking(booking, bookingId);
    const activity = booking?.booking_activities || {};
    const addonSettings = activity?.addon_settings;

    const rows = buildPortalOptionCheckoutRows(
      addonSettings,
      selections,
      inventoryItems,
      bundleContext,
      { skipVisibilityFilter: true },
    );

    const existingItems = (booking?.booking_addon_items || []).filter((item) => {
      const key = String(item?.booking_addons?.addon_key || '');
      return key.startsWith(`portal-${bookingId}-`);
    });

    const existingByOptionId = new Map();
    for (const item of existingItems) {
      const optionId = extractPortalOptionIdFromAddon(item.booking_addons || {}, bookingId);
      if (optionId && !existingByOptionId.has(optionId)) {
        existingByOptionId.set(optionId, item);
      }
    }

    const desiredOptionIds = new Set(rows.map((row) => row.option_id));

    for (const item of existingItems) {
      const optionId = extractPortalOptionIdFromAddon(item.booking_addons || {}, bookingId);
      if (!optionId || !desiredOptionIds.has(optionId)) {
        const { error: deleteError } = await supabase
          .from('booking_addon_items')
          .delete()
          .eq('id', item.id);
        if (deleteError) throw deleteError;
      }
    }

    for (const row of rows) {
      const existing = existingByOptionId.get(row.option_id);
      if (existing) {
        const { error: lineError } = await supabase
          .from('booking_addon_items')
          .update({
            quantity: row.quantity,
            unit_price: row.unit_price,
          })
          .eq('id', existing.id);
        if (lineError) throw lineError;

        if (existing.addon_id) {
          const { error: addonError } = await supabase
            .from('booking_addons')
            .update({
              addon_name: row.name,
              price: row.unit_price,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.addon_id)
            .eq('business_id', this.businessId);
          if (addonError) throw addonError;
        }
        continue;
      }

      const addonKey = `portal-${bookingId}-${row.option_id}`;
      const { data: createdAddon, error: createdAddonError } = await supabase
        .from('booking_addons')
        .insert({
          business_id: this.businessId,
          addon_name: row.name,
          addon_key: addonKey,
          description: 'Customer portal option',
          price: row.unit_price,
          is_global: false,
          activity_ids: booking.activity_id ? [booking.activity_id] : null,
          inventory_tracked: false,
          current_stock: null,
          is_active: false,
        })
        .select('id')
        .single();

      if (createdAddonError || !createdAddon?.id) {
        console.error('Error creating portal booking addon:', createdAddonError);
        continue;
      }

      const { error: insertError } = await supabase.from('booking_addon_items').insert({
        booking_id: bookingId,
        addon_id: createdAddon.id,
        quantity: row.quantity,
        unit_price: row.unit_price,
      });
      if (insertError) throw insertError;
    }

    await this._syncBookingCheckoutBaseline(bookingId, audit);

    const updatedBooking = await this.getBookingById(bookingId);
    const afterPortalItems = this._portalOptionItemsFromBooking(updatedBooking, bookingId);
    const optionChanges = summarizePortalOptionChanges(beforePortalItems, afterPortalItems, bookingId);
    await this._logBookingHistory({
      bookingId,
      actionType: BOOKING_HISTORY_ACTIONS.OPTIONS_UPDATED,
      summary: optionChanges.length === 1 && optionChanges[0]?.text
        ? optionChanges[0].text
        : 'Activity options updated',
      details: { changes: optionChanges },
      audit,
    });

    return updatedBooking;
  }

  async _resolveMultiDayFamily(bookingId) {
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('id, parent_booking_id, multi_day_role')
      .eq('id', bookingId)
      .eq('business_id', this.businessId)
      .maybeSingle();

    if (error || !booking) {
      return { rootId: bookingId, memberIds: [bookingId] };
    }

    const rootId = booking.multi_day_role === 'day' && booking.parent_booking_id
      ? booking.parent_booking_id
      : booking.id;

    const { data: members, error: membersError } = await supabase
      .from('bookings')
      .select('id')
      .eq('business_id', this.businessId)
      .or(`id.eq.${rootId},parent_booking_id.eq.${rootId}`);

    if (membersError) throw membersError;

    return {
      rootId,
      memberIds: (members || []).map((row) => row.id),
    };
  }

  async _syncMultiDayFamilyStatus(memberIds, patch) {
    if (!memberIds?.length) return;
    const { error } = await supabase
      .from('bookings')
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .eq('business_id', this.businessId)
      .in('id', memberIds);
    if (error) throw error;
  }

  // Cancel booking
  async cancelBooking(bookingId, reason, audit = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: existing, error: fetchError } = await supabase
      .from('bookings')
      .select('status, multi_day_role')
      .eq('id', bookingId)
      .eq('business_id', this.businessId)
      .single();

    if (fetchError || !existing) {
      throw new Error('Booking not found');
    }

    if (existing.status === 'cancelled') {
      throw new Error('Booking is already cancelled');
    }

    const { rootId, memberIds } = await this._resolveMultiDayFamily(bookingId);

    const auditPatch = {};
    if (audit.updatedBy) auditPatch.updated_by = audit.updatedBy;
    if (audit.updatedIp) auditPatch.updated_ip = audit.updatedIp;

    const cancelPatch = {
      status: 'cancelled',
      cancellation_reason: reason,
      cancelled_at: new Date().toISOString(),
      ...auditPatch,
    };

    await this._syncMultiDayFamilyStatus(memberIds, {
      ...cancelPatch,
      status_before_cancellation: existing.status,
    });

    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', rootId)
      .eq('business_id', this.businessId)
      .single();

    if (error) {
      console.error('Error cancelling booking:', error);
      throw error;
    }

    await this._logBookingHistory({
      bookingId: rootId,
      actionType: BOOKING_HISTORY_ACTIONS.CANCELLED,
      summary: memberIds.length > 1 ? `Multi-day booking cancelled (${memberIds.length} days)` : 'Booking cancelled',
      details: {
        reason: reason || null,
        changes: [{ field: 'Status', from: existing.status, to: 'cancelled' }],
      },
      audit,
    });

    try {
      await supabase.functions.invoke('send-booking-cancellation', {
        body: {
          businessId: this.businessId,
          bookingId: rootId,
          cancelledBy: 'staff',
          reason: reason || null,
          cancelledAt: data.cancelled_at,
        },
      });
    } catch (emailErr) {
      console.warn('Cancellation confirmation email failed:', emailErr);
    }

    return data;
  }

  async restoreBooking(bookingId, audit = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: existing, error: fetchError } = await supabase
      .from('bookings')
      .select('status, status_before_cancellation, requires_approval, approved_at, checked_in_at')
      .eq('id', bookingId)
      .eq('business_id', this.businessId)
      .single();

    if (fetchError || !existing) {
      throw new Error('Booking not found');
    }

    if (existing.status !== 'cancelled') {
      throw new Error('Only cancelled bookings can be restored');
    }

    const { rootId, memberIds } = await this._resolveMultiDayFamily(bookingId);

    let restoredStatus = existing.status_before_cancellation;
    if (!restoredStatus || restoredStatus === 'cancelled') {
      if (existing.checked_in_at) {
        restoredStatus = 'checked_in';
      } else if (existing.approved_at || !existing.requires_approval) {
        restoredStatus = 'confirmed';
      } else {
        restoredStatus = 'pending';
      }
    }

    const auditPatch = {};
    if (audit.updatedBy) auditPatch.updated_by = audit.updatedBy;
    if (audit.updatedIp) auditPatch.updated_ip = audit.updatedIp;

    await this._syncMultiDayFamilyStatus(memberIds, {
      status: restoredStatus,
      cancelled_at: null,
      cancellation_reason: null,
      status_before_cancellation: null,
      payment_cancel_deadline_at: null,
      payment_cancel_warning_sent_at: null,
      payment_cancel_warning_sent_by: null,
      ...auditPatch,
    });

    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', rootId)
      .eq('business_id', this.businessId)
      .single();

    if (error) {
      console.error('Error restoring booking:', error);
      throw error;
    }

    await this._logBookingHistory({
      bookingId: rootId,
      actionType: BOOKING_HISTORY_ACTIONS.RESTORED,
      summary: memberIds.length > 1 ? `Multi-day booking restored (${memberIds.length} days)` : 'Booking restored',
      details: {
        changes: [{ field: 'Status', from: 'cancelled', to: restoredStatus }],
      },
      audit,
    });

    return data;
  }

  _isBookingAwaitingStaffApproval(bookingRow) {
    return Boolean(bookingRow?.requires_approval) && !bookingRow?.approved_at;
  }

  /**
   * Sync booking.status / checked_in_at from participant rows.
   * All participants checked in → booking checked_in; partial → confirmed (or pending); none → pending or confirmed.
   * Bookings awaiting staff approval stay pending until booking-approve-request runs.
   */
  async syncBookingCheckInFromParticipants(bookingId, businessIdOverride = null) {
    const businessId = businessIdOverride || this.businessId;
    if (!businessId) throw new Error('Business ID is required');

    if (this._participantCheckedInColumnAvailable === false) {
      return;
    }

    const { data: participants, error: pErr } = await supabase
      .from('booking_participants')
      .select('id, checked_in_at')
      .eq('booking_id', bookingId);
    if (this._isMissingCheckedInAtColumn(pErr)) {
      this._participantCheckedInColumnAvailable = false;
      return;
    }
    if (pErr) throw pErr;
    if (!participants?.length) return;

    const { data: bookingRow, error: bErr } = await supabase
      .from('bookings')
      .select('status, requires_approval, approved_at')
      .eq('id', bookingId)
      .eq('business_id', businessId)
      .single();
    if (bErr) throw bErr;

    if (this._isBookingAwaitingStaffApproval(bookingRow)) {
      const { error: uErr } = await supabase
        .from('bookings')
        .update({
          status: 'pending',
          checked_in_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', bookingId)
        .eq('business_id', businessId);
      if (uErr) throw uErr;
      return;
    }

    const anyChecked = participants.some((p) => p.checked_in_at);
    const allChecked = participants.every((p) => p.checked_in_at);

    let nextStatus = bookingRow?.status || 'confirmed';
    let checkedAt = null;

    if (allChecked) {
      nextStatus = 'checked_in';
      checkedAt = new Date().toISOString();
    } else if (anyChecked) {
      nextStatus = 'confirmed';
      checkedAt = null;
    } else {
      checkedAt = null;
      nextStatus = bookingRow?.status === 'pending' ? 'pending' : 'confirmed';
    }

    const { error: uErr } = await supabase
      .from('bookings')
      .update({
        status: nextStatus,
        checked_in_at: checkedAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .eq('business_id', businessId);
    if (uErr) throw uErr;
  }

  async checkInParticipant(participantId, bookingId, businessIdOverride = null, audit = {}) {
    const businessId = businessIdOverride || this.businessId;
    if (!businessId) throw new Error('Business ID is required');

    if (this._participantCheckedInColumnAvailable === false) {
      throw new Error(MISSING_BOOKING_PARTICIPANT_CHECKED_IN_AT);
    }

    const booking = await this.getBookingById(bookingId);
    const participantName = participantLabelFromBooking(booking, participantId);

    const { error } = await supabase
      .from('booking_participants')
      .update({ checked_in_at: new Date().toISOString() })
      .eq('id', participantId)
      .eq('booking_id', bookingId);
    if (this._isMissingCheckedInAtColumn(error)) {
      this._participantCheckedInColumnAvailable = false;
      throw new Error(MISSING_BOOKING_PARTICIPANT_CHECKED_IN_AT);
    }
    if (error) throw error;
    this._participantCheckedInColumnAvailable = true;
    await this.syncBookingCheckInFromParticipants(bookingId, businessId);

    if (this.businessId) {
      await this._logBookingHistory({
        bookingId,
        actionType: BOOKING_HISTORY_ACTIONS.CHECK_IN,
        summary: `Checked in ${participantName}`,
        details: { participant_id: participantId, participant_name: participantName },
        audit,
      });
    }
  }

  async clearParticipantCheckIn(participantId, bookingId, businessIdOverride = null, audit = {}) {
    const businessId = businessIdOverride || this.businessId;
    if (!businessId) throw new Error('Business ID is required');

    if (this._participantCheckedInColumnAvailable === false) {
      throw new Error(MISSING_BOOKING_PARTICIPANT_CHECKED_IN_AT);
    }

    const booking = await this.getBookingById(bookingId);
    const participantName = participantLabelFromBooking(booking, participantId);

    const { error } = await supabase
      .from('booking_participants')
      .update({ checked_in_at: null })
      .eq('id', participantId)
      .eq('booking_id', bookingId);
    if (this._isMissingCheckedInAtColumn(error)) {
      this._participantCheckedInColumnAvailable = false;
      throw new Error(MISSING_BOOKING_PARTICIPANT_CHECKED_IN_AT);
    }
    if (error) throw error;
    this._participantCheckedInColumnAvailable = true;
    await this.syncBookingCheckInFromParticipants(bookingId, businessId);

    if (this.businessId) {
      await this._logBookingHistory({
        bookingId,
        actionType: BOOKING_HISTORY_ACTIONS.CHECK_IN_CLEARED,
        summary: `Check-in cleared for ${participantName}`,
        details: { participant_id: participantId, participant_name: participantName },
        audit,
      });
    }
  }

  /**
   * Attach a waiver signature to a participant and set waiver_status from validity / expiry.
   */
  async linkParticipantWaiver(participantId, bookingId, waiverSignatureId, businessIdOverride = null) {
    const businessId = businessIdOverride || this.businessId;
    if (!businessId) throw new Error('Business ID is required');

    const { data: ws, error: wErr } = await supabase
      .from('waiver_signatures')
      .select('id, is_valid, expires_at')
      .eq('id', waiverSignatureId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (wErr) throw wErr;
    if (!ws) throw new Error('Waiver not found for this business');

    let waiver_status = 'valid';
    const exp = ws.expires_at ? new Date(ws.expires_at) : null;
    if (exp && exp < new Date()) {
      waiver_status = 'expired';
    } else if (ws.is_valid === false) {
      waiver_status = 'expired';
    } else if (ws.is_valid === true || ws.is_valid == null) {
      waiver_status = 'valid';
    }

    const { error } = await supabase
      .from('booking_participants')
      .update({
        waiver_id: waiverSignatureId,
        waiver_status,
      })
      .eq('id', participantId)
      .eq('booking_id', bookingId);
    if (error) throw error;
  }

  // Check in entire booking (marks every participant when rows exist; legacy no-participant bookings too)
  async checkInBooking(bookingId, businessIdOverride = null, audit = {}) {
    const businessId = businessIdOverride || this.businessId;

    if (!businessId) {
      throw new Error('Business ID is required');
    }

    const now = new Date().toISOString();

    const { data: parts, error: partQueryError } = await supabase
      .from('booking_participants')
      .select('id')
      .eq('booking_id', bookingId);
    if (partQueryError) throw partQueryError;

    if (parts?.length) {
      if (this._participantCheckedInColumnAvailable === false) {
        throw new Error(MISSING_BOOKING_PARTICIPANT_CHECKED_IN_AT);
      }
      const { error: partUpdateError } = await supabase
        .from('booking_participants')
        .update({ checked_in_at: now })
        .eq('booking_id', bookingId);
      if (this._isMissingCheckedInAtColumn(partUpdateError)) {
        this._participantCheckedInColumnAvailable = false;
        throw new Error(MISSING_BOOKING_PARTICIPANT_CHECKED_IN_AT);
      }
      if (partUpdateError) throw partUpdateError;
      this._participantCheckedInColumnAvailable = true;
      await this.syncBookingCheckInFromParticipants(bookingId, businessId);
    } else {
      const { data: bookingRow, error: bookingReadError } = await supabase
        .from('bookings')
        .select('status, requires_approval, approved_at')
        .eq('id', bookingId)
        .eq('business_id', businessId)
        .single();
      if (bookingReadError) throw bookingReadError;

      if (this._isBookingAwaitingStaffApproval(bookingRow)) {
        throw new Error('This booking must be approved before it can be checked in.');
      }

      const { data, error } = await supabase
        .from('bookings')
        .update({
          status: 'checked_in',
          checked_in_at: now,
          updated_at: now,
        })
        .eq('id', bookingId)
        .eq('business_id', businessId)
        .select()
        .single();

      if (error) {
        console.error('Error checking in booking:', error);
        throw error;
      }

      if (this.businessId) {
        await this._logBookingHistory({
          bookingId,
          actionType: BOOKING_HISTORY_ACTIONS.CHECK_IN,
          summary: 'Booking checked in',
          details: { changes: [{ field: 'Status', from: bookingRow?.status, to: 'checked_in' }] },
          audit,
        });
      }

      return data;
    }

    const participantCount = parts?.length || 0;
    if (this.businessId) {
      await this._logBookingHistory({
        bookingId,
        actionType: BOOKING_HISTORY_ACTIONS.CHECK_IN,
        summary: participantCount > 1
          ? `All ${participantCount} participants checked in`
          : 'Participant checked in',
        details: { participant_count: participantCount },
        audit,
      });
    }

    const { data: bookingOut, error: fetchError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .eq('business_id', businessId)
      .single();
    if (fetchError) throw fetchError;
    return bookingOut;
  }

  // Clear booking check-in (all participants + booking row)
  async clearCheckInBooking(bookingId, businessIdOverride = null) {
    const businessId = businessIdOverride || this.businessId;

    if (!businessId) {
      throw new Error('Business ID is required');
    }

    const { data: bookingRow, error: readErr } = await supabase
      .from('bookings')
      .select('status')
      .eq('id', bookingId)
      .eq('business_id', businessId)
      .single();
    if (readErr) throw readErr;

    const { count: participantCount, error: cntErr } = await supabase
      .from('booking_participants')
      .select('*', { count: 'exact', head: true })
      .eq('booking_id', bookingId);
    if (cntErr) throw cntErr;

    if (participantCount > 0) {
      if (this._participantCheckedInColumnAvailable === false) {
        throw new Error(MISSING_BOOKING_PARTICIPANT_CHECKED_IN_AT);
      }
      const { error: clearPartErr } = await supabase
        .from('booking_participants')
        .update({ checked_in_at: null })
        .eq('booking_id', bookingId);
      if (this._isMissingCheckedInAtColumn(clearPartErr)) {
        this._participantCheckedInColumnAvailable = false;
        throw new Error(MISSING_BOOKING_PARTICIPANT_CHECKED_IN_AT);
      }
      if (clearPartErr) throw clearPartErr;
      this._participantCheckedInColumnAvailable = true;
    }

    const nextStatus = bookingRow?.status === 'pending' ? 'pending' : 'confirmed';

    const { data, error } = await supabase
      .from('bookings')
      .update({
        status: nextStatus,
        checked_in_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .eq('business_id', businessId)
      .select()
      .single();

    if (error) {
      console.error('Error clearing booking check-in:', error);
      throw error;
    }

    return data;
  }

  // Get bookings by date range
  async getBookingsByDateRange(startDate, endDate) {
    return this.getBookings({
      startDate,
      endDate
    });
  }

  // Get upcoming bookings
  async getUpcomingBookings(limit = 10) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const today = new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabase
      .from('bookings')
      .select(`
        *,
        booking_activities:activity_id (activity_name),
        booking_types:booking_type_id (display_name)
      `)
      .eq('business_id', this.businessId)
      .gte('booking_date', today)
      .in('status', ['pending', 'confirmed', 'checked_in'])
      .order('booking_date', { ascending: true })
      .order('booking_time', { ascending: true })
      .limit(limit);

    if (error) {
      console.error('Error fetching upcoming bookings:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Load package steps + acknowledgments + signature for staff T&Cs review tab.
   */
  async getBookingTermsReview(bookingId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }
    if (!bookingId) {
      throw new Error('Booking ID is required');
    }

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select(`
        id,
        booking_number,
        terms_package_id,
        terms_status,
        terms_signed_at,
        terms_signer_name,
        terms_signature_data,
        terms_signed_ip,
        activity_id,
        booking_activities:activity_id (activity_name)
      `)
      .eq('id', bookingId)
      .eq('business_id', this.businessId)
      .maybeSingle();

    if (bookingError) throw bookingError;
    if (!booking) throw new Error('Booking not found');
    if (!booking.terms_package_id) {
      return {
        booking,
        package: null,
        steps: [],
        acknowledgments: [],
        businessName: null,
        isSigned: false,
      };
    }

    const [
      { data: pkg, error: pkgError },
      { data: steps, error: stepsError },
      { data: acknowledgments, error: ackError },
      { data: business },
    ] = await Promise.all([
      supabase
        .from('booking_terms_packages')
        .select('id, name, description, is_active')
        .eq('id', booking.terms_package_id)
        .eq('business_id', this.businessId)
        .maybeSingle(),
      supabase
        .from('booking_terms_steps')
        .select('id, step_order, title, body, require_acknowledge')
        .eq('package_id', booking.terms_package_id)
        .eq('business_id', this.businessId)
        .order('step_order', { ascending: true }),
      supabase
        .from('booking_terms_acknowledgments')
        .select('id, step_id, step_order, step_title_snapshot, step_body_snapshot, acknowledged_at')
        .eq('booking_id', bookingId)
        .eq('business_id', this.businessId)
        .order('step_order', { ascending: true }),
      supabase
        .from('businesses')
        .select('name')
        .eq('id', this.businessId)
        .maybeSingle(),
    ]);

    if (pkgError) throw pkgError;
    if (stepsError) throw stepsError;
    if (ackError) throw ackError;

    return {
      booking,
      package: pkg || null,
      steps: steps || [],
      acknowledgments: acknowledgments || [],
      businessName: business?.name || null,
      isSigned: booking.terms_status === 'signed',
    };
  }
}

export default new BookingService();












