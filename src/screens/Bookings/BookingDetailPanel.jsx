import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import bookingService from '../../services/Bookings/BookingService';
import bookingPaymentService from '../../services/Bookings/BookingPaymentService';
import bookingSettingsService from '../../services/Bookings/BookingSettingsService';
import bookingActivityService from '../../services/Bookings/BookingActivityService';
import { supabase } from '../../supabaseClient';
import BookingCheckInButton from '../../components/Bookings/BookingCheckInButton';
import BookingActivityDatePicker from '../../components/Bookings/BookingActivityDatePicker';
import BookingNotesTab from '../../components/Bookings/BookingNotesTab';
import PartyGuestListTab from '../../components/Bookings/PartyGuestListTab';
import BookingActivityTabPanel from '../../components/Bookings/BookingActivityTabPanel';
import BookingPaymentTab from '../../components/Bookings/BookingPaymentTab';
import BookingHistoryTab from '../../components/Bookings/BookingHistoryTab';
import BookingOptionsTab from '../../components/Bookings/BookingOptionsTab';
import BookingTermsTab from '../../components/Bookings/BookingTermsTab';
import BookingPrintModal from '../../components/Bookings/BookingPrintModal';
import BookingApprovalActionModal from '../../components/Bookings/BookingApprovalActionModal';
import BookingCancelActionModal from '../../components/Bookings/BookingCancelActionModal';
import BookingExtendTimeModal from '../../components/Bookings/BookingExtendTimeModal';
import BookingPricingBreakdownModal from '../../components/Bookings/BookingPricingBreakdownModal';
import BookingResourceAssignmentModal from '../../components/Bookings/BookingResourceAssignmentModal';
import partyGuestListService from '../../services/Bookings/PartyGuestListService';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';
import { FiArrowLeft, FiX, FiSave, FiCreditCard, FiClock, FiChevronDown, FiChevronRight, FiPrinter, FiCopy, FiRefreshCw, FiMail, FiList } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { formatDateShort, formatDateTimeForBusiness, getBusinessTimezone } from '../../utils/businessDateFormat';
import { formatPhoneDisplay } from '../../utils/phoneFormat';
import { getViewableWaiverSignatureId, assertUniqueBookingParticipantIdentities } from '../../helpers/Bookings/participantIdentity';
import {
  normalizeActivityTab,
  tabVisibleToAudience,
} from '../../helpers/Bookings/bookingActivityTabs';
import {
  buildParticipantsTabRows,
  getInitialSelectedParticipantKeys,
  isParticipantSelectionLocked,
  loadWaiverRosterForCustomer,
  participantSelectionKeysEqual,
  partyRoleLabel,
  tabRowToBookingParticipantPayload,
} from '../../helpers/Bookings/bookingWaiverRoster';
import {
  buildBookingPrintHtml,
  buildBookingPrintOptionsCatalog,
  getBirthdayChildName,
  getPartyHostName,
  openBookingPrintWindow,
} from '../../helpers/Bookings/bookingPrint';
import { collectPortalOptionInventoryItemIds } from '../../utils/bookingActivityOptions';
import { fetchBundleDataForInventoryIds } from '../../utils/posInventoryBundles';
import { formatBookingResourceAssignments, getBookingEndTime, formatBookingTimeRangeLabel, getBookingDurationMinutes, flattenScheduleResourceAssignments } from '../../utils/bookingTimeRange';
import {
  buildResourceSelectOptions,
  buildResourcePaddingLookup,
  buildResourceQuantityLookup,
  formatResourcePaddingSummary,
  getOccupiedResourceIds,
  getResourceConflictCounts,
  resolveResourcePadding,
  validateCombinedResourceAssignments,
  areRequiredResourcesAvailableForSlot,
  getRequiredResourceIdsFromSchedule,
} from '../../helpers/Bookings/bookingResourceAvailability';
import { formatBookingMoney, getEffectiveBookingPricingSummary } from '../../utils/bookingPricing';
import { parseExtensionPricingSettings } from '../../utils/bookingExtensionPricing';
import {
  bookingBlocksPaymentRequestUntilApproved,
  calculateOnlineCheckoutAmounts,
  canRevokeBookingApproval,
  parseOnlinePaymentSettings,
  revokeBookingApprovalBlockedReason,
} from '../../utils/bookingPaymentSettings';
import {
  buildScheduleTimeOptionsWithCapacity,
  countBookingsPerSlotTime,
  activityCountsParticipantsByType,
  dedupeSchedulesByStartTime,
  fetchActivitySchedules,
  findMatchingScheduleSlots,
  mergeScheduleResourceAssignments,
  normalizeBookingScheduleTime,
  pickSchedulesForActivityOnDate,
  resolveFlatResourceAssignmentsFromSchedule,
  isBookingDateInPast,
  validateScheduleSlotSelection,
} from '../../helpers/Bookings/bookingActivityScheduleHelpers';
import {
  checkBookingBusinessHours,
  approveBusinessHoursOverride,
} from '../../helpers/Bookings/businessHoursOverrideFlow';
import BookingBusinessHoursOverrideModal from '../../components/Bookings/BookingBusinessHoursOverrideModal';
import {
  buildBookingCreatedBySummary,
  buildBookingLastChangedSummary,
  formatProvenanceDetailLine,
  getBookingBookerDisplayName,
} from '../../helpers/Bookings/bookingProvenance';
import { BOOKING_HISTORY_ACTIONS } from '../../helpers/Bookings/bookingHistory';
import SecurityUtils from '../../Security/SecurityUtils';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const DETAIL_TABS = [
  { id: 'booking', label: 'Booking' },
  { id: 'participants', label: 'Participants' },
  { id: 'options', label: 'Options' },
  { id: 'payment', label: 'Payment' },
  { id: 'notes', label: 'Notes' },
  { id: 'guest-list', label: 'Guest list' },
  { id: 'history', label: 'History' },
  { id: 'details', label: 'Details' },
  { id: 'terms', label: 'T&Cs' },
];

const activityTabNavId = (tab) => `activity-tab:${tab.id || tab.tab_key}`;

const cardStyle = {
  backgroundColor: 'white',
  padding: '24px',
  borderRadius: '12px',
  border: '1px solid #e5e7eb',
  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
  marginBottom: '20px',
};

const fieldLabelStyle = {
  fontSize: '13px',
  color: TavariStyles.colors.gray600,
  marginBottom: '6px',
  fontWeight: '600',
};

const fieldInputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  fontSize: '14px',
  boxSizing: 'border-box',
  backgroundColor: 'white',
  color: TavariStyles.colors.gray900,
};

const sidebarButtonStyle = (variant = 'default', disabled = false) => ({
  width: '100%',
  padding: '10px 14px',
  marginBottom: '8px',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  boxSizing: 'border-box',
  opacity: disabled ? 0.65 : 1,
  ...(variant === 'primary'
    ? {
        backgroundColor: TavariStyles.colors.primary,
        color: '#fff',
        border: 'none',
      }
    : variant === 'danger'
      ? {
          backgroundColor: '#fff',
          color: '#ef4444',
          border: '1px solid #fecaca',
        }
      : variant === 'success'
        ? {
            backgroundColor: '#ecfdf5',
            color: TavariStyles.colors.primary,
            border: `1px solid ${TavariStyles.colors.primary}`,
          }
        : {
          backgroundColor: '#fff',
          color: '#374151',
          border: '1px solid #d1d5db',
        }),
});

const BookingDetailPanel = ({
  bookingId,
  initialTab = null,
  variant = 'page',
  onClose,
  onBookingUpdated,
}) => {
  const navigate = useNavigate();
  const isModal = variant === 'modal';

  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: isModal ? 'BookingDetailModal' : 'BookingDetailScreen',
  });

  const { hasPermission, hasElevatedPrivileges, hasAnyPermission } = usePermissions();
  const canEditBookings = hasPermission('bookings.edit') || hasElevatedPrivileges();
  const canViewBookings = hasAnyPermission(['bookings.view', 'bookings.view_all']) || hasElevatedPrivileges();
  const canCheckIn = hasPermission('bookings.checkin') || hasElevatedPrivileges();
  const businessTimezone = getBusinessTimezone(auth.businessData);

  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(null);
  const [resources, setResources] = useState([]);
  const [activities, setActivities] = useState([]);
  const [activitySchedules, setActivitySchedules] = useState([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab || 'booking');
  const [activityAdditionalTabs, setActivityAdditionalTabs] = useState([]);

  useEffect(() => {
    setActiveTab(initialTab || 'booking');
  }, [bookingId, initialTab]);
  const [editForm, setEditForm] = useState({
    activityId: '',
    bookingDate: '',
    bookingTime: '',
  });
  const [savingRoom, setSavingRoom] = useState(false);
  const [showResourceAssignmentModal, setShowResourceAssignmentModal] = useState(false);
  const [waiverRoster, setWaiverRoster] = useState([]);
  const [waiverRosterLoading, setWaiverRosterLoading] = useState(false);
  const [selectedParticipantKeys, setSelectedParticipantKeys] = useState([]);
  const [savingParticipants, setSavingParticipants] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printDataLoading, setPrintDataLoading] = useState(false);
  const [printGuestListEntries, setPrintGuestListEntries] = useState([]);
  const [printGuestList, setPrintGuestList] = useState(null);
  const [printBookingNotes, setPrintBookingNotes] = useState([]);
  const [printInventoryItems, setPrintInventoryItems] = useState([]);
  const [printBundleContext, setPrintBundleContext] = useState({});
  const [extending, setExtending] = useState(false);
  const [showExtendTimeModal, setShowExtendTimeModal] = useState(false);
  const [showPricingBreakdownModal, setShowPricingBreakdownModal] = useState(false);
  const [approving, setApproving] = useState(false);
  const [resendingTermsEmail, setResendingTermsEmail] = useState(false);
  const [revokingApproval, setRevokingApproval] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [showApproveConfirmModal, setShowApproveConfirmModal] = useState(false);
  const [showRevokeApprovalModal, setShowRevokeApprovalModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [slotBookedCountsByTime, setSlotBookedCountsByTime] = useState({});
  const [slotBookingsLoading, setSlotBookingsLoading] = useState(false);
  const [dayBookingsWithResources, setDayBookingsWithResources] = useState([]);
  const [dayResourceBookingsLoading, setDayResourceBookingsLoading] = useState(false);
  const [provenanceUserNames, setProvenanceUserNames] = useState({});
  const [expandedParticipantId, setExpandedParticipantId] = useState(null);
  const [secondaryNotificationEmail, setSecondaryNotificationEmail] = useState('');
  const [savingSecondaryNotificationEmail, setSavingSecondaryNotificationEmail] = useState(false);
  const [sendingPartyInfoEmail, setSendingPartyInfoEmail] = useState(false);
  const [optionsPricingPreview, setOptionsPricingPreview] = useState(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [hoursOverrideModal, setHoursOverrideModal] = useState({ open: false, reason: '' });
  const [isCompactLayout, setIsCompactLayout] = useState(
    typeof window !== 'undefined'
      ? window.innerWidth <= 900 || window.innerHeight <= 720
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleResize = () => {
      setIsCompactLayout(window.innerWidth <= 900 || window.innerHeight <= 720);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    setSecondaryNotificationEmail(String(booking?.secondary_customer_email || '').trim());
  }, [booking?.id, booking?.secondary_customer_email]);

  const bookingPricing = useMemo(
    () => (booking ? getEffectiveBookingPricingSummary(booking, optionsPricingPreview) : null),
    [booking, optionsPricingPreview],
  );

  const extensionPricingSettings = useMemo(
    () => parseExtensionPricingSettings(booking?.booking_activities?.ticket_settings),
    [booking?.booking_activities?.ticket_settings],
  );

  const requiredDepositAmount = useMemo(() => {
    if (!booking) return 0;
    const pricing = bookingPricing || getEffectiveBookingPricingSummary(booking);
    const orderTotal = Number(pricing?.totalPrice) || Number(booking?.order_total) || 0;
    const settings = parseOnlinePaymentSettings(booking?.booking_activities?.ticket_settings);
    return calculateOnlineCheckoutAmounts(orderTotal, settings).chargeNow;
  }, [booking, bookingPricing]);

  useEffect(() => {
    setOptionsPricingPreview(null);
  }, [booking?.id, booking?.order_total, booking?.tax_amount, booking?.booking_addon_items, booking?.booking_time_extensions]);

  const getBookingAuditContext = useCallback(async () => {
    let updatedIp = null;
    try {
      updatedIp = await SecurityUtils.getClientIP();
    } catch {
      updatedIp = null;
    }
    return {
      updatedBy: auth.authUser?.id || null,
      updatedIp: updatedIp || null,
    };
  }, [auth.authUser?.id]);

  const notifyUpdated = useCallback(() => {
    setHistoryRefreshKey((key) => key + 1);
    onBookingUpdated?.();
  }, [onBookingUpdated]);

  const loadBooking = useCallback(async ({ silent = false } = {}) => {
    if (!bookingId) return null;
    try {
      if (!silent) setLoading(true);
      const data = await bookingService.getBookingByIdWithMailNames(bookingId);
      setBooking(data);
      return data;
    } catch (error) {
      console.error('Error loading booking:', error);
      if (!silent) {
        toast.error('Error loading booking');
        setBooking(null);
      }
    } finally {
      if (!silent) setLoading(false);
    }
    return null;
  }, [bookingId]);

  useEffect(() => {
    const activityId = booking?.activity_id;
    if (!activityId || !auth.selectedBusinessId) {
      setActivityAdditionalTabs([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('booking_activity_tabs')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .eq('activity_id', activityId)
        .eq('is_active', true)
        .order('display_order', { ascending: true });
      if (cancelled) return;
      if (error) {
        console.warn('[BookingDetailPanel] activity tabs load failed:', error.message);
        setActivityAdditionalTabs([]);
        return;
      }
      setActivityAdditionalTabs(
        (data || []).map((row) => normalizeActivityTab(row)).filter(Boolean),
      );
    })();
    return () => { cancelled = true; };
  }, [booking?.activity_id, auth.selectedBusinessId]);

  const refreshBookingSilently = useCallback(async () => {
    return loadBooking({ silent: true });
  }, [loadBooking]);

  const loadResources = useCallback(async () => {
    try {
      const rows = await bookingSettingsService.getBookingResources();
      setResources(rows || []);
    } catch (error) {
      console.error('Error loading booking resources:', error);
      setResources([]);
    }
  }, []);

  useEffect(() => {
    setActiveTab('booking');
    setExpandedParticipantId(null);
  }, [bookingId]);

  useEffect(() => {
    if (auth.selectedBusinessId && bookingId) {
      bookingService.setBusinessId(auth.selectedBusinessId);
      bookingPaymentService.setBusinessId(auth.selectedBusinessId);
      bookingSettingsService.setBusinessId(auth.selectedBusinessId);
      bookingActivityService.setBusinessId(auth.selectedBusinessId);
      loadBooking();
      loadResources();
    }
  }, [auth.selectedBusinessId, bookingId, loadBooking, loadResources]);

  useEffect(() => {
    if (!booking?.id) {
      setWaiverRoster([]);
      return undefined;
    }

    const customerId = booking.customer_id;
    const hasCustomerLookup = customerId || booking.customer_email || booking.customer_phone;
    if (!auth.selectedBusinessId || !hasCustomerLookup) {
      setWaiverRoster([]);
      return undefined;
    }

    let cancelled = false;
    setWaiverRosterLoading(true);

    (async () => {
      try {
        const roster = await loadWaiverRosterForCustomer(supabase, auth.selectedBusinessId, {
          id: customerId,
          customerId,
          customer_email: booking.customer_email,
          customer_phone: booking.customer_phone,
        });
        if (!cancelled) setWaiverRoster(roster);
      } catch (error) {
        console.warn('[BookingDetailPanel] waiver roster load:', error);
        if (!cancelled) setWaiverRoster([]);
      } finally {
        if (!cancelled) setWaiverRosterLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    booking?.id,
    booking?.customer_id,
    booking?.customer_email,
    booking?.customer_phone,
    auth.selectedBusinessId,
  ]);

  const participantsTabRows = useMemo(
    () => buildParticipantsTabRows(booking?.booking_participants || [], waiverRoster),
    [booking?.booking_participants, waiverRoster],
  );

  const savedParticipantKeys = useMemo(
    () => getInitialSelectedParticipantKeys(participantsTabRows),
    [participantsTabRows],
  );

  const participantSelectionDirty = useMemo(
    () => !participantSelectionKeysEqual(selectedParticipantKeys, savedParticipantKeys),
    [selectedParticipantKeys, savedParticipantKeys],
  );

  useEffect(() => {
    setSelectedParticipantKeys(getInitialSelectedParticipantKeys(participantsTabRows));
  }, [booking?.id, savedParticipantKeys]);

  useEffect(() => {
    const lockedKeys = participantsTabRows
      .filter((row) => isParticipantSelectionLocked(row))
      .map((row) => row.selectionKey);
    if (!lockedKeys.length) return undefined;

    setSelectedParticipantKeys((current) => {
      const merged = new Set([...current, ...lockedKeys]);
      const next = [...merged];
      return participantSelectionKeysEqual(next, current) ? current : next;
    });
    return undefined;
  }, [participantsTabRows]);

  useEffect(() => {
    if (!auth.selectedBusinessId) return;
    bookingActivityService.setBusinessId(auth.selectedBusinessId);
    (async () => {
      try {
        const rows = await bookingActivityService.getActivities({ activeOnly: false });
        setActivities(rows || []);
      } catch (error) {
        console.error('Error loading activities:', error);
        setActivities([]);
      }
    })();
  }, [auth.selectedBusinessId]);

  useEffect(() => {
    if (!booking) return;
    setEditForm({
      activityId: booking.activity_id || '',
      bookingDate: booking.booking_date || '',
      bookingTime: normalizeBookingScheduleTime(booking.booking_time) || '',
    });
  }, [booking?.id, booking?.activity_id, booking?.booking_date, booking?.booking_time]);

  useEffect(() => {
    if (!booking) {
      setProvenanceUserNames({});
      return undefined;
    }

    const userIds = [booking.created_by, booking.updated_by].filter(Boolean);
    if (!userIds.length) {
      setProvenanceUserNames({});
      return undefined;
    }

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', [...new Set(userIds)]);

      if (cancelled) return;
      if (error) {
        console.warn('[BookingDetailPanel] provenance user lookup:', error.message);
        setProvenanceUserNames({});
        return;
      }

      const map = {};
      for (const user of data || []) {
        const fromName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
        map[user.id] = fromName || (user.email && String(user.email).trim()) || user.id;
      }
      setProvenanceUserNames(map);
    })();

    return () => {
      cancelled = true;
    };
  }, [booking?.id, booking?.created_by, booking?.updated_by]);

  useEffect(() => {
    if (!auth.selectedBusinessId || !editForm.activityId) {
      setActivitySchedules([]);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      setSchedulesLoading(true);
      try {
        const rows = await fetchActivitySchedules(
          supabase,
          auth.selectedBusinessId,
          editForm.activityId,
        );
        if (!cancelled) setActivitySchedules(rows);
      } catch (error) {
        console.error('Error loading activity schedules:', error);
        if (!cancelled) setActivitySchedules([]);
      } finally {
        if (!cancelled) setSchedulesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auth.selectedBusinessId, editForm.activityId]);

  useEffect(() => {
    if (!auth.selectedBusinessId || !editForm.activityId || !editForm.bookingDate) {
      setSlotBookedCountsByTime({});
      return undefined;
    }

    let cancelled = false;
    (async () => {
      setSlotBookingsLoading(true);
      try {
        const [{ data, error }, { data: activityMeta }] = await Promise.all([
          supabase
            .from('bookings')
            .select('id, booking_time, status, multi_day_role, parent_booking_id, booking_participants ( id )')
            .eq('business_id', auth.selectedBusinessId)
            .eq('activity_id', editForm.activityId)
            .eq('booking_date', editForm.bookingDate)
            .in('status', ['pending', 'confirmed', 'checked_in']),
          supabase
            .from('booking_activities')
            .select('booking_types:type_id ( type_key )')
            .eq('id', editForm.activityId)
            .maybeSingle(),
        ]);

        if (error) throw error;
        if (cancelled) return;

        const typeKey = activityMeta?.booking_types?.type_key || '';
        const countByParticipants = activityCountsParticipantsByType(typeKey);
        const parentBookingsById = new Map(
          (data || [])
            .filter((row) => row?.multi_day_role === 'parent')
            .map((row) => [row.id, row]),
        );

        setSlotBookedCountsByTime(
          countBookingsPerSlotTime(data || [], {
            excludeBookingId: booking?.id || null,
            countByParticipants,
            typeKey,
            parentBookingsById,
          }),
        );
      } catch (error) {
        console.error('Error loading slot booking counts:', error);
        if (!cancelled) setSlotBookedCountsByTime({});
      } finally {
        if (!cancelled) setSlotBookingsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    auth.selectedBusinessId,
    editForm.activityId,
    editForm.bookingDate,
    booking?.id,
  ]);

  const resourceBookingDate = editForm.bookingDate || booking?.booking_date || '';

  useEffect(() => {
    if (!auth.selectedBusinessId || !resourceBookingDate) {
      setDayBookingsWithResources([]);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      setDayResourceBookingsLoading(true);
      try {
        const { data, error } = await supabase
          .from('bookings')
          .select(`
            id,
            booking_number,
            booking_date,
            booking_time,
            booking_end_time,
            duration_minutes,
            extended_minutes,
            status,
            booking_resource_assignments (
              category_id,
              resource_id
            ),
            booking_activities:activity_id (
              duration_minutes
            )
          `)
          .eq('business_id', auth.selectedBusinessId)
          .eq('booking_date', resourceBookingDate)
          .in('status', ['pending', 'confirmed', 'checked_in']);

        if (error) throw error;
        if (!cancelled) setDayBookingsWithResources(data || []);
      } catch (error) {
        console.error('Error loading day bookings for resource availability:', error);
        if (!cancelled) setDayBookingsWithResources([]);
      } finally {
        if (!cancelled) setDayResourceBookingsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auth.selectedBusinessId, resourceBookingDate, booking?.id, booking?.booking_date]);

  useEffect(() => {
    if (schedulesLoading || !editForm.activityId || activitySchedules.length === 0) return;

    const isCurrentValid = editForm.bookingDate && pickSchedulesForActivityOnDate(
      activitySchedules,
      dayjs.tz(editForm.bookingDate, businessTimezone).toDate(),
      businessTimezone,
    ).length > 0;

    const isSavedSnapshot = editForm.activityId === booking?.activity_id
      && editForm.bookingDate === booking?.booking_date
      && !isBookingDateInPast(editForm.bookingDate, businessTimezone);
    if (isCurrentValid || isSavedSnapshot) return;

    const today = dayjs().tz(businessTimezone).startOf('day');
    for (let offset = 0; offset < 365; offset += 1) {
      const candidate = today.add(offset, 'day');
      if (pickSchedulesForActivityOnDate(activitySchedules, candidate.toDate(), businessTimezone).length > 0) {
        const nextDate = candidate.format('YYYY-MM-DD');
        if (nextDate !== editForm.bookingDate) {
          setEditForm((current) => ({ ...current, bookingDate: nextDate, bookingTime: '' }));
        }
        return;
      }
    }
  }, [
    activitySchedules,
    schedulesLoading,
    editForm.activityId,
    editForm.bookingDate,
    booking?.booking_date,
    businessTimezone,
  ]);

  const activityOptions = useMemo(() => {
    const list = [...(activities || [])];
    if (booking?.activity_id && !list.some((activity) => activity.id === booking.activity_id)) {
      list.unshift({
        id: booking.activity_id,
        activity_name: booking.booking_activities?.activity_name || 'Current activity',
        is_active: false,
      });
    }
    return list.sort((a, b) => String(a.activity_name || '').localeCompare(String(b.activity_name || '')));
  }, [activities, booking?.activity_id, booking?.booking_activities?.activity_name]);

  const primaryResourceCategory = useMemo(
    () => resources.find((cat) => Array.isArray(cat.resources) && cat.resources.length > 0),
    [resources],
  );

  const resourcePaddingById = useMemo(
    () => buildResourcePaddingLookup(resources),
    [resources],
  );

  const resourceQuantityById = useMemo(
    () => buildResourceQuantityLookup(resources),
    [resources],
  );

  const isScheduleDirty = useMemo(() => {
    if (!booking) return false;
    return (
      editForm.activityId !== (booking.activity_id || '')
      || editForm.bookingDate !== (booking.booking_date || '')
      || normalizeBookingScheduleTime(editForm.bookingTime)
        !== normalizeBookingScheduleTime(booking.booking_time)
    );
  }, [booking, editForm]);

  const visibleDetailTabs = useMemo(() => {
    const participants = booking?.booking_participants || [];
    const showGuestList = participants.some(
      (row) => row.party_role === 'host_adult' || row.party_role === 'birthday_child',
    );
    const showTerms = Boolean(booking?.terms_package_id);
    const base = DETAIL_TABS.filter((tab) => {
      if (tab.id === 'guest-list') return showGuestList;
      if (tab.id === 'terms') return showTerms;
      return true;
    });
    const extra = (activityAdditionalTabs || [])
      .filter((tab) => tabVisibleToAudience(tab, 'staff'))
      .map((tab) => ({
        id: activityTabNavId(tab),
        label: tab.label,
        activityTab: tab,
      }));
    // Insert additional tabs before History for a natural grouping
    const historyIndex = base.findIndex((tab) => tab.id === 'history');
    if (historyIndex < 0) return [...base, ...extra];
    return [
      ...base.slice(0, historyIndex),
      ...extra,
      ...base.slice(historyIndex),
    ];
  }, [booking?.booking_participants, booking?.terms_package_id, activityAdditionalTabs]);

  useEffect(() => {
    if (!visibleDetailTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab('booking');
    }
  }, [activeTab, visibleDetailTabs]);

  const targetBookingForResourceCheck = useMemo(() => {
    if (!booking) return null;

    const selectedActivity = activityOptions.find((activity) => activity.id === editForm.activityId);
    const normalizedTime = isScheduleDirty && !editForm.bookingTime
      ? null
      : normalizeBookingScheduleTime(editForm.bookingTime || booking.booking_time);

    if (!isScheduleDirty) {
      return {
        ...booking,
        booking_time: normalizedTime,
        booking_activities: booking.booking_activities || {
          duration_minutes: selectedActivity?.duration_minutes,
        },
      };
    }

    return {
      id: booking.id,
      booking_time: normalizedTime,
      duration_minutes:
        selectedActivity?.duration_minutes
        ?? booking.duration_minutes
        ?? booking.booking_activities?.duration_minutes,
      extended_minutes: 0,
      booking_end_time: null,
      booking_activities: {
        duration_minutes:
          selectedActivity?.duration_minutes
          ?? booking.booking_activities?.duration_minutes,
      },
    };
  }, [booking, editForm.activityId, editForm.bookingTime, editForm.bookingDate, activityOptions, isScheduleDirty]);

  const scheduleTimeOptions = useMemo(() => {
    const selectedActivity = activityOptions.find((activity) => activity.id === editForm.activityId);
    const durationMinutes =
      selectedActivity?.duration_minutes
      ?? booking?.duration_minutes
      ?? booking?.booking_activities?.duration_minutes
      ?? 60;

    return buildScheduleTimeOptionsWithCapacity(
      activitySchedules,
      editForm.bookingDate,
      businessTimezone,
      {
        currentTimeValue: editForm.bookingTime,
        bookedCountsByTime: slotBookedCountsByTime,
        resourceSlotContext: primaryResourceCategory?.categoryId && editForm.bookingDate
          ? {
            categoryId: primaryResourceCategory.categoryId,
            bookingDate: editForm.bookingDate,
            durationMinutes,
            dayBookings: dayBookingsWithResources,
            excludeBookingId: booking?.id || null,
            resourcePaddingById,
            resourceQuantityById,
          }
          : null,
      },
    );
  }, [
    activitySchedules,
    editForm.bookingDate,
    editForm.bookingTime,
    editForm.activityId,
    businessTimezone,
    slotBookedCountsByTime,
    activityOptions,
    booking?.id,
    booking?.duration_minutes,
    booking?.booking_activities?.duration_minutes,
    primaryResourceCategory?.categoryId,
    dayBookingsWithResources,
    resourcePaddingById,
    resourceQuantityById,
  ]);

  const selectedScheduleOption = useMemo(
    () => scheduleTimeOptions.find(
      (option) => option.value === normalizeBookingScheduleTime(editForm.bookingTime),
    ),
    [scheduleTimeOptions, editForm.bookingTime],
  );

  const resourceConflictCounts = useMemo(
    () => getResourceConflictCounts({
      bookings: dayBookingsWithResources,
      targetBooking: targetBookingForResourceCheck,
      categoryId: primaryResourceCategory?.categoryId,
      excludeBookingId: booking?.id || null,
      resourcePaddingById,
    }),
    [
      dayBookingsWithResources,
      targetBookingForResourceCheck,
      primaryResourceCategory?.categoryId,
      booking?.id,
      resourcePaddingById,
    ],
  );

  const occupiedResourceIds = useMemo(
    () => getOccupiedResourceIds({
      bookings: dayBookingsWithResources,
      targetBooking: targetBookingForResourceCheck,
      categoryId: primaryResourceCategory?.categoryId,
      excludeBookingId: booking?.id || null,
      resourcePaddingById,
      resourceQuantityById,
    }),
    [
      dayBookingsWithResources,
      targetBookingForResourceCheck,
      primaryResourceCategory?.categoryId,
      booking?.id,
      resourcePaddingById,
      resourceQuantityById,
    ],
  );

  const allResourceAssignments = useMemo(() => {
    if (isScheduleDirty) {
      if (!editForm.bookingDate || !editForm.bookingTime) {
        return [];
      }

      const flat = resolveFlatResourceAssignmentsFromSchedule(
        activitySchedules,
        editForm.bookingDate,
        normalizeBookingScheduleTime(editForm.bookingTime),
        businessTimezone,
      );

      return formatBookingResourceAssignments(
        flat.map((row) => ({
          category_id: row.categoryId,
          resource_id: row.resourceId,
        })),
        resources,
      );
    }

    return formatBookingResourceAssignments(
      booking?.booking_resource_assignments || [],
      resources,
    );
  }, [
    isScheduleDirty,
    editForm.bookingDate,
    editForm.bookingTime,
    activitySchedules,
    businessTimezone,
    booking?.booking_resource_assignments,
    resources,
  ]);

  const currentResourceAssignment = useMemo(
    () => allResourceAssignments[0] || null,
    [allResourceAssignments],
  );

  const isCombinedResourceBooking = allResourceAssignments.length > 1;

  const scheduledResourceIds = useMemo(() => {
    if (!editForm.bookingDate || !editForm.bookingTime || !primaryResourceCategory?.categoryId) {
      return [];
    }
    const matches = dedupeSchedulesByStartTime(
      findMatchingScheduleSlots(
        activitySchedules,
        editForm.bookingDate,
        editForm.bookingTime,
        businessTimezone,
      ),
    );
    const merged = mergeScheduleResourceAssignments(matches);
    return flattenScheduleResourceAssignments(merged)
      .filter((row) => row.categoryId === primaryResourceCategory.categoryId)
      .map((row) => row.resourceId)
      .filter(Boolean);
  }, [
    activitySchedules,
    editForm.bookingDate,
    editForm.bookingTime,
    primaryResourceCategory?.categoryId,
    businessTimezone,
  ]);

  const requiredResourceIds = useMemo(() => {
    if (scheduledResourceIds.length > 0) return scheduledResourceIds;
    return allResourceAssignments.map((assignment) => assignment.resource_id).filter(Boolean);
  }, [scheduledResourceIds, allResourceAssignments]);

  const currentResourcePaddingSummary = useMemo(() => {
    if (!currentResourceAssignment?.resource_id || !primaryResourceCategory) return '';
    const resource = primaryResourceCategory.resources?.find(
      (item) => item.id === currentResourceAssignment.resource_id,
    );
    return formatResourcePaddingSummary(resolveResourcePadding(resource, primaryResourceCategory));
  }, [currentResourceAssignment?.resource_id, primaryResourceCategory]);

  const currentAssignedResourceIds = useMemo(
    () => allResourceAssignments.map((assignment) => assignment.resource_id).filter(Boolean),
    [allResourceAssignments],
  );

  const scheduledResourceNames = useMemo(() => {
    if (!primaryResourceCategory || scheduledResourceIds.length === 0) return [];
    return scheduledResourceIds
      .map((id) => primaryResourceCategory.resources?.find((resource) => resource.id === id)?.name)
      .filter(Boolean);
  }, [primaryResourceCategory, scheduledResourceIds]);

  const resourceSelectOptions = useMemo(
    () => buildResourceSelectOptions({
      resources: primaryResourceCategory?.resources || [],
      occupiedResourceIds,
      resourceConflictCounts,
      currentResourceIds: currentAssignedResourceIds,
    }),
    [primaryResourceCategory?.resources, occupiedResourceIds, resourceConflictCounts, currentAssignedResourceIds],
  );

  const resourceTimeRangeLabel = useMemo(
    () => (targetBookingForResourceCheck ? formatBookingTimeRangeLabel(targetBookingForResourceCheck) : ''),
    [targetBookingForResourceCheck],
  );

  const resourceDurationMinutes = useMemo(
    () => (targetBookingForResourceCheck ? getBookingDurationMinutes(targetBookingForResourceCheck) : null),
    [targetBookingForResourceCheck],
  );

  const handleApproveBookingRequest = async () => {
    if (!booking?.id || !auth.selectedBusinessId) return;
    if (booking.terms_package_id && booking.terms_status === 'pending') {
      toast.error('Customer must sign the Terms & Conditions before this booking can be approved.');
      return;
    }
    setApproving(true);
    try {
      const { data, error } = await supabase.functions.invoke('booking-approve-request', {
        body: { businessId: auth.selectedBusinessId, bookingId: booking.id },
      });
      if (error || data?.error) {
        throw new Error(data?.error || error?.message || 'Could not approve booking');
      }
      const audit = await getBookingAuditContext();
      bookingService.setBusinessId(auth.selectedBusinessId);
      await bookingService.logBookingHistoryEvent(
        booking.id,
        BOOKING_HISTORY_ACTIONS.APPROVED,
        'Booking approved',
        { changes: [{ field: 'Approval', from: 'Pending', to: 'Approved' }] },
        audit,
      );
      toast.success('Booking approved. A deposit payment request was sent to the customer.');
      setShowApproveConfirmModal(false);
      await loadBooking();
      notifyUpdated();
    } catch (err) {
      toast.error(err?.message || 'Could not approve booking');
    } finally {
      setApproving(false);
    }
  };

  const handleResendTermsEmail = async () => {
    if (!booking?.id || !auth.selectedBusinessId) return;
    setResendingTermsEmail(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-booking-terms-required', {
        body: {
          businessId: auth.selectedBusinessId,
          bookingId: booking.id,
          resend: true,
        },
      });
      if (error || data?.error) {
        throw new Error(data?.error || error?.message || 'Could not resend email');
      }
      if (data?.skipped && data?.reason === 'already_signed') {
        toast.success('Terms & Conditions are already signed for this booking');
      } else {
        toast.success('Terms & Conditions email resent to the customer');
      }
    } catch (err) {
      toast.error(err?.message || 'Could not resend Terms email');
    } finally {
      setResendingTermsEmail(false);
    }
  };

  const handleRevokeBookingApproval = async (reason) => {
    const trimmedReason = String(reason || '').trim();
    if (!trimmedReason) {
      toast.error('Please provide an explanation for removing approval.');
      return;
    }
    if (!booking?.id || !auth.selectedBusinessId) return;
    setRevokingApproval(true);
    try {
      const { data, error } = await supabase.functions.invoke('booking-revoke-approval', {
        body: {
          businessId: auth.selectedBusinessId,
          bookingId: booking.id,
          reason: trimmedReason,
        },
      });
      if (error || data?.error) {
        throw new Error(data?.error || error?.message || 'Could not remove approval');
      }
      const audit = await getBookingAuditContext();
      bookingService.setBusinessId(auth.selectedBusinessId);
      await bookingService.logBookingHistoryEvent(
        booking.id,
        BOOKING_HISTORY_ACTIONS.APPROVAL_REVOKED,
        'Approval removed',
        {
          reason: trimmedReason,
          changes: [
            { field: 'Approval', from: 'Approved', to: 'Pending' },
            { field: 'Status', from: booking.status, to: 'pending' },
          ],
        },
        audit,
      );
      toast.success('Approval removed. The booking is pending approval again.');
      setShowRevokeApprovalModal(false);
      await loadBooking();
      notifyUpdated();
    } catch (err) {
      toast.error(err?.message || 'Could not remove approval');
    } finally {
      setRevokingApproval(false);
    }
  };

  const handleBack = useCallback(() => {
    if (isModal) {
      onClose?.();
      return;
    }
    navigate(-1);
  }, [isModal, navigate, onClose]);

  const handleCancel = () => {
    if (!canEditBookings || booking?.status === 'cancelled') return;
    setShowCancelModal(true);
  };

  const handleConfirmCancelBooking = async (reason) => {
    if (!booking?.id || !reason?.trim()) return;

    try {
      setCancelling(true);
      const audit = await getBookingAuditContext();
      await bookingService.cancelBooking(bookingId, reason.trim(), audit);
      toast.success('Booking cancelled');
      setShowCancelModal(false);
      await loadBooking();
      notifyUpdated();
    } catch (error) {
      console.error('Error cancelling booking:', error);
      toast.error(error?.message || 'Error cancelling booking');
    } finally {
      setCancelling(false);
    }
  };

  const handleRestoreBooking = async () => {
    if (!canEditBookings || booking?.status !== 'cancelled' || restoring) return;
    if (!window.confirm('Restore this cancelled booking? The customer can pay their deposit and keep the reservation.')) {
      return;
    }

    setRestoring(true);
    try {
      bookingService.setBusinessId(auth.selectedBusinessId);
      const audit = await getBookingAuditContext();
      await bookingService.restoreBooking(bookingId, audit);
      toast.success('Booking restored');
      await loadBooking();
      notifyUpdated();
    } catch (error) {
      console.error('Error restoring booking:', error);
      toast.error(error?.message || 'Could not restore booking');
    } finally {
      setRestoring(false);
    }
  };

  const handleOpenPaymentTab = useCallback(() => {
    if (bookingBlocksPaymentRequestUntilApproved(booking)) {
      toast.error('Approve this party before opening payment.');
      return;
    }
    setActiveTab('payment');
  }, [booking]);

  const handleOpenPrintModal = async () => {
    if (!booking?.id || !auth.selectedBusinessId) return;

    setShowPrintModal(true);
    setPrintDataLoading(true);
    setPrintGuestListEntries([]);
    setPrintGuestList(null);
    setPrintBookingNotes([]);
    setPrintInventoryItems([]);
    setPrintBundleContext({});

    try {
      partyGuestListService.setBusinessId(auth.selectedBusinessId);
      bookingService.setBusinessId(auth.selectedBusinessId);

      const inventoryIds = collectPortalOptionInventoryItemIds(
        booking?.booking_activities?.addon_settings,
      );

      const [guestListData, notes, inventoryResult] = await Promise.all([
        partyGuestListService.loadGuestListForBooking(booking).catch((error) => {
          console.warn('[BookingDetailPanel] print guest list load:', error);
          return null;
        }),
        bookingService.listBookingNotes(booking.id).catch((error) => {
          console.warn('[BookingDetailPanel] print notes load:', error);
          return [];
        }),
        inventoryIds.length
          ? supabase
              .from('pos_inventory')
              .select('id, name, price, is_bundle, bundle_description')
              .eq('business_id', auth.selectedBusinessId)
              .in('id', inventoryIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (inventoryResult?.error) {
        console.warn('[BookingDetailPanel] print inventory load:', inventoryResult.error);
      }

      const inventoryItems = inventoryResult?.data || [];
      const bundleContext = await fetchBundleDataForInventoryIds(
        supabase,
        auth.selectedBusinessId,
        inventoryItems,
      ).catch((error) => {
        console.warn('[BookingDetailPanel] print bundle load:', error);
        return {};
      });

      setPrintGuestListEntries(guestListData?.entries || []);
      setPrintGuestList(guestListData?.guestList || null);
      setPrintBookingNotes(Array.isArray(notes) ? notes : []);
      setPrintInventoryItems(inventoryItems);
      setPrintBundleContext(bundleContext || {});
    } finally {
      setPrintDataLoading(false);
    }
  };

  const handleExecuteBookingPrint = async (sections) => {
    if (!booking) return;

    const assignedRooms = formatBookingResourceAssignments(
      booking.booking_resource_assignments || [],
      resources,
    );
    const resourceLabel = assignedRooms.length
      ? assignedRooms.map((assignment) => assignment.resourceName).filter(Boolean).join(' + ')
      : 'Not assigned';

    const html = buildBookingPrintHtml({
      booking,
      sections,
      businessTimezone,
      partyHostName: getPartyHostName(booking),
      birthdayChildName: getBirthdayChildName(booking),
      resourceLabel,
      optionsCatalog: buildBookingPrintOptionsCatalog(booking, {
        inventoryItems: printInventoryItems,
        bundleContext: printBundleContext,
      }),
      participants: booking.booking_participants || [],
      guestListEntries: printGuestListEntries,
      guestList: printGuestList,
      bookingNotes: printBookingNotes,
      pricing: bookingPricing || getEffectiveBookingPricingSummary(booking),
    });

    openBookingPrintWindow(html);
  };

  const buildParticipantsSummaryEmailPayload = useCallback(() => {
    if (!booking) return null;

    const bookerName = getBookingBookerDisplayName(booking);
    const bookerEmail = String(booking.customer_email || '').trim();
    const bookerPhoneRaw = String(booking.customer_phone || '').trim();
    const bookerPhone = formatPhoneDisplay(bookerPhoneRaw) || bookerPhoneRaw;
    const birthdayChildName = getBirthdayChildName(booking);

    const participants = participantsTabRows.map((row) => {
      const role = partyRoleLabel(row.party_role)
        || (row.minorFlags?.showBadge ? 'Minor' : 'Guest');
      const email = String(row.contact?.email || '').trim();
      const phoneRaw = String(row.contact?.phone || '').trim();
      const phone = formatPhoneDisplay(phoneRaw) || phoneRaw;

      return {
        name: row.displayName || '—',
        role,
        email: email || null,
        phone: phone || null,
        attending: selectedParticipantKeys.includes(row.selectionKey),
      };
    });

    return {
      booker: {
        name: bookerName,
        email: bookerEmail || null,
        phone: bookerPhone || null,
        birthdayChild: birthdayChildName || null,
      },
      participants,
    };
  }, [booking, participantsTabRows, selectedParticipantKeys]);

  const handleSendPartyInfoToCustomer = async () => {
    if (!booking?.id || !auth.selectedBusinessId || sendingPartyInfoEmail) return;

    const primaryEmail = String(booking.customer_email || '').trim();
    const secondaryEmail = String(booking.secondary_customer_email || '').trim();
    if (!primaryEmail && !secondaryEmail) {
      toast.error('No customer email on this booking. Add an email on the booking or save an additional notification email first.');
      return;
    }

    const payload = buildParticipantsSummaryEmailPayload();
    if (!payload) return;

    const recipientSummary = [
      primaryEmail ? primaryEmail : null,
      secondaryEmail && secondaryEmail.toLowerCase() !== primaryEmail.toLowerCase()
        ? `CC: ${secondaryEmail}`
        : null,
    ].filter(Boolean).join(' · ');

    if (
      !window.confirm(
        `Email the party booker details and participant list to ${recipientSummary || 'the customer'}?`,
      )
    ) {
      return;
    }

    try {
      setSendingPartyInfoEmail(true);
      const { data, error } = await supabase.functions.invoke('send-booking-participants-summary', {
        body: {
          businessId: auth.selectedBusinessId,
          bookingId: booking.id,
          sendToCustomer: true,
          booker: payload.booker,
          participants: payload.participants,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const sentTo = data?.to || primaryEmail || secondaryEmail;
      const cc = data?.cc || null;
      toast.success(
        cc
          ? `Party info sent to ${sentTo} (CC: ${cc})`
          : `Party info sent to ${sentTo}`,
      );
    } catch (err) {
      console.error('send-booking-participants-summary failed:', err);
      toast.error(err?.message || 'Could not email party info');
    } finally {
      setSendingPartyInfoEmail(false);
    }
  };

  const handleSaveSecondaryNotificationEmail = async () => {
    if (!booking?.id || !canEditBookings || savingSecondaryNotificationEmail) return;

    const normalized = String(secondaryNotificationEmail || '').trim().toLowerCase();
    const primaryEmail = String(booking.customer_email || '').trim().toLowerCase();

    if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      toast.error('Enter a valid email address');
      return;
    }
    if (normalized && primaryEmail && normalized === primaryEmail) {
      toast.error('Additional email must be different from the primary email on file');
      return;
    }

    try {
      setSavingSecondaryNotificationEmail(true);
      const audit = await getBookingAuditContext();
      const updated = await bookingService.updateBooking(
        booking.id,
        { secondary_customer_email: normalized || null },
        audit,
      );
      setBooking(updated);
      setSecondaryNotificationEmail(String(updated?.secondary_customer_email || '').trim());
      toast.success(normalized ? 'Additional notification email saved' : 'Additional notification email removed');
    } catch (err) {
      console.error('Failed to save secondary notification email:', err);
      toast.error(err?.message || 'Could not save additional notification email');
    } finally {
      setSavingSecondaryNotificationEmail(false);
    }
  };

  const handleSaveParticipantSelection = async () => {
    if (!booking?.id || !canEditBookings || savingParticipants) return;

    const selectedRows = participantsTabRows.filter((row) =>
      selectedParticipantKeys.includes(row.selectionKey),
    );

    if (selectedRows.length === 0) {
      toast.error('Select at least one participant for this party.');
      return;
    }

    const missingHost = participantsTabRows.some(
      (row) => row.is_party_host && !selectedParticipantKeys.includes(row.selectionKey),
    );
    const missingBirthdayChild = participantsTabRows.some(
      (row) => row.is_birthday_child && !selectedParticipantKeys.includes(row.selectionKey),
    );

    if (missingHost || missingBirthdayChild) {
      toast.error('Party host and birthday child must be included.');
      return;
    }

    try {
      setSavingParticipants(true);
      const audit = await getBookingAuditContext();
      const payloads = selectedRows.map((row) => tabRowToBookingParticipantPayload(row));
      const uniqueCheck = assertUniqueBookingParticipantIdentities(payloads);
      if (!uniqueCheck.ok) {
        toast.error(uniqueCheck.message);
        return;
      }
      const updated = await bookingService.replaceBookingParticipants(booking.id, payloads, audit);
      setBooking(updated);
      try {
        partyGuestListService.setBusinessId(auth.selectedBusinessId);
        await partyGuestListService.syncGuestListFromBookingParticipants(updated);
      } catch (syncError) {
        console.warn('[BookingDetailPanel] guest list sync:', syncError);
      }
      toast.success(`Saved ${selectedRows.length} participant${selectedRows.length === 1 ? '' : 's'} for this party`);
      notifyUpdated();
    } catch (error) {
      console.error('Error saving party participants:', error);
      toast.error(error?.message || 'Could not save participants');
    } finally {
      setSavingParticipants(false);
    }
  };

  const handleToggleParticipantSelection = (row) => {
    if (!canEditBookings || isParticipantSelectionLocked(row)) return;
    const key = row.selectionKey;
    setSelectedParticipantKeys((current) => (
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    ));
  };

  const handleSaveResourceAssignments = async (categoryId, resourceIds) => {
    if (!booking?.id || !categoryId || !resourceIds?.length) return;

    const resourceCheck = validateCombinedResourceAssignments({
      resourceIds,
      occupiedResourceIds,
    });
    if (!resourceCheck.ok) {
      toast.error(resourceCheck.message);
      return;
    }

    try {
      setSavingRoom(true);
      const audit = await getBookingAuditContext();
      const assignments = resourceIds.map((resourceId) => ({ categoryId, resourceId }));
      const updated = await bookingService.replaceResourceAssignments(
        booking.id,
        assignments,
        'manual',
        audit,
      );
      setBooking(updated);
      setShowResourceAssignmentModal(false);
      toast.success(
        resourceIds.length > 1 ? 'Room assignments updated' : 'Room assignment updated',
      );
      notifyUpdated();
    } catch (error) {
      console.error('Error updating room:', error);
      toast.error(error?.message || 'Could not update room');
    } finally {
      setSavingRoom(false);
    }
  };

  const handleOpenExtendTimeModal = () => {
    if (!booking?.id || booking.status === 'cancelled') return;
    setShowExtendTimeModal(true);
  };

  const handleConfirmExtendBooking = async ({
    addedMinutes,
    extensionType,
    reason,
    amountCharged,
    priceOverridden,
    calculatedCharge,
  }) => {
    if (!booking?.id) return;

    try {
      setExtending(true);
      bookingService.setBusinessId(auth.selectedBusinessId);
      const audit = await getBookingAuditContext();
      const updated = await bookingService.extendBookingTime(booking.id, {
        addedMinutes,
        extensionType: extensionType || 'courtesy',
        reason: reason || '',
        amountCharged,
        calculatedCharge,
        priceOverridden,
        audit,
      });
      setBooking(updated);
      setShowExtendTimeModal(false);
      toast.success(
        amountCharged > 0
          ? `Booking extended · ${formatBookingMoney(amountCharged)} recorded`
          : 'Booking time extended',
      );
      notifyUpdated();
    } catch (error) {
      console.error('Error extending booking:', error);
      toast.error(error?.message || 'Could not extend booking');
    } finally {
      setExtending(false);
    }
  };

  const handleCheckInComplete = async ({ silent = false } = {}) => {
    await refreshBookingSilently();
    if (!silent) {
      notifyUpdated();
    }
  };

  const persistBookingSchedule = async (businessHoursOverrideApprovedBy = null) => {
    const selectedActivity = activityOptions.find((activity) => activity.id === editForm.activityId);
    const durationMinutes =
      selectedActivity?.duration_minutes
      ?? booking?.duration_minutes
      ?? booking?.booking_activities?.duration_minutes
      ?? 60;
    const normalizedTime = normalizeBookingScheduleTime(editForm.bookingTime);

    setSavingSchedule(true);
    try {
      const audit = await getBookingAuditContext();
      const updates = {
        activity_id: editForm.activityId,
        booking_date: editForm.bookingDate,
        booking_time: normalizedTime,
        session_id: null,
      };

      if (selectedActivity?.duration_minutes) {
        updates.duration_minutes = selectedActivity.duration_minutes;
      }

      await bookingService.updateBooking(booking.id, updates, {
        ...audit,
        businessHoursOverrideApprovedBy,
        historyContext: {
          activityNames: {
            [booking.activity_id]: booking.booking_activities?.name
              || booking.booking_activities?.activity_name
              || booking.activity_id,
            [editForm.activityId]: selectedActivity?.name
              || selectedActivity?.activity_name
              || editForm.activityId,
          },
        },
      });
      await bookingService.syncResourceAssignmentsFromSchedule(
        booking.id,
        editForm.activityId,
        editForm.bookingDate,
        normalizedTime,
        { replaceExisting: true, businessData: auth.businessData, audit },
      );
      toast.success('Booking updated');
      await loadBooking();
      notifyUpdated();
    } catch (error) {
      console.error('Error updating booking schedule:', error);
      toast.error(error?.message || 'Could not update booking');
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleHoursOverrideApproved = async (pin) => {
    const { approvedBy } = await approveBusinessHoursOverride(auth.selectedBusinessId, pin);
    setHoursOverrideModal({ open: false, reason: '' });
    await persistBookingSchedule(approvedBy);
  };

  const handleSaveBookingSchedule = async () => {
    if (!booking?.id || !canEditBookings) return;
    if (!editForm.activityId || !editForm.bookingDate || !editForm.bookingTime) {
      toast.error('Activity, date, and time are required');
      return;
    }

    if (isBookingDateInPast(editForm.bookingDate, businessTimezone)) {
      toast.error('Booking date cannot be in the past');
      return;
    }

    const slotCheck = validateScheduleSlotSelection({
      schedules: activitySchedules,
      bookingDate: editForm.bookingDate,
      bookingTime: editForm.bookingTime,
      businessTimezone,
      bookedCountsByTime: slotBookedCountsByTime,
    });
    if (!slotCheck.ok) {
      toast.error(slotCheck.message);
      return;
    }

    const selectedActivity = activityOptions.find((activity) => activity.id === editForm.activityId);
    const durationMinutes =
      selectedActivity?.duration_minutes
      ?? booking?.duration_minutes
      ?? booking?.booking_activities?.duration_minutes
      ?? 60;
    const normalizedTime = normalizeBookingScheduleTime(editForm.bookingTime);
    const scheduleMatches = dedupeSchedulesByStartTime(
      findMatchingScheduleSlots(
        activitySchedules,
        editForm.bookingDate,
        normalizedTime,
        businessTimezone,
      ),
    );
    const scheduleForTime = scheduleMatches[0];
    if (scheduleForTime && primaryResourceCategory?.categoryId) {
      const resourceCheck = areRequiredResourcesAvailableForSlot({
        schedule: scheduleForTime,
        categoryId: primaryResourceCategory.categoryId,
        bookingDate: editForm.bookingDate,
        bookingTime: normalizedTime,
        durationMinutes,
        dayBookings: dayBookingsWithResources,
        excludeBookingId: booking.id,
        resourcePaddingById,
        resourceQuantityById,
      });
      if (!resourceCheck.ok) {
        toast.error(
          'Required room(s) for this activity are not available at that time. Another booking may already be using them.',
        );
        return;
      }
    }

    const hoursCheck = checkBookingBusinessHours({
      bookingDate: editForm.bookingDate,
      bookingTime: normalizedTime,
      durationMinutes,
      operatingHours: auth.businessData?.operating_hours,
      holidayHours: auth.businessData?.holiday_hours,
    });
    if (!hoursCheck.ok && hoursCheck.requiresOverride) {
      setHoursOverrideModal({ open: true, reason: hoursCheck.message });
      return;
    }
    if (!hoursCheck.ok) {
      toast.error(hoursCheck.message);
      return;
    }

    await persistBookingSchedule();
  };

  const renderTabBar = () => (
    <div
      style={{
        display: 'flex',
        gap: '2px',
        padding: isModal ? '0 20px 0' : '0 0 20px',
        background: isModal ? '#fff' : 'transparent',
        borderBottom: isModal ? '1px solid #e5e7eb' : 'none',
        flexShrink: 0,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {visibleDetailTabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => (tab.id === 'payment' ? handleOpenPaymentTab() : setActiveTab(tab.id))}
          style={{
            padding: '10px 16px',
            border: 'none',
            borderBottom: activeTab === tab.id ? `2px solid ${TavariStyles.colors.primary}` : '2px solid transparent',
            background: 'transparent',
            color: activeTab === tab.id ? TavariStyles.colors.primary : TavariStyles.colors.gray600,
            fontSize: '14px',
            fontWeight: activeTab === tab.id ? '700' : '600',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  const renderBookingTab = (
    currentAssignment,
    primaryResourceCategoryForTab,
    effectiveEndTime,
    userNames,
    resourceOptions,
    resourceWindowLabel,
    resourceDuration,
    resourceOptionsLoading,
    resourcePaddingSummary,
    combinedResourceAssignments,
    isCombinedResources,
    scheduledResourceNamesForTab,
  ) => {
    const createdBySummary = buildBookingCreatedBySummary(booking, userNames, businessTimezone);
    const lastChangedSummary = buildBookingLastChangedSummary(booking, userNames, businessTimezone);

    return (
    <div style={cardStyle}>
      <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '20px', marginTop: 0 }}>
        Booking Schedule
      </h2>

      {canEditBookings && booking.status !== 'cancelled' ? (
        <div style={{ display: 'grid', gap: '16px' }}>
          <div>
            <div style={fieldLabelStyle}>Activity</div>
            <select
              value={editForm.activityId}
              onChange={(event) => {
                const nextActivityId = event.target.value;
                setEditForm((current) => ({
                  ...current,
                  activityId: nextActivityId,
                  bookingTime: '',
                }));
              }}
              style={fieldInputStyle}
            >
              <option value="">Select activity…</option>
              {activityOptions.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.activity_name}
                  {activity.is_active === false ? ' (inactive)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={fieldLabelStyle}>Date</div>
            <BookingActivityDatePicker
              value={editForm.bookingDate || ''}
              onChange={(dateKey) => {
                setEditForm((current) => ({
                  ...current,
                  bookingDate: dateKey,
                  bookingTime: '',
                }));
              }}
              schedules={activitySchedules}
              businessTimezone={businessTimezone}
              disabled={!editForm.activityId}
              loading={schedulesLoading}
            />
          </div>

          <div>
            <div style={fieldLabelStyle}>Time</div>
            <select
              value={editForm.bookingTime || ''}
              onChange={(event) => {
                setEditForm((current) => ({
                  ...current,
                  bookingTime: event.target.value,
                }));
              }}
              disabled={!editForm.bookingDate || schedulesLoading || slotBookingsLoading}
              style={{
                ...fieldInputStyle,
                backgroundColor: !editForm.bookingDate || schedulesLoading || slotBookingsLoading ? '#f3f4f6' : 'white',
              }}
            >
              <option value="">
                {schedulesLoading || slotBookingsLoading
                  ? 'Loading times…'
                  : !editForm.bookingDate
                    ? 'Select a date first…'
                    : scheduleTimeOptions.length
                      ? 'Select a time…'
                      : 'No scheduled times for this date'}
              </option>
              {scheduleTimeOptions.map((option) => (
                <option
                  key={`${option.value}-${option.label}`}
                  value={option.value}
                  disabled={option.disabled}
                >
                  {option.label}
                </option>
              ))}
            </select>
            {selectedScheduleOption?.disabled ? (
              <div style={{ fontSize: '13px', color: '#b45309', marginTop: '6px' }}>
                {selectedScheduleOption.resourceBlocked
                  ? 'Required room(s) are not available at this time — another booking may already be using them (even on a different activity). Choose another time.'
                  : 'This time slot is already full. Choose another time to avoid a double booking.'}
              </div>
            ) : null}
            {editForm.bookingDate && !schedulesLoading && !slotBookingsLoading && scheduleTimeOptions.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#b45309', marginTop: '6px' }}>
                No schedule slots are configured for this activity on the selected date.
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '16px' }}>
          <div>
            <div style={fieldLabelStyle}>Activity</div>
            <div style={{ fontSize: '16px', fontWeight: '600' }}>
              {booking.booking_activities?.activity_name || 'N/A'}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isModal ? '1fr' : '1fr 1fr', gap: '16px' }}>
            <div>
              <div style={fieldLabelStyle}>Date</div>
              <div style={{ fontSize: '16px' }}>
                {formatDateShort(booking.booking_date, businessTimezone)}
              </div>
            </div>
            <div>
              <div style={fieldLabelStyle}>Time</div>
              <div style={{ fontSize: '16px' }}>
                {formatBookingTimeRangeLabel(booking)}
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gap: '16px', marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #e5e7eb' }}>
        <div>
          <div style={fieldLabelStyle}>Room / Resource</div>
          <div style={{ fontSize: '16px', fontWeight: '600' }}>
            {isCombinedResources
              ? combinedResourceAssignments.map((assignment) => assignment.resourceName).join(' + ')
              : (currentAssignment?.resourceName || 'Not assigned')}
          </div>
          {isCombinedResources ? (
            <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: '8px', lineHeight: 1.5 }}>
              These rooms are required together for this party size. They count as one booking slot, not separate capacity.
            </div>
          ) : null}
          {canEditBookings && primaryResourceCategoryForTab && booking.status !== 'cancelled' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
              {resourceWindowLabel ? (
                <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, lineHeight: 1.5 }}>
                  Room held for this booking: <strong>{resourceWindowLabel}</strong>
                  {resourceDuration ? ` (${resourceDuration} min)` : ''}
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setShowResourceAssignmentModal(true)}
                  disabled={savingRoom || resourceOptionsLoading}
                  style={{
                    ...fieldInputStyle,
                    width: 'auto',
                    minWidth: '220px',
                    cursor: savingRoom || resourceOptionsLoading ? 'not-allowed' : 'pointer',
                    opacity: savingRoom || resourceOptionsLoading ? 0.65 : 1,
                    textAlign: 'left',
                    fontWeight: 600,
                  }}
                >
                  {resourceOptionsLoading
                    ? 'Loading rooms…'
                    : isCombinedResources || combinedResourceAssignments.length > 1
                      ? 'Change rooms…'
                      : 'Change room…'}
                </button>
              </div>
              {scheduledResourceNamesForTab?.length > 0 && isCombinedResources && !isScheduleDirty ? (
                <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, lineHeight: 1.5 }}>
                  Scheduled default: {scheduledResourceNamesForTab.join(' + ')}
                </div>
              ) : null}
              {isScheduleDirty && editForm.bookingTime ? (
                <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, lineHeight: 1.5 }}>
                  Room shown for the selected date and time. Save the booking to apply this change.
                </div>
              ) : null}
              {resourceOptions.some((resource) => resource.disabled) ? (
                <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, lineHeight: 1.5 }}>
                  Rooms marked &ldquo;in use&rdquo; overlap this booking&apos;s time window, including any turnover padding configured on the resource.
                </div>
              ) : null}
              {!isCombinedResources && resourcePaddingSummary ? (
                <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, lineHeight: 1.5 }}>
                  Turnover padding for selected room: {resourcePaddingSummary}.
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div>
          <div style={fieldLabelStyle}>Booking Number</div>
          <div style={{ fontSize: '16px', fontFamily: 'monospace' }}>
            {booking.booking_number}
          </div>
        </div>
        <div
          style={{
            paddingTop: '4px',
            borderTop: '1px solid #f3f4f6',
          }}
        >
          <div style={{ display: 'grid', gap: '10px' }}>
            <div>
              <div style={fieldLabelStyle}>Created by</div>
              <div style={{ fontSize: '14px', color: TavariStyles.colors.gray800, lineHeight: 1.5 }}>
                {formatProvenanceDetailLine({
                  actor: createdBySummary.actor,
                  ip: createdBySummary.ip || 'Not recorded',
                  date: createdBySummary.date,
                })}
              </div>
            </div>
            <div>
              <div style={fieldLabelStyle}>Last changed by</div>
              <div style={{ fontSize: '14px', color: TavariStyles.colors.gray800, lineHeight: 1.5 }}>
                {formatProvenanceDetailLine({
                  ...lastChangedSummary,
                  ip: lastChangedSummary.unchanged
                    ? null
                    : (lastChangedSummary.ip || 'Not recorded'),
                })}
              </div>
            </div>
          </div>
        </div>
        {booking.extended_minutes ? (
          <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600 }}>
            Extended by {booking.extended_minutes} minutes
            {effectiveEndTime ? ` · ends ${effectiveEndTime}` : ''}
          </div>
        ) : null}
        {booking.notes ? (
          <div>
            <div style={fieldLabelStyle}>Notes</div>
            <div style={{ fontSize: '14px', color: TavariStyles.colors.gray700 }}>
              {booking.notes}
            </div>
          </div>
        ) : null}
        {booking.qr_code ? (
          <div>
            <div style={fieldLabelStyle}>QR Code</div>
            <div
              style={{
                fontSize: '14px',
                fontFamily: 'monospace',
                backgroundColor: '#f3f4f6',
                padding: '8px',
                borderRadius: '6px',
                wordBreak: 'break-all',
              }}
            >
              {booking.qr_code}
            </div>
          </div>
        ) : null}
      </div>
    </div>
    );
  };

  const renderApprovalBanner = () => {
    if (booking?.status === 'cancelled') {
      return (
        <div
          style={{
            flexShrink: 0,
            padding: '10px 20px',
            backgroundColor: '#fef2f2',
            borderBottom: '1px solid #fecaca',
            color: '#991b1b',
            fontSize: '13px',
            fontWeight: 600,
            lineHeight: 1.45,
          }}
        >
          This booking is cancelled
          {booking.cancellation_reason ? `: ${booking.cancellation_reason}` : '.'}
          {canEditBookings
            ? ' Use Restore booking in the sidebar if the customer is ready to pay and keep the reservation.'
            : null}
        </div>
      );
    }

    if (!booking?.requires_approval) {
      return null;
    }

    if (!booking.approved_at) {
      const termsPending = booking.terms_package_id && booking.terms_status === 'pending';
      const termsSigned = booking.terms_status === 'signed';
      return (
        <div
          style={{
            flexShrink: 0,
            padding: '10px 20px',
            backgroundColor: termsPending ? '#fff7ed' : '#fef3c7',
            borderBottom: `1px solid ${termsPending ? '#fed7aa' : '#fcd34d'}`,
            color: termsPending ? '#9a3412' : '#92400e',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          {termsPending
            ? 'Waiting for the customer to acknowledge and sign Terms & Conditions. Approval is blocked until they complete that step.'
            : termsSigned
              ? 'Terms & Conditions signed. This booking request is ready for staff review and approval.'
              : 'This booking request has not been accepted yet. Approve it or save changes using the actions on the right.'}
        </div>
      );
    }

    return (
      <div
        style={{
          flexShrink: 0,
          padding: '10px 20px',
          backgroundColor: '#ecfdf5',
          borderBottom: '1px solid #86efac',
          color: '#166534',
          fontSize: '13px',
          fontWeight: 600,
        }}
      >
        This party booking has been approved
        {booking.deposit_due_at ? '. Deposit payment was requested from the customer.' : '.'}
      </div>
    );
  };

  const renderSidebar = () => {
    if (!booking) return null;

    const pricing = bookingPricing || getEffectiveBookingPricingSummary(booking);
    const saveDisabled =
      !isScheduleDirty
      || savingSchedule
      || !editForm.bookingTime
      || isBookingDateInPast(editForm.bookingDate, businessTimezone)
      || selectedScheduleOption?.disabled;
    const revokeApprovalBlockedReason = revokeBookingApprovalBlockedReason(booking);
    const showRevokeApprovalAction = canEditBookings && canRevokeBookingApproval(booking);

    return (
      <aside
        style={{
          width: isCompactLayout ? '100%' : '240px',
          flexShrink: 0,
          borderLeft: isCompactLayout ? 'none' : '1px solid #e5e7eb',
          borderTop: isCompactLayout ? '1px solid #e5e7eb' : 'none',
          backgroundColor: '#fff',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          // In modal compact mode the parent scrolls; keep sidebar in flow.
          // In wide modal mode, sidebar scrolls independently within the shell.
          overflowY: isModal && !isCompactLayout ? 'auto' : 'visible',
          maxHeight: isModal && !isCompactLayout ? '100%' : undefined,
          minHeight: 0,
          boxSizing: 'border-box',
        }}
      >
        <div style={{ marginBottom: '16px' }}>
          {canEditBookings && booking.status === 'cancelled' ? (
            <button
              type="button"
              onClick={handleRestoreBooking}
              disabled={restoring}
              style={sidebarButtonStyle('success', restoring)}
            >
              <FiRefreshCw size={16} />
              {restoring ? 'Restoring…' : 'Restore booking'}
            </button>
          ) : null}

          {canEditBookings && booking.status !== 'cancelled' ? (
            <button
              type="button"
              onClick={handleSaveBookingSchedule}
              disabled={saveDisabled}
              style={sidebarButtonStyle('primary', saveDisabled)}
            >
              <FiSave size={16} />
              {savingSchedule ? 'Saving…' : 'Save'}
            </button>
          ) : null}

          {canEditBookings && booking.requires_approval && !booking.approved_at && booking.status === 'pending' ? (
            <button
              type="button"
              onClick={() => setShowApproveConfirmModal(true)}
              disabled={approving || (booking.terms_package_id && booking.terms_status === 'pending')}
              title={
                booking.terms_package_id && booking.terms_status === 'pending'
                  ? 'Customer must sign Terms & Conditions first'
                  : undefined
              }
              style={sidebarButtonStyle(
                'primary',
                approving || (booking.terms_package_id && booking.terms_status === 'pending'),
              )}
            >
              {approving ? 'Approving…' : 'Approve & request deposit'}
            </button>
          ) : null}

          {canEditBookings
            && booking.terms_package_id
            && booking.terms_status === 'pending'
            && booking.status !== 'cancelled' ? (
            <button
              type="button"
              onClick={handleResendTermsEmail}
              disabled={resendingTermsEmail}
              style={sidebarButtonStyle('default', resendingTermsEmail)}
            >
              <FiMail size={16} />
              {resendingTermsEmail ? 'Sending…' : 'Resend T&Cs email'}
            </button>
          ) : null}

          {showRevokeApprovalAction ? (
            <button
              type="button"
              onClick={() => setShowRevokeApprovalModal(true)}
              disabled={revokingApproval}
              style={sidebarButtonStyle('danger', revokingApproval)}
            >
              {revokingApproval ? 'Removing…' : 'Remove approval'}
            </button>
          ) : null}

          {canEditBookings && booking.requires_approval && booking.approved_at && revokeApprovalBlockedReason ? (
            <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, lineHeight: 1.45, marginBottom: 8 }}>
              {revokeApprovalBlockedReason}
            </div>
          ) : null}

          {canCheckIn
            && booking.status !== 'cancelled'
            && ['pending', 'confirmed', 'checked_in'].includes(booking.status) ? (
              <div style={{ marginBottom: '8px' }}>
                <BookingCheckInButton
                  booking={booking}
                  onCheckInComplete={handleCheckInComplete}
                  canCheckIn={canCheckIn}
                  fullWidth
                  showBookingDetailsButton={false}
                  syncOnPartialCheckIn
                />
              </div>
            ) : null}

          <button
            type="button"
            onClick={handleOpenPaymentTab}
            style={sidebarButtonStyle('default')}
          >
            <FiCreditCard size={16} />
            Payment
          </button>

          <button
            type="button"
            onClick={handleOpenPrintModal}
            style={sidebarButtonStyle('default')}
          >
            <FiPrinter size={16} />
            Print
          </button>

          {canEditBookings && booking.status !== 'cancelled' ? (
            <button
              type="button"
              onClick={handleOpenExtendTimeModal}
              disabled={extending}
              style={sidebarButtonStyle('default', extending)}
            >
              <FiClock size={16} />
              {extending ? 'Extending…' : 'Extend time'}
            </button>
          ) : null}

          {canEditBookings && booking.status !== 'cancelled' ? (
            <button
              type="button"
              onClick={handleCancel}
              style={sidebarButtonStyle('danger')}
            >
              <FiX size={16} />
              Cancel booking
            </button>
          ) : null}
        </div>

        <div
          style={{
            borderTop: '1px solid #e5e7eb',
            paddingTop: '16px',
            marginTop: 'auto',
          }}
        >
          <button
            type="button"
            onClick={() => setShowPricingBreakdownModal(true)}
            style={{
              ...sidebarButtonStyle('default'),
              marginBottom: 12,
            }}
          >
            <FiList size={16} />
            Price breakdown
          </button>

          <div style={{ fontSize: '13px', color: TavariStyles.colors.gray700, display: 'grid', gap: '8px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                fontWeight: 600,
                color: TavariStyles.colors.gray900,
                paddingBottom: '8px',
                marginBottom: '4px',
                borderBottom: '1px solid #e5e7eb',
              }}
            >
              <span>Required deposit</span>
              <span>{formatBookingMoney(requiredDepositAmount)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
              <span>Subtotal</span>
              <span>{formatBookingMoney(pricing.subtotal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
              <span>Taxes</span>
              <span>{formatBookingMoney(pricing.taxAmount)}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                fontWeight: 700,
                fontSize: '15px',
                color: TavariStyles.colors.gray900,
                paddingTop: '4px',
              }}
            >
              <span>Total price</span>
              <span>{formatBookingMoney(pricing.totalPrice)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
              <span>Total paid</span>
              <span>{formatBookingMoney(pricing.totalPaid)}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                fontWeight: 600,
              }}
            >
              <span>Total due</span>
              <span>{formatBookingMoney(pricing.totalDue)}</span>
            </div>
            {pricing.dueNow > 0 ? (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '12px',
                  fontWeight: 600,
                  color: '#b45309',
                }}
              >
                <span>Due now</span>
                <span>{formatBookingMoney(pricing.dueNow)}</span>
              </div>
            ) : null}
            {!pricing.hasPricing ? (
              <div style={{ fontSize: '13px', color: TavariStyles.colors.gray500, marginTop: '4px' }}>
                No pricing recorded on this booking yet.
              </div>
            ) : null}
          </div>
        </div>
      </aside>
    );
  };

  const renderHeader = () => {
    const bookerName = booking ? getBookingBookerDisplayName(booking) : '';
    const visitLabel = booking?.booking_date
      ? `${formatDateShort(booking.booking_date, businessTimezone)} ${formatBookingTimeRangeLabel(booking)}`.trim()
      : '';
    const headerTitle = booking && (bookerName || visitLabel)
      ? [bookerName, visitLabel].filter(Boolean).join(': ')
      : 'Booking Details';

    return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flexWrap: 'wrap',
        ...(isModal
          ? {
              flexShrink: 0,
              padding: '16px 20px',
              borderBottom: '1px solid #e5e7eb',
              background: '#fff',
            }
          : { marginBottom: '30px' }),
      }}
    >
      {!isModal ? (
        <button
          type="button"
          onClick={handleBack}
          aria-label="Go back"
          title="Go back"
          style={{
            padding: '8px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <FiArrowLeft size={24} />
        </button>
      ) : null}
      <h1
        style={{
          fontSize: isModal ? '20px' : '32px',
          fontWeight: '600',
          margin: 0,
          flex: 1,
          minWidth: '160px',
        }}
      >
        {headerTitle}
      </h1>
      {isModal ? (
        <button
          type="button"
          onClick={handleBack}
          aria-label="Close booking details"
          title="Close"
          style={{
            padding: '8px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            flexShrink: 0,
            marginLeft: 'auto',
          }}
        >
          <FiX size={22} />
        </button>
      ) : null}
    </div>
    );
  };

  const renderBody = () => {
    if (!canViewBookings) {
      return (
        <div style={{ padding: '40px', textAlign: 'center', color: TavariStyles.colors.gray600 }}>
          <h3 style={{ marginTop: 0 }}>Access denied</h3>
          <p>You do not have permission to view bookings.</p>
          <button type="button" onClick={handleBack}>Close</button>
        </div>
      );
    }

    if (loading) {
      return (
        <div style={{ padding: '40px', textAlign: 'center', color: TavariStyles.colors.gray600 }}>
          Loading booking…
        </div>
      );
    }

    if (!booking) {
      return (
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <h3 style={{ marginTop: 0 }}>Booking Not Found</h3>
          <button type="button" onClick={handleBack}>Close</button>
        </div>
      );
    }

    const assignedRooms = allResourceAssignments;
    const currentAssignment = assignedRooms[0] || null;
    const combinedResources = assignedRooms.length > 1;
    const effectiveEndTime = getBookingEndTime(targetBookingForResourceCheck || booking);

    const renderParticipantsTab = () => {
      const participantBadgeStyle = (backgroundColor, color) => ({
        display: 'inline-block',
        marginLeft: '8px',
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '11px',
        fontWeight: 700,
        backgroundColor,
        color,
      });

      const bookerName = getBookingBookerDisplayName(booking);
      const bookerEmail = String(booking.customer_email || '').trim();
      const bookerPhone = String(booking.customer_phone || '').trim();
      const bookerPhoneDisplay = formatPhoneDisplay(bookerPhone) || bookerPhone;
      const birthdayChildName = getBirthdayChildName(booking);

      const copyBookerField = (value, label) => {
        const text = String(value || '').trim();
        if (!text) {
          toast.error(`No ${label.toLowerCase()} to copy`);
          return;
        }
        navigator.clipboard
          .writeText(text)
          .then(() => toast.success(`${label} copied`))
          .catch(() => toast.error('Could not copy'));
      };

      const bookerCopyButtonStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        borderRadius: 6,
        border: '1px solid #d1d5db',
        background: '#fff',
        color: TavariStyles.colors.gray600,
        flexShrink: 0,
      };

      const renderBookerFieldRow = (label, displayValue, copyValue = displayValue) => {
        const canCopy = Boolean(String(copyValue || '').trim());
        return (
          <div>
            <div style={fieldLabelStyle}>{label}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <div
                style={{
                  fontSize: '14px',
                  color: TavariStyles.colors.gray900,
                  wordBreak: 'break-word',
                  flex: 1,
                }}
              >
                {displayValue || '—'}
              </div>
              <button
                type="button"
                onClick={() => copyBookerField(copyValue, label)}
                disabled={!canCopy}
                title={canCopy ? `Copy ${label.toLowerCase()}` : undefined}
                aria-label={canCopy ? `Copy ${label.toLowerCase()}` : undefined}
                style={{
                  ...bookerCopyButtonStyle,
                  cursor: canCopy ? 'pointer' : 'not-allowed',
                  opacity: canCopy ? 1 : 0.45,
                }}
              >
                <FiCopy size={14} />
              </button>
            </div>
          </div>
        );
      };

      const renderBookerSection = () => {
        const savedSecondaryEmail = String(booking?.secondary_customer_email || '').trim().toLowerCase();
        const draftSecondaryEmail = String(secondaryNotificationEmail || '').trim().toLowerCase();
        const secondaryEmailDirty = draftSecondaryEmail !== savedSecondaryEmail;
        const canEditSecondaryEmail = canEditBookings && booking.status !== 'cancelled';

        return (
        <div
          style={{
            padding: '16px',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            backgroundColor: '#f9fafb',
            marginBottom: '24px',
          }}
        >
          <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 12px', color: TavariStyles.colors.gray900 }}>
            Party booker
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: isModal ? '1fr' : '1fr 1fr', gap: '12px 24px' }}>
            {renderBookerFieldRow('Name', bookerName, bookerName)}
            {renderBookerFieldRow('Birthday child', birthdayChildName, birthdayChildName)}
            {renderBookerFieldRow('Email', bookerEmail, bookerEmail)}
            {renderBookerFieldRow('Phone number', bookerPhoneDisplay, bookerPhoneDisplay)}
          </div>
          <div
            style={{
              marginTop: '16px',
              paddingTop: '16px',
              borderTop: '1px solid #e5e7eb',
            }}
          >
            <div style={{ ...fieldLabelStyle, marginBottom: 6 }}>Additional notification email</div>
            <p style={{ margin: '0 0 10px', fontSize: '13px', color: TavariStyles.colors.gray600, lineHeight: 1.5 }}>
              Also receives booking confirmations, payment requests, cancellations, party info emails, and other updates — the same emails as the primary address.
            </p>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="email"
                value={secondaryNotificationEmail}
                onChange={(event) => setSecondaryNotificationEmail(event.target.value)}
                placeholder="name@example.com"
                disabled={!canEditSecondaryEmail || savingSecondaryNotificationEmail}
                style={{
                  ...fieldInputStyle,
                  flex: '1 1 240px',
                  minWidth: 0,
                }}
              />
              {canEditSecondaryEmail ? (
                <button
                  type="button"
                  onClick={handleSaveSecondaryNotificationEmail}
                  disabled={savingSecondaryNotificationEmail || !secondaryEmailDirty}
                  style={{
                    ...sidebarButtonStyle('primary', savingSecondaryNotificationEmail || !secondaryEmailDirty),
                    width: 'auto',
                    marginBottom: 0,
                    padding: '8px 12px',
                    fontSize: '13px',
                  }}
                >
                  <FiSave size={15} />
                  {savingSecondaryNotificationEmail ? 'Saving…' : 'Save email'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
        );
      };

      const canEditParticipants = canEditBookings && booking.status !== 'cancelled';
      const attendingCount = participantsTabRows.filter((row) =>
        selectedParticipantKeys.includes(row.selectionKey),
      ).length;

      const renderParticipantsHeader = () => {
        const hasCustomerEmail = Boolean(
          String(booking.customer_email || '').trim()
          || String(booking.secondary_customer_email || '').trim(),
        );

        return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>
            Participants ({participantsTabRows.length})
          </h2>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {canViewBookings ? (
              <button
                type="button"
                onClick={handleSendPartyInfoToCustomer}
                disabled={sendingPartyInfoEmail || !hasCustomerEmail}
                title={hasCustomerEmail ? 'Email party info to the customer' : 'Add a customer email first'}
                style={{
                  ...sidebarButtonStyle('default', sendingPartyInfoEmail || !hasCustomerEmail),
                  width: 'auto',
                  marginBottom: 0,
                  padding: '8px 14px',
                }}
              >
                <FiMail size={16} />
                {sendingPartyInfoEmail ? 'Sending…' : 'Email party info'}
              </button>
            ) : null}
            {canEditParticipants ? (
              <button
                type="button"
                onClick={handleSaveParticipantSelection}
                disabled={savingParticipants || !participantSelectionDirty}
                style={{
                  ...sidebarButtonStyle('primary', savingParticipants || !participantSelectionDirty),
                  width: 'auto',
                  marginBottom: 0,
                  padding: '8px 14px',
                }}
              >
                <FiSave size={16} />
                {savingParticipants ? 'Saving…' : 'Save attending list'}
              </button>
            ) : null}
          </div>
        </div>
        );
      };

      if (waiverRosterLoading && participantsTabRows.length === 0) {
        return (
          <div style={{ ...cardStyle, marginBottom: 0 }}>
            {renderParticipantsHeader()}
            {renderBookerSection()}
            <div style={{ color: TavariStyles.colors.gray600 }}>
              Loading participants from waiver…
            </div>
          </div>
        );
      }

      if (participantsTabRows.length === 0) {
        return (
          <div style={{ ...cardStyle, marginBottom: 0 }}>
            {renderParticipantsHeader()}
            {renderBookerSection()}
            <div style={{ color: TavariStyles.colors.gray600 }}>
              No participants on this booking.
            </div>
          </div>
        );
      }

      return (
        <div style={{ ...cardStyle, marginBottom: 0 }}>
          {renderParticipantsHeader()}
          {renderBookerSection()}
          <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 8px', color: TavariStyles.colors.gray900 }}>
            Waiver participants
          </h3>
          <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, margin: '0 0 20px', lineHeight: 1.5 }}>
            {canEditParticipants
              ? 'Check who is attending this party. Everyone on the customer\'s waiver is listed — party host and birthday child are always included.'
              : 'Everyone on the customer\'s waiver and who is attending this party.'}
            {' '}
            ({attendingCount} attending)
          </p>
          {participantsTabRows.map((row) => {
            const isExpanded = expandedParticipantId === row.id;
            const isSelected = selectedParticipantKeys.includes(row.selectionKey);
            const isLocked = isParticipantSelectionLocked(row);
            const email = String(row.contact.email || '').trim();
            const phone = String(row.contact.phone || '').trim();
            const dateOfBirth = row.contact.dateOfBirth;
            const roleLabel = partyRoleLabel(row.party_role);
            const waiverSignatureId = getViewableWaiverSignatureId(row.bookingParticipant || row.rosterRow || {});

            return (
              <div
                key={row.id}
                style={{
                  border: `1px solid ${row.is_birthday_child ? '#f59e0b' : isSelected ? '#86efac' : '#e5e7eb'}`,
                  borderRadius: '8px',
                  marginBottom: '8px',
                  overflow: 'hidden',
                  backgroundColor: row.is_birthday_child ? '#fffbeb' : isSelected ? '#f0fdf4' : 'white',
                  opacity: !isSelected && !canEditParticipants ? 0.72 : 1,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    padding: '12px',
                  }}
                >
                  {canEditParticipants ? (
                    <div style={{ paddingTop: '2px' }} onClick={(event) => event.stopPropagation()}>
                      <TavariCheckbox
                        checked={isSelected}
                        disabled={isLocked || savingParticipants}
                        onChange={() => handleToggleParticipantSelection(row)}
                        size="sm"
                      />
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedParticipantId((current) =>
                        current === row.id ? null : row.id,
                      );
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: 0,
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: '12px',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: '600', fontSize: '15px', color: TavariStyles.colors.gray900 }}>
                        {row.displayName}
                        {row.is_birthday_child ? (
                          <span style={participantBadgeStyle('#fef3c7', '#92400e')}>Birthday child</span>
                        ) : null}
                        {row.is_party_host ? (
                          <span style={participantBadgeStyle('#dbeafe', '#1e40af')}>Party host</span>
                        ) : null}
                        {!row.is_birthday_child && !row.is_party_host && row.minorFlags.showBadge ? (
                          <span style={{ marginLeft: '8px', fontSize: '13px', color: '#ef4444' }}>(Minor)</span>
                        ) : null}
                        {isSelected ? (
                          <span style={participantBadgeStyle('#dcfce7', '#166534')}>Attending</span>
                        ) : (
                          <span style={participantBadgeStyle('#f3f4f6', '#6b7280')}>Not attending</span>
                        )}
                      </div>
                      {roleLabel && !row.is_birthday_child && !row.is_party_host ? (
                        <div style={{ fontSize: '13px', marginTop: '4px', color: TavariStyles.colors.gray600 }}>
                          {roleLabel}
                        </div>
                      ) : null}
                      {row.waiver_status && row.waiver_status !== 'not_required' ? (
                        <div style={{ fontSize: '13px', marginTop: '4px' }}>
                          Waiver:{' '}
                          <span
                            style={{
                              color: row.waiver_status === 'valid' ? '#10b981' : '#ef4444',
                            }}
                          >
                            {row.waiver_status}
                          </span>
                        </div>
                      ) : null}
                      {isLocked ? (
                        <div style={{ fontSize: '13px', marginTop: '4px', color: TavariStyles.colors.gray600 }}>
                          Required for this party booking
                        </div>
                      ) : null}
                    </div>
                    <span style={{ color: TavariStyles.colors.gray500, flexShrink: 0, marginTop: '2px' }}>
                      {isExpanded ? <FiChevronDown size={18} /> : <FiChevronRight size={18} />}
                    </span>
                  </button>
                </div>

                {isExpanded ? (
                  <div
                    style={{
                      padding: '0 12px 12px',
                      borderTop: '1px solid #e5e7eb',
                    }}
                  >
                    <div style={{ display: 'grid', gap: '12px', paddingTop: '12px' }}>
                      <div>
                        <div style={fieldLabelStyle}>Name</div>
                        <div style={{ fontSize: '14px', color: TavariStyles.colors.gray900 }}>{row.displayName}</div>
                      </div>
                      <div>
                        <div style={fieldLabelStyle}>Date of birth</div>
                        <div style={{ fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                          {dateOfBirth ? formatDateShort(dateOfBirth, businessTimezone) : '—'}
                        </div>
                      </div>
                      <div>
                        <div style={fieldLabelStyle}>Email</div>
                        <div style={{ fontSize: '14px', color: TavariStyles.colors.gray900, wordBreak: 'break-word' }}>
                          {email || '—'}
                        </div>
                      </div>
                      <div>
                        <div style={fieldLabelStyle}>Phone number</div>
                        <div style={{ fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                          {phone || '—'}
                        </div>
                      </div>
                      {waiverSignatureId ? (
                        <div>
                          <div style={fieldLabelStyle}>Waiver</div>
                          <button
                            type="button"
                            onClick={() => navigate(`/dashboard/waivers/${waiverSignatureId}`)}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              padding: 0,
                              color: TavariStyles.colors.primary,
                              fontSize: '14px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              textDecoration: 'underline',
                            }}
                          >
                            View signed waiver
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      );
    };

    const renderPaymentTab = () => (
      <BookingPaymentTab
        booking={booking}
        businessId={auth.selectedBusinessId}
        onUpdated={async () => {
          await loadBooking({ silent: true });
          notifyUpdated();
        }}
      />
    );

    const renderDetailsTab = () => (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isModal ? '1fr' : '1fr 1fr',
          gap: '20px',
        }}
      >
        <div style={{ ...cardStyle, marginBottom: 0 }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', marginTop: 0 }}>
            Status
          </h3>
          <div style={{ marginBottom: '12px' }}>
            <div style={fieldLabelStyle}>Booking Status</div>
            <div
              style={{
                padding: '6px 12px',
                borderRadius: '12px',
                fontSize: '14px',
                fontWeight: '600',
                display: 'inline-block',
                backgroundColor:
                  booking.status === 'checked_in'
                    ? '#d1fae5'
                    : booking.status === 'cancelled'
                      ? '#fee2e2'
                      : '#fef3c7',
                color:
                  booking.status === 'checked_in'
                    ? '#065f46'
                    : booking.status === 'cancelled'
                      ? '#991b1b'
                      : '#92400e',
              }}
            >
              {booking.status}
            </div>
          </div>
          <div>
            <div style={fieldLabelStyle}>Payment Status</div>
            <div
              style={{
                padding: '6px 12px',
                borderRadius: '12px',
                fontSize: '14px',
                fontWeight: '600',
                display: 'inline-block',
                backgroundColor: booking.payment_status === 'paid' ? '#dbeafe' : '#fee2e2',
                color: booking.payment_status === 'paid' ? '#1e40af' : '#991b1b',
              }}
            >
              {booking.payment_status}
            </div>
          </div>
        </div>

        <div style={{ ...cardStyle, marginBottom: 0 }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', marginTop: 0 }}>
            Customer
          </h3>
          <div style={{ display: 'grid', gap: '12px' }}>
            {booking.customer_email ? (
              <div>
                <div style={fieldLabelStyle}>Email</div>
                <div style={{ fontSize: '14px', wordBreak: 'break-word' }}>{booking.customer_email}</div>
              </div>
            ) : null}
            {booking.customer_phone ? (
              <div>
                <div style={fieldLabelStyle}>Phone</div>
                <div style={{ fontSize: '14px' }}>{formatPhoneDisplay(booking.customer_phone) || booking.customer_phone}</div>
              </div>
            ) : null}
            {!booking.customer_email && !booking.customer_phone ? (
              <div style={{ color: TavariStyles.colors.gray600, fontSize: '14px' }}>
                No customer contact info on file.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );

    return (
      <div>
        {activeTab === 'booking'
          ? renderBookingTab(
            currentAssignment,
            primaryResourceCategory,
            effectiveEndTime,
            provenanceUserNames,
            resourceSelectOptions,
            resourceTimeRangeLabel,
            resourceDurationMinutes,
            dayResourceBookingsLoading,
            currentResourcePaddingSummary,
            assignedRooms,
            combinedResources,
            scheduledResourceNames,
          )
          : null}
        {activeTab === 'participants' ? renderParticipantsTab() : null}
        {activeTab === 'options' ? (
          <BookingOptionsTab
            booking={booking}
            businessId={auth.selectedBusinessId}
            canEdit={canEditBookings}
            getAuditContext={getBookingAuditContext}
            onPricingPreviewChange={setOptionsPricingPreview}
            onSaved={async () => {
              setOptionsPricingPreview(null);
              await loadBooking();
              notifyUpdated();
            }}
          />
        ) : null}
        {activeTab === 'payment' ? renderPaymentTab() : null}
        {activeTab === 'notes' ? (
          <BookingNotesTab
            bookingId={booking.id}
            businessId={auth.selectedBusinessId}
            businessTimezone={businessTimezone}
            authUserId={auth.authUser?.id}
            canManageNotes={canEditBookings}
            onNotesChanged={async () => {
              await loadBooking();
              notifyUpdated();
            }}
          />
        ) : null}
        {activeTab === 'guest-list' ? (
          <PartyGuestListTab booking={booking} businessId={auth.selectedBusinessId} resources={resources} />
        ) : null}
        {String(activeTab || '').startsWith('activity-tab:') ? (
          <BookingActivityTabPanel
            tab={visibleDetailTabs.find((tab) => tab.id === activeTab)?.activityTab}
            booking={booking}
            businessId={auth.selectedBusinessId}
            businessTimezone={businessTimezone}
            mode="staff"
            disabled={booking?.status === 'cancelled'}
          />
        ) : null}
        {activeTab === 'history' ? (
          <BookingHistoryTab
            booking={booking}
            businessId={auth.selectedBusinessId}
            businessTimezone={businessTimezone}
            refreshKey={historyRefreshKey}
          />
        ) : null}
        {activeTab === 'details' ? renderDetailsTab() : null}
        {activeTab === 'terms' ? (
          <BookingTermsTab
            booking={booking}
            businessId={auth.selectedBusinessId}
            businessTimezone={businessTimezone}
          />
        ) : null}
      </div>
    );
  };

  if (isModal) {
    return (
      <>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            maxHeight: '100%',
            minHeight: 0,
            minWidth: 0,
            background: '#f9fafb',
            overflow: 'hidden',
            boxSizing: 'border-box',
          }}
        >
          {renderHeader()}
          {!loading && booking ? renderApprovalBanner() : null}
          {!loading && booking ? renderTabBar() : null}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              display: 'flex',
              flexDirection: isCompactLayout ? 'column' : 'row',
              // Compact: one scrollable column (content + actions) so nothing is clipped off-screen.
              // Wide: independent panes, each can scroll inside the fixed modal height.
              overflow: isCompactLayout ? 'auto' : 'hidden',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <div
              style={{
                flex: isCompactLayout ? '0 0 auto' : 1,
                minHeight: isCompactLayout ? undefined : 0,
                minWidth: 0,
                overflowY: isCompactLayout ? 'visible' : 'auto',
                padding: isCompactLayout ? '16px' : '20px',
                boxSizing: 'border-box',
              }}
            >
              {renderBody()}
            </div>
            {!loading && booking ? renderSidebar() : null}
          </div>
        </div>
        <BookingResourceAssignmentModal
          open={showResourceAssignmentModal}
          onClose={() => setShowResourceAssignmentModal(false)}
          categoryName={primaryResourceCategory?.categoryName || 'Room'}
          resourceOptions={resourceSelectOptions}
          currentResourceIds={currentAssignedResourceIds}
          scheduledResourceIds={scheduledResourceIds}
          scheduledResourceNames={scheduledResourceNames}
          saving={savingRoom}
          onConfirm={(resourceIds) => {
            if (primaryResourceCategory?.categoryId) {
              handleSaveResourceAssignments(primaryResourceCategory.categoryId, resourceIds);
            }
          }}
        />
        <BookingPrintModal
          open={showPrintModal}
          onClose={() => setShowPrintModal(false)}
          businessId={auth.selectedBusinessId}
          loading={printDataLoading}
          onPrint={handleExecuteBookingPrint}
        />
        <BookingApprovalActionModal
          open={showApproveConfirmModal}
          mode="approve"
          booking={booking}
          businessTimezone={businessTimezone}
          loading={approving}
          onClose={() => { if (!approving) setShowApproveConfirmModal(false); }}
          onConfirm={handleApproveBookingRequest}
        />
        <BookingApprovalActionModal
          open={showRevokeApprovalModal}
          mode="revoke"
          booking={booking}
          businessTimezone={businessTimezone}
          loading={revokingApproval}
          blockedReason={revokeBookingApprovalBlockedReason(booking)}
          onClose={() => { if (!revokingApproval) setShowRevokeApprovalModal(false); }}
          onConfirm={handleRevokeBookingApproval}
        />
        <BookingCancelActionModal
          open={showCancelModal}
          booking={booking}
          businessTimezone={businessTimezone}
          loading={cancelling}
          onClose={() => { if (!cancelling) setShowCancelModal(false); }}
          onConfirm={handleConfirmCancelBooking}
        />
        <BookingExtendTimeModal
          open={showExtendTimeModal}
          booking={booking}
          businessTimezone={businessTimezone}
          extensionPricing={extensionPricingSettings}
          dayBookings={dayBookingsWithResources}
          resources={resources}
          resourcePaddingById={resourcePaddingById}
          resourceQuantityById={resourceQuantityById}
          checkingAvailability={dayResourceBookingsLoading}
          loading={extending}
          onClose={() => { if (!extending) setShowExtendTimeModal(false); }}
          onConfirm={handleConfirmExtendBooking}
        />
        <BookingPricingBreakdownModal
          open={showPricingBreakdownModal}
          booking={booking}
          pricing={bookingPricing}
          requiredDepositAmount={requiredDepositAmount}
          onClose={() => setShowPricingBreakdownModal(false)}
        />
        <BookingBusinessHoursOverrideModal
          open={hoursOverrideModal.open}
          reason={hoursOverrideModal.reason}
          onCancel={() => setHoursOverrideModal({ open: false, reason: '' })}
          onApproved={handleHoursOverrideApproved}
        />

      </>
    );
  }

  return (
    <>
    <div style={{ padding: '30px', maxWidth: '1280px', margin: '0 auto' }}>
      {renderHeader()}
      {!loading && booking ? renderApprovalBanner() : null}
      {!loading && booking ? renderTabBar() : null}
      <div
        style={{
          display: 'flex',
          flexDirection: isCompactLayout ? 'column' : 'row',
          gap: isCompactLayout ? '0' : '0',
          alignItems: 'stretch',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>{renderBody()}</div>
        {!loading && booking ? renderSidebar() : null}
      </div>
    </div>
    <BookingResourceAssignmentModal
      open={showResourceAssignmentModal}
      onClose={() => setShowResourceAssignmentModal(false)}
      categoryName={primaryResourceCategory?.categoryName || 'Room'}
      resourceOptions={resourceSelectOptions}
      currentResourceIds={currentAssignedResourceIds}
      scheduledResourceIds={scheduledResourceIds}
      scheduledResourceNames={scheduledResourceNames}
      saving={savingRoom}
      onConfirm={(resourceIds) => {
        if (primaryResourceCategory?.categoryId) {
          handleSaveResourceAssignments(primaryResourceCategory.categoryId, resourceIds);
        }
      }}
    />
    <BookingPrintModal
      open={showPrintModal}
      onClose={() => setShowPrintModal(false)}
      businessId={auth.selectedBusinessId}
      loading={printDataLoading}
      onPrint={handleExecuteBookingPrint}
    />
    <BookingApprovalActionModal
      open={showApproveConfirmModal}
      mode="approve"
      booking={booking}
      businessTimezone={businessTimezone}
      loading={approving}
      onClose={() => { if (!approving) setShowApproveConfirmModal(false); }}
      onConfirm={handleApproveBookingRequest}
    />
    <BookingApprovalActionModal
      open={showRevokeApprovalModal}
      mode="revoke"
      booking={booking}
      businessTimezone={businessTimezone}
      loading={revokingApproval}
      blockedReason={revokeBookingApprovalBlockedReason(booking)}
      onClose={() => { if (!revokingApproval) setShowRevokeApprovalModal(false); }}
      onConfirm={handleRevokeBookingApproval}
    />
    <BookingCancelActionModal
      open={showCancelModal}
      booking={booking}
      businessTimezone={businessTimezone}
      loading={cancelling}
      onClose={() => { if (!cancelling) setShowCancelModal(false); }}
      onConfirm={handleConfirmCancelBooking}
    />
    <BookingExtendTimeModal
      open={showExtendTimeModal}
      booking={booking}
      businessTimezone={businessTimezone}
      extensionPricing={extensionPricingSettings}
      dayBookings={dayBookingsWithResources}
      resources={resources}
      resourcePaddingById={resourcePaddingById}
      resourceQuantityById={resourceQuantityById}
      checkingAvailability={dayResourceBookingsLoading}
      loading={extending}
      onClose={() => { if (!extending) setShowExtendTimeModal(false); }}
      onConfirm={handleConfirmExtendBooking}
    />
    <BookingPricingBreakdownModal
      open={showPricingBreakdownModal}
      booking={booking}
      pricing={bookingPricing}
      requiredDepositAmount={requiredDepositAmount}
      onClose={() => setShowPricingBreakdownModal(false)}
    />
    <BookingBusinessHoursOverrideModal
      open={hoursOverrideModal.open}
      reason={hoursOverrideModal.reason}
      onCancel={() => setHoursOverrideModal({ open: false, reason: '' })}
      onApproved={handleHoursOverrideApproved}
    />

    </>
  );
};

export default BookingDetailPanel;
