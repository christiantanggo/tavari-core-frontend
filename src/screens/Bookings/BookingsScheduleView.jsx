// src/screens/Bookings/BookingsScheduleView.jsx
// Bookeo-style schedule view with calendar sidebar and activity schedule table
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBookingDetailModal } from '../../contexts/BookingDetailModalContext';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import bookingService from '../../services/Bookings/BookingService';
import bookingActivityService from '../../services/Bookings/BookingActivityService';
import bookingSessionService from '../../services/Bookings/BookingSessionService';
import bookingSettingsService from '../../services/Bookings/BookingSettingsService';
import bookingPaymentService from '../../services/Bookings/BookingPaymentService';
import bookingTypeService from '../../services/Bookings/BookingTypeService';
import camperRegistrationService from '../../services/Bookings/CamperRegistrationService';
import waiverOTPService from '../../services/Waivers/WaiverOTPService';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { FiChevronLeft, FiChevronRight, FiPlus, FiX, FiSearch, FiCheckCircle, FiAlertCircle, FiUsers } from 'react-icons/fi';
import toast from 'react-hot-toast';
import BookingCheckInButton from '../../components/Bookings/BookingCheckInButton';
import { formatDateForBusiness, getBusinessTimezone } from '../../utils/businessDateFormat';
import {
  resolveMultiDayDetailBookingId,
  resolveBookingParticipants,
  shouldHideFromScheduleSlot,
} from '../../helpers/Bookings/bookingMultiDay';
import {
  assignTicketsByRules,
  calculateTicketPricing,
  getActivityTicketLimits,
  hasExplicitTicketAssignmentRules,
  parseAgeRestriction,
  participantMatchesAgeRestriction,
  validateParticipantCountAgainstTicketLimits,
  resolveTicketInventoryItemIds,
  collectRelatedFwpFreeItemIds,
} from '../../utils/bookingTicketAssignment';
import {
  buildEffectiveTicketPriceOverrides,
  resolveApplicableBookingPromotion,
} from '../../utils/bookingPricingPromotions';
import {
  parseOnlinePaymentSettings,
  calculateOnlineCheckoutAmounts,
} from '../../utils/bookingPaymentSettings';
import { getParticipantDisplayName, getBookingAdultDisplayName, areDistinctParticipantWaiversVerified } from '../../helpers/Bookings/participantIdentity';
import {
  bookingMatchesScheduleSearch,
  parseScheduleSearchDate,
} from '../../helpers/Bookings/bookingScheduleSearch';
import SecurityUtils from '../../Security/SecurityUtils';
import StaffBookingTicketLimitsPanel from '../../components/Bookings/StaffBookingTicketLimitsPanel';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { appendHelcimPayIframeCompat } from '../../helpers/helcimPayIframe';
import BookingTimeSlotSelect from '../../components/Bookings/BookingTimeSlotSelect';
import ScheduleNewBookingCustomerFields from '../../components/Bookings/ScheduleNewBookingCustomerFields';
import {
  buildFifteenMinuteTimeOptions,
  DEFAULT_OPERATING_HOURS,
  getDayKeyFromDateString
} from '../../helpers/Bookings/operatingHoursTimeOptions';
import { flattenScheduleResourceAssignments } from '../../utils/bookingTimeRange';
import {
  checkBookingBusinessHours,
  approveBusinessHoursOverride,
} from '../../helpers/Bookings/businessHoursOverrideFlow';
import BookingBusinessHoursOverrideModal from '../../components/Bookings/BookingBusinessHoursOverrideModal';
import BookingCategoryCapacityOverrideModal from '../../components/Bookings/BookingCategoryCapacityOverrideModal';
import {
  approveCategoryCapacityOverride,
  effectiveSpacesLeftFromCapacityContext,
  estimateBookingCapacityUnits,
  fetchEffectiveSlotCapacity,
  validateCategoryCapacity,
} from '../../helpers/Bookings/bookingCategoryCapacity';
import {
  activityCountsParticipantsByType,
  bookingOccupancyUnits,
  normalizeBookingScheduleTime,
} from '../../helpers/Bookings/bookingActivityScheduleHelpers';
import {
  ACTIVE_BOOKING_STATUSES_FOR_RESOURCE,
  areRequiredResourcesAvailableForSlot,
  listScheduleResourceRequirements,
} from '../../helpers/Bookings/bookingResourceAvailability';
import { isMultiDayScheduleRow, resolveMultiDaySeriesDayCountForDate } from '../../helpers/Bookings/bookingMultiDaySchedule';
import { parseMultiDaySettings } from '../../helpers/Bookings/bookingMultiDay';
import {
  fetchPortalSlotOccupancy,
  resolvePortalSlotOccupancyCount,
} from '../../helpers/Bookings/bookingSlotHold';

dayjs.extend(utc);
dayjs.extend(timezone);

/** Bookable capacity for a schedule row; 0 = blocked but still shown on the calendar. */
const scheduleSlotTotalSpaces = (schedule) => {
  if (schedule == null) return 1;
  const s = schedule.spaces;
  if (s == null) return 1;
  const n = Number(s);
  return Number.isFinite(n) ? n : 1;
};

const BLOCKED_SEAT_RING = '#ef4444';
const PIE_EMPTY_COLOR = '#e5e7eb';

/**
 * Pie is drawn against nominal_max_spaces when set (e.g. 20 seats),
 * with booked arc (primary) then blocked arc (red). Blocked = nominal - current spaces.
 */
const getScheduleSlotRingMetrics = (schedule, bookedCount) => {
  const S = scheduleSlotTotalSpaces(schedule);
  const nRaw = schedule?.nominal_max_spaces;
  const N =
    nRaw != null && nRaw !== '' && Number.isFinite(Number(nRaw))
      ? Math.max(0, Number(nRaw))
      : null;
  const b = Math.max(0, Number(bookedCount) || 0);
  const blocked = N != null && N > 0 ? Math.max(0, N - S) : 0;
  const T = N != null && N > 0 ? N : (S > 0 ? S : b > 0 ? b : 1);
  const available = Math.max(0, S - b);
  const bookedDeg = T > 0 ? (b / T) * 360 : 0;
  const blockedDeg = T > 0 && blocked > 0 ? (blocked / T) * 360 : 0;
  return {
    S,
    N,
    T,
    blocked,
    available,
    booked: b,
    bookedDeg,
    blockedDeg
  };
};

/** Filled pie background: booked (primary), blocked (red), remainder (light gray). */
const buildScheduleSlotPieBackground = (ring, primaryColor) => {
  const { T: ringTotal, bookedDeg, blockedDeg } = ring;
  if (ringTotal <= 0) return null;

  if (bookedDeg < 0.1 && blockedDeg < 0.1) {
    return PIE_EMPTY_COLOR;
  }

  const segments = [];
  let cursor = 0;

  if (bookedDeg >= 0.1) {
    segments.push(`${primaryColor} ${cursor}deg ${cursor + bookedDeg}deg`);
    cursor += bookedDeg;
  }
  if (blockedDeg >= 0.1) {
    segments.push(`${BLOCKED_SEAT_RING} ${cursor}deg ${cursor + blockedDeg}deg`);
    cursor += blockedDeg;
  }
  if (cursor < 360) {
    segments.push(`${PIE_EMPTY_COLOR} ${cursor}deg 360deg`);
  }

  return `conic-gradient(${segments.join(', ')})`;
};

/** Soft row tint matching the pie’s booked/blocked colors. */
const hexToRgba = (hex, alpha) => {
  const raw = String(hex || '').replace('#', '').trim();
  if (raw.length !== 6 || Number.isNaN(Number.parseInt(raw, 16))) return null;
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const buildScheduleSlotRowBackground = ({
  booked = 0,
  blockedSeats = 0,
  total = 1,
  ringTotal = 1,
  primaryColor,
  roomBlocked = false,
}) => {
  if (total === 0) return '#f3f4f6';
  const b = Math.max(0, Number(booked) || 0);
  const blocked = Math.max(0, Number(blockedSeats) || 0);
  if (roomBlocked && b <= 0) {
    return hexToRgba(BLOCKED_SEAT_RING, 0.1) || 'rgba(239, 68, 68, 0.1)';
  }
  if (b <= 0 && blocked <= 0) return 'white';

  const fillBase = Math.max(1, Number(ringTotal) || 1);
  const fill = Math.min(1, (b + blocked) / fillBase);
  const alpha = 0.07 + fill * 0.14;

  if (b > 0) {
    return hexToRgba(primaryColor, alpha) || 'rgba(37, 99, 235, 0.1)';
  }
  return hexToRgba(BLOCKED_SEAT_RING, Math.min(0.16, alpha)) || 'rgba(239, 68, 68, 0.08)';
};

/** Readable booking status for badges (not raw DB strings like checked_in). */
function formatBookingStatusLabel(status) {
  const key = String(status ?? '').trim().toLowerCase();
  const labels = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    checked_in: 'Checked in',
    cancelled: 'Cancelled',
    canceled: 'Cancelled',
    completed: 'Completed',
    no_show: 'No-show',
    rescheduled: 'Rescheduled'
  };
  if (labels[key]) return labels[key];
  if (!key) return '—';
  return key.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function sumCompletedBookingPayments(booking) {
  const payments = booking.booking_payments || [];
  return payments
    .filter((p) => p.status === 'completed')
    .reduce((s, p) => s + (Number(p.amount_paid) || 0), 0);
}

function sumBookingAddonTotals(booking) {
  return (booking.booking_addon_items || []).reduce((s, i) => s + (Number(i.total_price) || 0), 0);
}

/** Total price / paid / due for slot modal summary (uses DB columns when present). */
function getSlotModalPricing(booking) {
  const totalPaid = sumCompletedBookingPayments(booking);
  const addonTotal = sumBookingAddonTotals(booking);
  const explicit = Number(booking.total_amount);
  let totalPrice;
  if (Number.isFinite(explicit) && explicit > 0) {
    totalPrice = explicit;
  } else if (addonTotal > 0) {
    totalPrice = addonTotal;
  } else if (totalPaid > 0) {
    totalPrice = totalPaid;
  } else {
    totalPrice = 0;
  }
  const totalDue = Math.max(0, Math.round((totalPrice - totalPaid) * 100) / 100);
  const paymentComplete = booking.payment_status === 'paid' || totalDue < 0.005;
  return { totalPrice, totalPaid, totalDue, paymentComplete };
}

function getSlotModalWaiverState(booking) {
  const requiresWaiver =
    Boolean(booking.booking_activities?.requires_waiver) ||
    Boolean(booking.booking_types?.requires_waiver);
  const participants = booking.booking_participants || [];
  if (!requiresWaiver) {
    return { requiresWaiver: false, waiversVerified: true };
  }
  if (participants.length === 0) {
    return { requiresWaiver: true, waiversVerified: false };
  }
  const waiversVerified = areDistinctParticipantWaiversVerified(participants);
  return { requiresWaiver: true, waiversVerified };
}

function getSlotModalCamperRegistrationState(booking) {
  const requiresCamperRegistration =
    Boolean(booking.booking_activities?.requires_camper_registration) ||
    Boolean(booking.booking_types?.requires_camper_registration);
  const participants = booking.booking_participants || [];
  if (!requiresCamperRegistration) {
    return { requiresCamperRegistration: false, registrationsVerified: true };
  }
  const campers = participants.filter((p) =>
    camperRegistrationService.participantRequiresCamperRegistration(p, true)
  );
  if (campers.length === 0) {
    return { requiresCamperRegistration: true, registrationsVerified: true };
  }
  const registrationsVerified = campers.every((p) => p.camper_registration_status === 'valid');
  return { requiresCamperRegistration: true, registrationsVerified };
}

function customerDisplayNameForSlotModal(booking) {
  return getBookingAdultDisplayName(booking);
}

/** Resolved ticket label from embedded pos_inventory (BookingService join). */
function participantTicketDisplayName(p) {
  const inv = p?.pos_inventory;
  if (inv && typeof inv === 'object' && !Array.isArray(inv)) {
    const n = String(inv.name || '').trim();
    if (n) return n;
  }
  const legacy = String(p?.ticket_type || '').trim();
  if (legacy) return legacy;
  if (p?.inventory_item_id) return 'Ticket';
  return 'Guest';
}

/** e.g. "Adult x1, Child x2" or named guests when ticket type is generic Guest. */
function formatGuestTicketLine(booking) {
  const participants = booking.booking_participants || [];
  if (participants.length === 0) return '—';
  const order = [];
  const counts = new Map();
  for (let i = 0; i < participants.length; i++) {
    const p = participants[i];
    let label = participantTicketDisplayName(p);
    if (!label || label === 'Guest') {
      const name = getParticipantDisplayName(p, i);
      if (name && !/^Guest \d+$/i.test(name)) label = name;
    }
    if (!counts.has(label)) {
      order.push(label);
      counts.set(label, 0);
    }
    counts.set(label, counts.get(label) + 1);
  }
  return order.map((label) => `${label} x${counts.get(label)}`).join(', ');
}

function bookingForParticipantDisplay(booking, parentBookingsById) {
  const participants = resolveBookingParticipants(booking, parentBookingsById);
  if (participants === (booking?.booking_participants || [])) return booking;
  return { ...booking, booking_participants: participants };
}

const HELCIM_PAY_SCRIPT_URL = 'https://secure.helcim.app/helcim-pay/services/start.js';

const BookingsScheduleView = () => {
  const createEmptyAdditionalItem = () => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    description: '',
    quantity: '1',
    unitPrice: '',
    taxRateIds: []
  });

  const navigate = useNavigate();
  const { openBookingDetail } = useBookingDetailModal();
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1440
  );
  const isCompactModalLayout = viewportWidth <= 960;
  const bookingModalWidth = isCompactModalLayout
    ? 'min(100%, 720px)'
    : 'min(1120px, calc(100vw - 48px))';
  const bookingModalHeight = viewportWidth <= 768
    ? 'min(760px, calc(100vh - 24px))'
    : 'min(820px, calc(100vh - 40px))';
  const bookingModalContentMaxWidth = '100%';
  const bookingModalActionColumnWidth = isCompactModalLayout ? '100%' : '220px';
  const bookingModalTwoColumnGrid = viewportWidth <= 768
    ? '1fr'
    : 'repeat(2, minmax(0, 1fr))';
  const bookingAdditionalItemGridColumns = viewportWidth <= 768
    ? '1fr'
    : viewportWidth <= 1180
      ? 'repeat(2, minmax(0, 1fr))'
      : 'minmax(260px, 2fr) minmax(120px, 0.8fr) minmax(160px, 1fr) auto';
  const bookingAdditionalItemTaxGridColumns = viewportWidth <= 768
    ? '1fr'
    : viewportWidth <= 1180
      ? 'repeat(2, minmax(0, 1fr))'
      : 'repeat(3, minmax(0, 1fr))';

  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'BookingsScheduleView'
  });

  const { logSecurityEvent } = useSecurityContext({
    componentName: 'BookingsScheduleView',
    sensitiveComponent: false,
    enableAuditLogging: true,
    securityLevel: 'low'
  });

  const {
    hasAnyPermission,
    hasElevatedPrivileges,
    hasPermission,
    isOwner,
    isManager,
    isLoggedInUserManager,
    hasLoggedInUserElevatedPrivileges,
  } = usePermissions();
  const canViewBookings = hasAnyPermission(['bookings.view', 'bookings.calendar.view']) || hasElevatedPrivileges();
  const canCheckIn = hasPermission('bookings.checkin') || hasElevatedPrivileges();
  const canCreateBookings = hasPermission('bookings.create') || hasElevatedPrivileges();
  const canOverrideTicketLimits =
    isOwner() ||
    isManager() ||
    hasElevatedPrivileges() ||
    isLoggedInUserManager() ||
    hasLoggedInUserElevatedPrivileges();

  const [loading, setLoading] = useState(true);
  // Initialize dates in business timezone (will be updated when timezone loads)
  const [selectedDate, setSelectedDate] = useState(() => {
    // Default to today, will be adjusted when timezone loads
    return new Date();
  });
  const [calendarViewDate, setCalendarViewDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState('rows'); // 'rows' or 'boxes'
  const [dayRange, setDayRange] = useState(1); // 1, 3, 7, 14 days
  const [selectedActivities, setSelectedActivities] = useState([]); // Array of activity IDs
  const [activities, setActivities] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [bookings, setBookings] = useState([]);
  /** Authoritative camper/participant counts per activity+date from booking_get_portal_slot_occupancy. */
  const [slotOccupancyByKey, setSlotOccupancyByKey] = useState({});
  const [showCanceled, setShowCanceled] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const calendarPopoverRef = useRef(null);
  const scheduleDayHeaderRef = useRef(null);
  const [scheduleDayHeaderHeight, setScheduleDayHeaderHeight] = useState(44);
  const [businessTimezone, setBusinessTimezone] = useState('America/Toronto');
  const [operatingHours, setOperatingHours] = useState(DEFAULT_OPERATING_HOURS);
  const calendarButtonRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null); // { date, time }
  const [isTimeSlotModalOpen, setIsTimeSlotModalOpen] = useState(false);
  /** Booking selected from the time-slot list to open the participant check-in layer. */
  const [activitySchedules, setActivitySchedules] = useState({}); // { activityId: { dayOfWeek: [schedules] } }
  const [resources, setResources] = useState([]); // Resource categories and items
  const [bookingTypes, setBookingTypes] = useState([]);
  const [showAddBookingModal, setShowAddBookingModal] = useState(false);
  const [selectedActivityForBooking, setSelectedActivityForBooking] = useState(null); // { activity, date, time }
  const [slotEditorTime, setSlotEditorTime] = useState('');
  const [slotEditorSpaces, setSlotEditorSpaces] = useState('1');
  const [slotEditorSaving, setSlotEditorSaving] = useState(false);
  const [slotEditorInitial, setSlotEditorInitial] = useState({ time: '', spaces: '1' });
  const [slotModalMode, setSlotModalMode] = useState('details');
  const [slotEmailType, setSlotEmailType] = useState('confirmation');
  const [slotEmailSelectedIds, setSlotEmailSelectedIds] = useState(() => new Set());
  const [slotEmailSending, setSlotEmailSending] = useState(false);
  const [blockSeatsModalOpen, setBlockSeatsModalOpen] = useState(false);
  const [blockPartialSeatsCount, setBlockPartialSeatsCount] = useState('1');
  const [newBookingTab, setNewBookingTab] = useState('customer');
  const [newBookingData, setNewBookingData] = useState({
    customerId: null,
    customerFirstName: '',
    customerLastName: '',
    bookingTypeId: '',
    bookingDate: '',
    bookingTime: '',
    customerEmail: '',
    customerPhone: '',
    notes: '',
    paymentStatus: 'unpaid'
  });
  const [newBookingSubmitting, setNewBookingSubmitting] = useState(false);
  const [hoursOverrideModal, setHoursOverrideModal] = useState({ open: false, reason: '' });
  const [categoryCapacityOverrideModal, setCategoryCapacityOverrideModal] = useState({ open: false, reason: '' });
  const categoryCapacityOverrideIdRef = useRef(null);
  const [effectiveCapacityByKey, setEffectiveCapacityByKey] = useState({});
  const [newBookingCalendarOpen, setNewBookingCalendarOpen] = useState(false);
  const [newBookingCalendarMonth, setNewBookingCalendarMonth] = useState(() => new Date());
  const [bookingItemTaxRates, setBookingItemTaxRates] = useState([]);
  const [bookingAdditionalItems, setBookingAdditionalItems] = useState([]);
  const [scheduleTicketInventoryItems, setScheduleTicketInventoryItems] = useState([]);
  const [scheduleLegacyPromotions, setScheduleLegacyPromotions] = useState([]);
  const [schedulePricingPromotions, setSchedulePricingPromotions] = useState([]);
  const [storedHelcimCard, setStoredHelcimCard] = useState(null);
  const [storedHelcimCardLoading, setStoredHelcimCardLoading] = useState(false);
  const [helcimCardSaving, setHelcimCardSaving] = useState(false);
  const [customerSuggestions, setCustomerSuggestions] = useState([]);
  const [customerLookupLoading, setCustomerLookupLoading] = useState(false);
  const [linkedParticipants, setLinkedParticipants] = useState([]);
  const [selectedParticipantKeys, setSelectedParticipantKeys] = useState([]);
  const [manualParticipants, setManualParticipants] = useState([]);
  const [participantTicketByKey, setParticipantTicketByKey] = useState({});
  const [staffTicketLimitOverride, setStaffTicketLimitOverride] = useState(false);
  const [customerFieldsSyncVersion, setCustomerFieldsSyncVersion] = useState(0);
  const customerFieldsLiveRef = useRef({
    customerFirstName: '',
    customerLastName: '',
    customerEmail: '',
    customerPhone: '',
  });
  const helcimPayRef = useRef({ checkoutToken: null, customerId: null });
  const helcimPaymentFinalizedRef = useRef(false);
  const helcimPayMessageHandlerRef = useRef(null);
  const taxCalc = useTaxCalculations(auth.selectedBusinessId);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!selectedActivityForBooking) {
      setSlotEditorTime('');
      setSlotEditorSpaces('1');
      setSlotEditorInitial({ time: '', spaces: '1' });
      setSlotModalMode('details');
      setNewBookingTab('customer');
      setNewBookingData({
        customerId: null,
        customerFirstName: '',
        customerLastName: '',
        bookingTypeId: '',
        bookingDate: '',
        bookingTime: '',
        customerEmail: '',
        customerPhone: '',
        notes: '',
        paymentStatus: 'unpaid'
      });
      setNewBookingCalendarOpen(false);
      setNewBookingCalendarMonth(new Date());
      setBookingAdditionalItems([]);
      setScheduleTicketInventoryItems([]);
      setScheduleLegacyPromotions([]);
      setSchedulePricingPromotions([]);
      setStoredHelcimCard(null);
      setStoredHelcimCardLoading(false);
      setHelcimCardSaving(false);
      setCustomerFieldsSyncVersion((version) => version + 1);
      helcimPayRef.current = { checkoutToken: null, customerId: null };
      helcimPaymentFinalizedRef.current = false;
      setCustomerSuggestions([]);
      setLinkedParticipants([]);
      setSelectedParticipantKeys([]);
      setManualParticipants([]);
      setParticipantTicketByKey({});
      setBlockSeatsModalOpen(false);
      setBlockPartialSeatsCount('1');
      return;
    }

    const initialTime = normalizeTime(selectedActivityForBooking.time || '');
    const initialSpaces = String(
      selectedActivityForBooking.spaces != null
        ? selectedActivityForBooking.spaces
        : 1
    );
    const initialBookingTypeId =
      selectedActivityForBooking.activity?.type_id ||
      selectedActivityForBooking.activity?.booking_types?.id ||
      '';
    setSlotEditorTime(initialTime);
    setSlotEditorSpaces(initialSpaces);
    setSlotEditorInitial({ time: initialTime, spaces: initialSpaces });
    setSlotModalMode('details');
    const initialBookingDate = dayjs(selectedActivityForBooking.date).tz(businessTimezone).format('YYYY-MM-DD');
    const initialBookingMonth = dayjs(selectedActivityForBooking.date).tz(businessTimezone).toDate();
    setNewBookingTab('customer');
    setNewBookingData({
      customerId: null,
      customerFirstName: '',
      customerLastName: '',
      bookingTypeId: initialBookingTypeId,
      bookingDate: initialBookingDate,
      bookingTime: initialTime,
      customerEmail: '',
      customerPhone: '',
      notes: '',
      paymentStatus: 'unpaid'
    });
    setNewBookingCalendarOpen(false);
    setNewBookingCalendarMonth(initialBookingMonth);
    setBookingAdditionalItems([]);
    setScheduleTicketInventoryItems([]);
    setScheduleLegacyPromotions([]);
    setStoredHelcimCard(null);
    setStoredHelcimCardLoading(false);
    setHelcimCardSaving(false);
    helcimPayRef.current = { checkoutToken: null, customerId: null };
    helcimPaymentFinalizedRef.current = false;
    setCustomerSuggestions([]);
    setLinkedParticipants([]);
    setSelectedParticipantKeys([]);
    setManualParticipants([]);
    setParticipantTicketByKey({});
  }, [selectedActivityForBooking, businessTimezone]);

  useEffect(() => {
    if (auth.selectedBusinessId && canViewBookings) {
      bookingService.setBusinessId(auth.selectedBusinessId);
      bookingActivityService.setBusinessId(auth.selectedBusinessId);
      bookingSessionService.setBusinessId(auth.selectedBusinessId);
      bookingSettingsService.setBusinessId(auth.selectedBusinessId);
      bookingTypeService.setBusinessId(auth.selectedBusinessId);
      loadBusinessTimezone();
      loadData();
      loadActivitySchedules();
      loadResources();
      loadBookingTypes();
      loadBookingItemTaxRates();
    }
  }, [auth.selectedBusinessId, canViewBookings, selectedDate, dayRange]);

  // When search looks like a date, jump the schedule so that day is in view.
  useEffect(() => {
    const parsed = parseScheduleSearchDate(searchQuery);
    if (!parsed) return;

    const rangeStart = dayjs(selectedDate).tz(businessTimezone).format('YYYY-MM-DD');
    const rangeEnd = dayjs(selectedDate)
      .tz(businessTimezone)
      .add(Math.max(0, dayRange - 1), 'day')
      .format('YYYY-MM-DD');
    if (parsed >= rangeStart && parsed <= rangeEnd) return;

    const nextDate = dayjs.tz(parsed, businessTimezone);
    if (!nextDate.isValid()) return;
    setSelectedDate(nextDate.toDate());
    setCalendarViewDate(nextDate.toDate());
  }, [searchQuery, businessTimezone, dayRange]);

  // Keep column headers stuck just under the day label ("Today") while the list scrolls.
  useEffect(() => {
    const el = scheduleDayHeaderRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;

    const update = () => {
      const next = Math.ceil(el.getBoundingClientRect().height);
      if (next > 0) setScheduleDayHeaderHeight(next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [dayRange, selectedDate]);

  // Load business timezone
  const loadBusinessTimezone = async () => {
    if (!auth.selectedBusinessId) return;
    try {
      const { data, error } = await supabase
        .from('businesses')
        .select('timezone, operating_hours')
        .eq('id', auth.selectedBusinessId)
        .single();
      
      if (!error && data?.timezone) {
        setBusinessTimezone(data.timezone);
      } else {
        setBusinessTimezone('America/Toronto'); // Default
      }
      if (!error && data?.operating_hours && typeof data.operating_hours === 'object') {
        setOperatingHours(data.operating_hours);
      } else {
        setOperatingHours(DEFAULT_OPERATING_HOURS);
      }
    } catch (error) {
      console.error('Error loading business timezone:', error);
      setBusinessTimezone('America/Toronto'); // Default
      setOperatingHours(DEFAULT_OPERATING_HOURS);
    }
  };

  useEffect(() => {
    if (!isCalendarOpen) return;

    const handleClickOutside = (event) => {
      const popoverEl = calendarPopoverRef.current;
      const buttonEl = calendarButtonRef.current;
      if (!popoverEl || !buttonEl) return;
      if (popoverEl.contains(event.target) || buttonEl.contains(event.target)) return;
      setIsCalendarOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isCalendarOpen]);

  useEffect(() => {
    // Keep calendar view in sync with selection (when closed).
    if (!isCalendarOpen) {
      setCalendarViewDate(selectedDate);
    }
  }, [selectedDate, isCalendarOpen]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Load activities
      const activitiesData = await bookingActivityService.getActivities({ activeOnly: true });
      setActivities(activitiesData);
      
      const activityIds = selectedActivities.length > 0
        ? selectedActivities
        : activitiesData.map(a => a.id);

      // If no activities selected, select all
      if (selectedActivities.length === 0 && activityIds.length > 0) {
        setSelectedActivities(activityIds);
      }

      // Calculate date range
      const startDate = new Date(selectedDate);
      const endDate = new Date(selectedDate);
      endDate.setDate(endDate.getDate() + dayRange - 1);

      // Load bookings for date range
      const bookingsData = await bookingService.getBookingsByDateRange(
        dayjs(startDate).tz(businessTimezone).format('YYYY-MM-DD'),
        dayjs(endDate).tz(businessTimezone).format('YYYY-MM-DD')
      );
      setBookings(bookingsData);

      const occupancyMap = {};
      if (auth.selectedBusinessId && activitiesData.length > 0) {
        const dateKeys = [];
        for (let offset = 0; offset < dayRange; offset += 1) {
          dateKeys.push(
            dayjs(startDate).tz(businessTimezone).add(offset, 'day').format('YYYY-MM-DD'),
          );
        }
        const participantActivities = activitiesData.filter((activity) =>
          activityCountsParticipantsByType(activity?.booking_types?.type_key),
        );
        const occupancyEntries = await Promise.all(
          participantActivities.flatMap((activity) =>
            dateKeys.map(async (dateStr) => {
              const occ = await fetchPortalSlotOccupancy({
                businessId: auth.selectedBusinessId,
                activityId: activity.id,
                bookingDate: dateStr,
              });
              return [`${activity.id}|${dateStr}`, occ];
            }),
          ),
        );
        occupancyEntries.forEach(([key, occ]) => {
          occupancyMap[key] = occ;
        });
      }
      setSlotOccupancyByKey(occupancyMap);

      // Load sessions for selected activities and date range
      if (activityIds.length > 0) {
        const sessionsPromises = activityIds.map(activityId =>
          bookingSessionService.getSessions(
            activityId,
            dayjs(startDate).tz(businessTimezone).format('YYYY-MM-DD'),
            dayjs(endDate).tz(businessTimezone).format('YYYY-MM-DD')
          )
        );
        const sessionsData = await Promise.all(sessionsPromises);
        setSessions(sessionsData.flat());
      }
    } catch (error) {
      console.error('Error loading schedule data:', error);
      toast.error('Error loading schedule');
    } finally {
      setLoading(false);
    }
  };

  // Reload schedules when activities change
  useEffect(() => {
    if (activities.length > 0 && auth.selectedBusinessId) {
      loadActivitySchedules();
    }
  }, [activities.length, auth.selectedBusinessId]);

  const loadActivitySchedules = async () => {
    try {
      if (!auth.selectedBusinessId || activities.length === 0) return;

      const activityIds = activities.map(a => a.id);
      if (activityIds.length === 0) return;

      const { data: schedules, error } = await supabase
        .from('booking_activity_schedules')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .in('activity_id', activityIds)
        .eq('is_active', true);

      if (error) {
        if (error.code === '42P01') {
          // Table doesn't exist yet
          console.warn('booking_activity_schedules table does not exist');
          setActivitySchedules({});
          return;
        }
        throw error;
      }

      // Organize schedules by activity and day of week
      const schedulesByActivity = {};
      (schedules || []).forEach(schedule => {
        if (!schedulesByActivity[schedule.activity_id]) {
          schedulesByActivity[schedule.activity_id] = {};
        }
        if (!schedulesByActivity[schedule.activity_id][schedule.day_of_week]) {
          schedulesByActivity[schedule.activity_id][schedule.day_of_week] = [];
        }
        schedulesByActivity[schedule.activity_id][schedule.day_of_week].push(schedule);
      });

      setActivitySchedules(schedulesByActivity);
    } catch (error) {
      console.error('Error loading activity schedules:', error);
      setActivitySchedules({});
    }
  };

  const loadResources = async () => {
    try {
      if (!auth.selectedBusinessId) return;
      const resourcesData = await bookingSettingsService.getBookingResources();
      setResources(resourcesData || []);
    } catch (error) {
      console.error('Error loading resources:', error);
      setResources([]);
    }
  };

  const loadBookingTypes = async () => {
    try {
      if (!auth.selectedBusinessId) return;
      const types = await bookingTypeService.getBookingTypes(true);
      setBookingTypes(types || []);
    } catch (error) {
      console.error('Error loading booking types:', error);
      setBookingTypes([]);
    }
  };

  const loadBookingItemTaxRates = async () => {
    try {
      if (!auth.selectedBusinessId) return;
      const { data, error } = await supabase
        .from('pos_tax_categories')
        .select('id, name, rate, category_type, is_active')
        .eq('business_id', auth.selectedBusinessId)
        .eq('is_active', true)
        .eq('category_type', 'tax')
        .order('name', { ascending: true });

      if (error) throw error;
      setBookingItemTaxRates(data || []);
    } catch (error) {
      console.error('Error loading booking item tax rates:', error);
      setBookingItemTaxRates([]);
    }
  };

  const loadScheduleTicketInventoryItems = async (activityRecord) => {
    if (!auth.selectedBusinessId || !activityRecord?.ticket_settings) {
      setScheduleTicketInventoryItems([]);
      setScheduleLegacyPromotions([]);
      setSchedulePricingPromotions([]);
      return [];
    }

    try {
      const ticketSettings = typeof activityRecord.ticket_settings === 'string'
        ? JSON.parse(activityRecord.ticket_settings)
        : (activityRecord.ticket_settings || {});
      let inventoryItemIds = resolveTicketInventoryItemIds(ticketSettings);

      if (inventoryItemIds.length === 0) {
        setScheduleTicketInventoryItems([]);
        setScheduleLegacyPromotions([]);
        setSchedulePricingPromotions([]);
        return [];
      }

      const [{ data: promotions, error: promotionsError }, { data: pricingPromotions, error: pricingPromotionsError }] = await Promise.all([
        supabase
          .from('pos_free_with_purchase_promotions')
          .select('id, business_id, quantity, free_item_id, trigger_item_ids')
          .eq('business_id', auth.selectedBusinessId),
        supabase
          .from('booking_pricing_promotions')
          .select('*')
          .eq('business_id', auth.selectedBusinessId)
          .eq('is_active', true)
          .order('priority', { ascending: false }),
      ]);

      if (promotionsError) {
        console.error('Error loading schedule ticket promotions:', promotionsError);
      }
      if (pricingPromotionsError) {
        console.error('Error loading schedule pricing promotions:', pricingPromotionsError);
      }

      // Staff must be able to assign FWP free tickets (e.g. free infant) even if
      // those SKUs were omitted from the activity inventory list.
      inventoryItemIds = resolveTicketInventoryItemIds(ticketSettings, {
        extraInventoryItemIds: collectRelatedFwpFreeItemIds(inventoryItemIds, promotions || []),
      });

      const { data: inventoryItems, error: inventoryError } = await supabase
        .from('pos_inventory')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .eq('is_active', true)
        .in('id', inventoryItemIds)
        .order('name', { ascending: true });

      if (inventoryError) throw inventoryError;

      setScheduleTicketInventoryItems(inventoryItems || []);
      setScheduleLegacyPromotions(promotions || []);
      setSchedulePricingPromotions(pricingPromotions || []);
      return inventoryItems || [];
    } catch (error) {
      console.error('Error loading schedule ticket inventory items:', error);
      setScheduleTicketInventoryItems([]);
      setScheduleLegacyPromotions([]);
      setSchedulePricingPromotions([]);
      return [];
    }
  };

  const loadHelcimPayScript = async () => {
    if (document.querySelector(`script[src="${HELCIM_PAY_SCRIPT_URL}"]`)) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = HELCIM_PAY_SCRIPT_URL;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Helcim Pay'));
      document.head.appendChild(script);
    });
  };

  const removeHelcimIframe = () => {
    const frame = document.getElementById('helcimPayIframe');
    if (frame?.parentNode) {
      frame.remove();
    }
  };

  const fetchStoredHelcimCard = async (customerId) => {
    if (!auth.selectedBusinessId || !customerId) {
      setStoredHelcimCard(null);
      return null;
    }

    try {
      setStoredHelcimCardLoading(true);
      const { data, error } = await supabase.functions.invoke('save-helcim-customer-code', {
        body: {
          action: 'getDefaultCard',
          businessId: auth.selectedBusinessId,
          customerId,
        },
      });

      if (error) {
        throw error;
      }

      setStoredHelcimCard(data?.defaultCard || null);
      return data?.defaultCard || null;
    } catch (error) {
      console.error('Error loading stored Helcim card:', error);
      setStoredHelcimCard(null);
      return null;
    } finally {
      setStoredHelcimCardLoading(false);
    }
  };

  const startHelcimCardVault = async () => {
    if (!auth.selectedBusinessId) {
      toast.error('Business context is required');
      return;
    }
    if (!newBookingData.customerId) {
      toast.error('Select a customer account before saving payment details');
      return;
    }

    try {
      setHelcimCardSaving(true);
      helcimPaymentFinalizedRef.current = false;

      const { data: initData, error: initError } = await supabase.functions.invoke('helcim-pay-init', {
        body: {
          mode: 'store_customer_card',
          amount: 0,
          businessId: auth.selectedBusinessId,
          customerId: newBookingData.customerId,
          customerCode: storedHelcimCard?.customerCode || null,
          currency: 'CAD',
          setAsDefaultPaymentMethod: true,
          hideExistingPaymentDetails: true,
        },
      });

      if (initError) {
        const msg = initError.message || initData?.error || 'Could not start Helcim payment method setup';
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      }

      const checkoutToken = initData?.checkoutToken;
      if (!checkoutToken) {
        throw new Error(initData?.error || 'No checkout token returned from Helcim');
      }

      helcimPayRef.current = { checkoutToken, customerId: newBookingData.customerId };
      await loadHelcimPayScript();
      if (typeof window.watchForExit !== 'function') {
        throw new Error('Helcim Pay script did not load');
      }
      appendHelcimPayIframeCompat(checkoutToken);
    } catch (error) {
      console.error('Error starting Helcim customer card vault:', error);
      toast.error(error?.message || 'Unable to open Helcim payment form');
      setHelcimCardSaving(false);
      helcimPayRef.current = { checkoutToken: null, customerId: null };
      helcimPaymentFinalizedRef.current = false;
    }
  };

  const splitCustomerName = (customerName) => {
    const parts = String(customerName || '').trim().split(/\s+/).filter(Boolean);
    return {
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' ') || ''
    };
  };

  const normalizeCustomerLookupValue = (value) => String(value || '').trim().toLowerCase();
  const normalizeCustomerPhone = (value) => String(value || '').replace(/\D/g, '');

  /** Safe PostgREST or-filter fragment for ilike (spaces/special chars must be quoted). */
  const buildIlikeOrFilter = (column, rawValue) => {
    const value = String(rawValue || '').trim().replace(/[%()"]/g, '');
    if (!value) return null;
    return `${column}.ilike."%${value}%"`;
  };

  const participantSelectionKey = (participant) => (
    participant?.id ||
    `${participant?.first_name || ''}-${participant?.last_name || ''}-${participant?.date_of_birth || ''}-${participant?.participant_type || ''}`
  );

  const dedupeParticipants = (rows) => {
    const byKey = new Map();
    (rows || []).forEach((participant) => {
      const key = participantSelectionKey(participant).toLowerCase();
      if (!byKey.has(key)) {
        byKey.set(key, participant);
      }
    });
    return Array.from(byKey.values());
  };

  const dedupeCustomerSuggestions = (rows) => {
    const uniqueSuggestions = [];
    (rows || []).forEach((customer) => {
      if (!customer) return;

      const resolvedCustomerId = customer?.customerId || customer?.id || null;
      const normalizedEmail = normalizeCustomerLookupValue(customer?.customer_email || customer?.waiverEmail || customer?.email);
      const normalizedPhone = normalizeCustomerPhone(customer?.customer_phone || customer?.waiverPhone || customer?.phone_number);
      const normalizedName = normalizeCustomerLookupValue(customer?.customer_name || [
        customer?.waiverFirstName || customer?.first_name || '',
        customer?.waiverLastName || customer?.last_name || ''
      ].filter(Boolean).join(' '));

      const existingIndex = uniqueSuggestions.findIndex((entry) => {
        const entryCustomerId = entry?.customerId || entry?.id || null;
        const entryEmail = normalizeCustomerLookupValue(entry?.customer_email || entry?.waiverEmail || entry?.email);
        const entryPhone = normalizeCustomerPhone(entry?.customer_phone || entry?.waiverPhone || entry?.phone_number);
        const entryName = normalizeCustomerLookupValue(entry?.customer_name || [
          entry?.waiverFirstName || entry?.first_name || '',
          entry?.waiverLastName || entry?.last_name || ''
        ].filter(Boolean).join(' '));

        if (resolvedCustomerId && entryCustomerId && String(resolvedCustomerId) === String(entryCustomerId)) {
          return true;
        }

        if (normalizedEmail && entryEmail && normalizedEmail === entryEmail) {
          return true;
        }

        if (normalizedPhone && entryPhone && normalizedPhone === entryPhone) {
          return true;
        }

        return !!normalizedName && normalizedName === entryName
          && (!!normalizedEmail ? normalizedEmail === entryEmail || !entryEmail : true)
          && (!!normalizedPhone ? normalizedPhone === entryPhone || !entryPhone : true);
      });

      if (existingIndex === -1) {
        uniqueSuggestions.push(customer);
        return;
      }

      const existing = uniqueSuggestions[existingIndex];
      const shouldReplaceExisting = !existing?.customerId && !!customer?.customerId;
      if (shouldReplaceExisting) {
        uniqueSuggestions[existingIndex] = {
          ...existing,
          ...customer
        };
      } else {
        uniqueSuggestions[existingIndex] = {
          ...customer,
          ...existing
        };
      }
    });
    return uniqueSuggestions;
  };

  const loadParticipantsForCustomer = async (customer) => {
    if (!customer?.id || !auth.selectedBusinessId) {
      setLinkedParticipants([]);
      setSelectedParticipantKeys([]);
      return;
    }

    try {
      const participants = [];

      const { data: rpcRows, error: rpcError } = await supabase.rpc('bookings_get_portal_participants', {
        p_customer_id: customer.id,
        p_business_id: auth.selectedBusinessId,
      });

      if (!rpcError && Array.isArray(rpcRows) && rpcRows.length > 0) {
        participants.push(...rpcRows);
      }

      const { data: waiverRows } = await supabase
        .from('waiver_signatures')
        .select('id, first_name, last_name, email, phone_number, date_of_birth, is_valid, expires_at, signed_at, waiver_participants(*)')
        .eq('business_id', auth.selectedBusinessId)
        .eq('customer_id', customer.id)
        .order('signed_at', { ascending: false })
        .limit(10);

      let resolvedWaiverRows = waiverRows || [];
      if (
        resolvedWaiverRows.length === 0 &&
        (customer?.customer_email || customer?.customer_phone)
      ) {
        const normalizedEmail = String(customer?.customer_email || '').trim().toLowerCase();
        const normalizedPhone = String(customer?.customer_phone || '').replace(/\D/g, '');
        const fallbackResults = [];

        if (normalizedEmail) {
          const { data: waiverRowsByEmail, error: waiverByEmailError } = await supabase
            .from('waiver_signatures')
            .select('id, first_name, last_name, email, phone_number, date_of_birth, is_valid, expires_at, signed_at, waiver_participants(*)')
            .eq('business_id', auth.selectedBusinessId)
            .eq('email', normalizedEmail)
            .order('signed_at', { ascending: false })
            .limit(10);

          if (!waiverByEmailError && Array.isArray(waiverRowsByEmail)) {
            fallbackResults.push(...waiverRowsByEmail);
          }
        }

        if (normalizedPhone) {
          const { data: waiverRowsByPhone, error: waiverByPhoneError } = await supabase
            .from('waiver_signatures')
            .select('id, first_name, last_name, email, phone_number, date_of_birth, is_valid, expires_at, signed_at, waiver_participants(*)')
            .eq('business_id', auth.selectedBusinessId)
            .eq('phone_number', normalizedPhone)
            .order('signed_at', { ascending: false })
            .limit(10);

          if (!waiverByPhoneError && Array.isArray(waiverRowsByPhone)) {
            fallbackResults.push(...waiverRowsByPhone);
          }
        }

        if (fallbackResults.length > 0) {
          resolvedWaiverRows = Array.from(new Map(fallbackResults.map((row) => [row.id, row])).values())
            .sort((a, b) => new Date(b.signed_at || 0).getTime() - new Date(a.signed_at || 0).getTime());
        }
      }

      const activeWaiver = resolvedWaiverRows.find((waiver) => waiver?.is_valid !== false) || resolvedWaiverRows[0] || null;
      if (activeWaiver) {
        participants.push({
          id: activeWaiver.id,
          waiver_id: activeWaiver.id,
          first_name: activeWaiver.first_name || '',
          last_name: activeWaiver.last_name || '',
          date_of_birth: activeWaiver.date_of_birth || null,
          email: activeWaiver.email || customer.customer_email || '',
          phone_number: activeWaiver.phone_number || customer.customer_phone || '',
          participant_type: 'primary',
          is_account_owner: true,
          is_active: true
        });
        (activeWaiver.waiver_participants || []).forEach((participant) => {
          if (participant?.participant_type === 'primary') return;
          participants.push({
            ...participant,
            is_account_owner: !!participant?.is_account_owner
          });
        });
      }

      let uniqueParticipants = dedupeParticipants(participants);
      if (uniqueParticipants.length === 0) {
        const { firstName, lastName } = splitCustomerName(customer.customer_name);
        uniqueParticipants = [{
          id: customer.id,
          first_name: firstName,
          last_name: lastName,
          date_of_birth: null,
          email: customer.customer_email || '',
          phone_number: customer.customer_phone || '',
          participant_type: 'primary',
          is_account_owner: true,
          is_active: true
        }];
      }
      uniqueParticipants.sort((a, b) => Number(!!b.is_account_owner) - Number(!!a.is_account_owner));
      setLinkedParticipants(uniqueParticipants);
      setSelectedParticipantKeys(uniqueParticipants.map((participant) => participantSelectionKey(participant)));
    } catch (error) {
      console.error('Error loading linked participants:', error);
      setLinkedParticipants([]);
      setSelectedParticipantKeys([]);
    }
  };

  useEffect(() => {
    if (slotModalMode !== 'new' || !auth.selectedBusinessId) return undefined;
    if (newBookingData.customerId) {
      setCustomerSuggestions([]);
      return undefined;
    }

    const searchName = `${newBookingData.customerFirstName} ${newBookingData.customerLastName}`.trim();
    const searchEmail = newBookingData.customerEmail.trim();
    const searchPhone = newBookingData.customerPhone.trim();
    const hasSearch = searchName || searchEmail || searchPhone;

    if (!hasSearch) {
      setCustomerSuggestions([]);
      return undefined;
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        setCustomerLookupLoading(true);
        const searchFirstName = newBookingData.customerFirstName.trim();
        const searchLastName = newBookingData.customerLastName.trim();

        let accountsQuery = supabase
          .from('pos_loyalty_accounts')
          .select('id, customer_name, customer_email, customer_phone')
          .eq('business_id', auth.selectedBusinessId)
          .limit(8);

        const accountFilters = [];
        const accountNameFilter = buildIlikeOrFilter('customer_name', searchName);
        const accountFirstFilter = buildIlikeOrFilter('customer_name', searchFirstName);
        const accountLastFilter = buildIlikeOrFilter('customer_name', searchLastName);
        const accountEmailFilter = buildIlikeOrFilter('customer_email', searchEmail);
        const accountPhoneFilter = buildIlikeOrFilter('customer_phone', searchPhone);
        if (accountNameFilter) accountFilters.push(accountNameFilter);
        if (accountFirstFilter) accountFilters.push(accountFirstFilter);
        if (accountLastFilter) accountFilters.push(accountLastFilter);
        if (accountEmailFilter) accountFilters.push(accountEmailFilter);
        if (accountPhoneFilter) accountFilters.push(accountPhoneFilter);
        if (accountFilters.length > 0) {
          accountsQuery = accountsQuery.or(accountFilters.join(','));
        }

        const [accountsResult, signatureResult, participantResult] = await Promise.all([
          accountsQuery,
          (() => {
            let query = supabase
              .from('waiver_signatures')
              .select('id, customer_id, first_name, last_name, email, phone_number')
              .eq('business_id', auth.selectedBusinessId)
              .limit(12);

            const filters = [
              buildIlikeOrFilter('first_name', searchFirstName),
              buildIlikeOrFilter('last_name', searchLastName),
              buildIlikeOrFilter('first_name', searchName),
              buildIlikeOrFilter('last_name', searchName),
              buildIlikeOrFilter('email', searchEmail),
              buildIlikeOrFilter('phone_number', searchPhone),
            ].filter(Boolean);
            if (filters.length > 0) {
              query = query.or(filters.join(','));
            }
            return query;
          })(),
          (() => {
            let query = supabase
              .from('waiver_participants')
              .select('id, waiver_id, customer_id, first_name, last_name, email, phone_number, participant_type')
              .eq('business_id', auth.selectedBusinessId)
              .limit(12);

            const filters = [
              buildIlikeOrFilter('first_name', searchFirstName),
              buildIlikeOrFilter('last_name', searchLastName),
              buildIlikeOrFilter('first_name', searchName),
              buildIlikeOrFilter('last_name', searchName),
              buildIlikeOrFilter('email', searchEmail),
              buildIlikeOrFilter('phone_number', searchPhone),
            ].filter(Boolean);
            if (filters.length > 0) {
              query = query.or(filters.join(','));
            }
            return query;
          })()
        ]);

        if (accountsResult.error) throw accountsResult.error;

        const matchedCustomerIds = Array.from(new Set([
          ...(signatureResult.data || []).map((row) => row.customer_id).filter(Boolean),
          ...(participantResult.data || []).map((row) => row.customer_id).filter(Boolean),
        ]));

        let relatedAccounts = [];
        if (matchedCustomerIds.length > 0) {
          const { data: relatedData, error: relatedError } = await supabase
            .from('pos_loyalty_accounts')
            .select('id, customer_name, customer_email, customer_phone')
            .eq('business_id', auth.selectedBusinessId)
            .in('id', matchedCustomerIds.slice(0, 20));

          if (!relatedError) {
            relatedAccounts = relatedData || [];
          }
        }

        const unresolvedPrimarySuggestions = (signatureResult.data || [])
          .filter((row) => !row.customer_id)
          .map((row) => ({
            id: `waiver-signature-${row.id}`,
            customerId: null,
            customer_name: `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email || row.phone_number || 'Waiver customer',
            customer_email: row.email || '',
            customer_phone: row.phone_number || '',
            lookupKey: `waiver-signature-${row.id}`,
            lookupSource: 'waiver_signature',
            waiverFirstName: row.first_name || '',
            waiverLastName: row.last_name || '',
            waiverEmail: row.email || '',
            waiverPhone: row.phone_number || ''
          }));

        setCustomerSuggestions(
          dedupeCustomerSuggestions([
            ...(accountsResult.data || []).map((row) => ({ ...row, customerId: row.id, lookupSource: 'customer_account' })),
            ...relatedAccounts.map((row) => ({ ...row, customerId: row.id, lookupSource: 'customer_account' })),
            ...unresolvedPrimarySuggestions
          ]).slice(0, 8)
        );
      } catch (error) {
        console.error('Error loading customer suggestions:', error);
        setCustomerSuggestions([]);
      } finally {
        setCustomerLookupLoading(false);
      }
    }, 400);

    return () => window.clearTimeout(timeoutId);
  }, [
    auth.selectedBusinessId,
    slotModalMode,
    newBookingData.customerId,
    newBookingData.customerFirstName,
    newBookingData.customerLastName,
    newBookingData.customerEmail,
    newBookingData.customerPhone
  ]);

  useEffect(() => {
    if (!auth.selectedBusinessId || !selectedActivityForBooking?.activity) {
      setScheduleTicketInventoryItems([]);
      setScheduleLegacyPromotions([]);
      setSchedulePricingPromotions([]);
      return;
    }

    loadScheduleTicketInventoryItems(selectedActivityForBooking.activity);
  }, [auth.selectedBusinessId, selectedActivityForBooking?.activity]);

  useEffect(() => {
    if (slotModalMode !== 'new' || !newBookingData.customerId) {
      setStoredHelcimCard(null);
      setStoredHelcimCardLoading(false);
      return;
    }

    fetchStoredHelcimCard(newBookingData.customerId);
  }, [slotModalMode, newBookingData.customerId, auth.selectedBusinessId]);

  useEffect(() => {
    const handler = (event) => {
      const ref = helcimPayRef.current;
      if (!ref.checkoutToken) return;

      const key = `helcim-pay-js-${ref.checkoutToken}`;
      if (event.data?.eventName !== key) return;

      const cleanup = () => {
        removeHelcimIframe();
        setHelcimCardSaving(false);
        helcimPayRef.current = { checkoutToken: null, customerId: null };
        helcimPaymentFinalizedRef.current = false;
      };

      if (event.data.eventStatus === 'SUCCESS') {
        if (helcimPaymentFinalizedRef.current) return;
        helcimPaymentFinalizedRef.current = true;

        let customerCodeFromHelcim = null;
        try {
          const parsed = typeof event.data.eventMessage === 'string'
            ? JSON.parse(event.data.eventMessage)
            : event.data.eventMessage;
          const payload = parsed?.data ?? parsed;
          customerCodeFromHelcim = payload?.customerCode ?? payload?.customer_code ?? null;
        } catch (_) {}

        (async () => {
          try {
            const { data, error } = await supabase.functions.invoke('save-helcim-customer-code', {
              body: {
                action: 'sync',
                businessId: auth.selectedBusinessId,
                customerId: ref.customerId,
                customerCode: customerCodeFromHelcim || storedHelcimCard?.customerCode || null,
              },
            });

            if (error) throw error;

            setStoredHelcimCard(data?.defaultCard || null);
            toast.success('Customer payment method saved in Helcim');
          } catch (error) {
            console.error('Error syncing Helcim customer card:', error);
            toast.error(error?.message || 'Payment method was captured, but the saved card could not be refreshed');
          } finally {
            cleanup();
          }
        })();
        return;
      }

      if (event.data.eventStatus === 'ABORTED') {
        toast.error(event.data.eventMessage || 'Payment method setup was cancelled.');
        cleanup();
        return;
      }

      if (event.data.eventStatus === 'HIDE') {
        removeHelcimIframe();
      }
    };

    helcimPayMessageHandlerRef.current = handler;
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [auth.selectedBusinessId, storedHelcimCard?.customerCode]);

  const selectSuggestedCustomer = async (customer) => {
    let resolvedCustomer = customer;

    if (!customer?.customerId && customer?.lookupSource === 'waiver_signature') {
      const customerResult = await waiverOTPService.createOrGetCustomer(
        auth.selectedBusinessId,
        customer.waiverPhone || '',
        customer.waiverEmail || '',
        customer.waiverFirstName || '',
        customer.waiverLastName || ''
      );

      const resolvedCustomerId = customerResult?.customerId || customerResult?.customer_id || null;
      if (!resolvedCustomerId) {
        toast.error(customerResult?.error || 'Unable to create or link this waiver customer');
        return;
      }

      const { data: customerAccount, error } = await supabase
        .from('pos_loyalty_accounts')
        .select('id, customer_name, customer_email, customer_phone')
        .eq('business_id', auth.selectedBusinessId)
        .eq('id', resolvedCustomerId)
        .maybeSingle();

      if (error || !customerAccount) {
        toast.error('Unable to load the linked customer account');
        return;
      }

      resolvedCustomer = {
        ...customerAccount,
        customerId: customerAccount.id,
        lookupSource: 'customer_account'
      };
    }

    const { firstName, lastName } = splitCustomerName(resolvedCustomer.customer_name);
    setNewBookingData((prev) => ({
      ...prev,
      customerId: resolvedCustomer.customerId || resolvedCustomer.id,
      customerFirstName: firstName,
      customerLastName: lastName,
      customerEmail: resolvedCustomer.customer_email || '',
      customerPhone: resolvedCustomer.customer_phone || ''
    }));
    setCustomerFieldsSyncVersion((version) => version + 1);
    setCustomerSuggestions([]);
    await loadParticipantsForCustomer({
      ...resolvedCustomer,
      id: resolvedCustomer.customerId || resolvedCustomer.id
    });
  };

  const handleCustomerFieldChange = (field, value) => {
    setNewBookingData((prev) => ({
      ...prev,
      customerId: field === 'customerId' ? value : null,
      [field]: value
    }));

    if (field !== 'customerId') {
      setLinkedParticipants((prev) => (prev.length ? [] : prev));
      setSelectedParticipantKeys((prev) => (prev.length ? [] : prev));
    }
  };

  const handleDeferredCustomerFields = useCallback((fields) => {
    setNewBookingData((prev) => {
      if (
        prev.customerFirstName === fields.customerFirstName
        && prev.customerLastName === fields.customerLastName
        && prev.customerEmail === fields.customerEmail
        && prev.customerPhone === fields.customerPhone
      ) {
        return prev;
      }
      if (prev.customerId) {
        Promise.resolve().then(() => {
          setLinkedParticipants((rows) => (rows.length ? [] : rows));
          setSelectedParticipantKeys((keys) => (keys.length ? [] : keys));
        });
      }
      return {
        ...prev,
        customerFirstName: fields.customerFirstName,
        customerLastName: fields.customerLastName,
        customerEmail: fields.customerEmail,
        customerPhone: fields.customerPhone,
        customerId: null,
      };
    });
  }, []);

  const toggleParticipantSelection = (participant) => {
    const key = participantSelectionKey(participant);
    setSelectedParticipantKeys((prev) => {
      if (prev.includes(key)) {
        return prev.filter((entry) => entry !== key);
      }
      const limits = getActivityTicketLimits(parsedScheduleTicketSettings, 'staff');
      const nextCount = prev.length + manualParticipants.length + 1;
      // Only enforce max while adding; min is validated on submit.
      if (!staffTicketLimitOverride && limits.maxTickets != null && nextCount > limits.maxTickets) {
        toast.error(`Maximum ${limits.maxTickets} ticket${limits.maxTickets === 1 ? '' : 's'} allowed per booking`);
        return prev;
      }
      return [...prev, key];
    });
  };

  const addManualParticipant = () => {
    const limits = getActivityTicketLimits(parsedScheduleTicketSettings, 'staff');
    const nextCount = selectedParticipantKeys.length + manualParticipants.length + 1;
    if (!staffTicketLimitOverride && limits.maxTickets != null && nextCount > limits.maxTickets) {
      toast.error(`Maximum ${limits.maxTickets} ticket${limits.maxTickets === 1 ? '' : 's'} allowed per booking`);
      return;
    }
    const id = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setManualParticipants((prev) => [
      {
        id,
        first_name: '',
        last_name: '',
        date_of_birth: '',
        participant_type: 'minor',
        email: '',
        phone_number: '',
        inventory_item_id: null,
        isManual: true,
      },
      ...prev,
    ]);
  };

  const updateManualParticipant = (participantId, patch) => {
    setManualParticipants((prev) => prev.map((row) => (
      row.id === participantId ? { ...row, ...patch } : row
    )));
  };

  const removeManualParticipant = (participantId) => {
    setManualParticipants((prev) => prev.filter((row) => row.id !== participantId));
    setParticipantTicketByKey((prev) => {
      const next = { ...prev };
      delete next[participantId];
      return next;
    });
  };

  const setParticipantTicket = (participantKey, inventoryItemId) => {
    setParticipantTicketByKey((prev) => ({
      ...prev,
      [participantKey]: inventoryItemId || null,
    }));
    if (String(participantKey || '').startsWith('manual_')) {
      updateManualParticipant(participantKey, { inventory_item_id: inventoryItemId || null });
    }
  };

  const updateAdditionalBookingItem = (itemId, field, value) => {
    setBookingAdditionalItems((prev) => prev.map((item) => (
      item.id === itemId
        ? { ...item, [field]: value }
        : item
    )));
  };

  const toggleAdditionalBookingItemTax = (itemId, taxRateId, checked) => {
    setBookingAdditionalItems((prev) => prev.map((item) => {
      if (item.id !== itemId) return item;

      const existingTaxRateIds = Array.isArray(item.taxRateIds)
        ? item.taxRateIds
        : item.taxRateId ? [item.taxRateId] : [];

      return {
        ...item,
        taxRateIds: checked
          ? Array.from(new Set([...existingTaxRateIds, taxRateId]))
          : existingTaxRateIds.filter((id) => id !== taxRateId)
      };
    }));
  };

  const addAdditionalBookingItem = () => {
    setBookingAdditionalItems((prev) => [...prev, createEmptyAdditionalItem()]);
  };

  const removeAdditionalBookingItem = (itemId) => {
    setBookingAdditionalItems((prev) => prev.filter((item) => item.id !== itemId));
  };

  const parsedScheduleTicketSettings = useMemo(() => {
    const rawTicketSettings = selectedActivityForBooking?.activity?.ticket_settings;
    if (!rawTicketSettings) return {};
    if (typeof rawTicketSettings === 'string') {
      try {
        return JSON.parse(rawTicketSettings);
      } catch {
        return {};
      }
    }
    return rawTicketSettings || {};
  }, [selectedActivityForBooking?.activity?.ticket_settings]);

  const staffTicketLimits = useMemo(
    () => getActivityTicketLimits(parsedScheduleTicketSettings, 'staff'),
    [parsedScheduleTicketSettings]
  );

  const scheduleStaffParticipantCount = useMemo(() => {
    const linkedCount = selectedParticipantKeys.length;
    const manualCount = manualParticipants.length;
    if (linkedCount + manualCount > 0) return linkedCount + manualCount;
    const customerName = `${newBookingData.customerFirstName || ''} ${newBookingData.customerLastName || ''}`.trim();
    return customerName ? 1 : 0;
  }, [
    selectedParticipantKeys.length,
    manualParticipants.length,
    newBookingData.customerFirstName,
    newBookingData.customerLastName
  ]);

  const selectedParticipantsForSchedulePricing = useMemo(() => (
    dedupeParticipants([
      ...linkedParticipants.filter((participant) => selectedParticipantKeys.includes(participantSelectionKey(participant))),
      ...manualParticipants,
    ])
  ), [linkedParticipants, selectedParticipantKeys, manualParticipants]);

  const scheduleParticipantTicketAssignmentResult = useMemo(() => {
    if (scheduleTicketInventoryItems.length === 0 || selectedParticipantsForSchedulePricing.length === 0) {
      return {
        ticketCounts: {},
        participantAssignments: {}
      };
    }

    const items = [...scheduleTicketInventoryItems].sort((a, b) => {
      const restrictionA = parseAgeRestriction(a.age_restriction);
      const restrictionB = parseAgeRestriction(b.age_restriction);
      if (restrictionA.hasRestriction !== restrictionB.hasRestriction) {
        return restrictionA.hasRestriction ? -1 : 1;
      }
      const priceA = Number.parseFloat(a.price || 0) || 0;
      const priceB = Number.parseFloat(b.price || 0) || 0;
      if ((priceA <= 0) !== (priceB <= 0)) {
        return priceA <= 0 ? 1 : -1;
      }
      return priceA - priceB;
    });

    let participantAssignments = {};
    if (hasExplicitTicketAssignmentRules(parsedScheduleTicketSettings)) {
      const explicitResult = assignTicketsByRules({
        participants: selectedParticipantsForSchedulePricing,
        items,
        ticketSettings: parsedScheduleTicketSettings
      });
      participantAssignments = explicitResult.participantAssignments || {};
    } else {
      let fallbackAnyAgeItem = null;
      selectedParticipantsForSchedulePricing.forEach((participant) => {
        const participantKey = participant.id || participantSelectionKey(participant);
        if (participant.inventory_item_id) {
          const chosen = items.find((item) => item.id === participant.inventory_item_id);
          if (chosen) {
            participantAssignments[participantKey] = {
              inventory_item_id: chosen.id,
              inventory_item_name: chosen.name || 'Ticket',
            };
            return;
          }
        }
        if (!participant?.date_of_birth) return;

        let matchingTicket = null;
        for (const item of items) {
          const { parsed, hasRestriction } = parseAgeRestriction(item.age_restriction);
          if (!hasRestriction) {
            if (!fallbackAnyAgeItem) fallbackAnyAgeItem = item;
            if (!matchingTicket) matchingTicket = item;
            continue;
          }
          if (parsed && participantMatchesAgeRestriction(participant.date_of_birth, parsed)) {
            matchingTicket = item;
            break;
          }
        }

        if (!matchingTicket && fallbackAnyAgeItem) matchingTicket = fallbackAnyAgeItem;
        if (!matchingTicket && items.length > 0) matchingTicket = items[0];
        if (!matchingTicket) return;

        participantAssignments[participantKey] = {
          inventory_item_id: matchingTicket.id,
          inventory_item_name: matchingTicket.name || 'Ticket'
        };
      });
    }

    // Staff ticket overrides / manual picks win over auto-assign.
    Object.entries(participantTicketByKey || {}).forEach(([participantKey, inventoryItemId]) => {
      if (!inventoryItemId) return;
      const chosen = items.find((item) => item.id === inventoryItemId);
      if (!chosen) return;
      participantAssignments[participantKey] = {
        inventory_item_id: chosen.id,
        inventory_item_name: chosen.name || 'Ticket',
      };
    });

    const ticketCounts = {};
    Object.values(participantAssignments).forEach((assignment) => {
      const id = assignment?.inventory_item_id;
      if (!id) return;
      ticketCounts[id] = (ticketCounts[id] || 0) + 1;
    });

    return {
      ticketCounts,
      participantAssignments
    };
  }, [
    scheduleTicketInventoryItems,
    selectedParticipantsForSchedulePricing,
    parsedScheduleTicketSettings,
    participantTicketByKey,
  ]);

  const scheduleResolvedPricingPromotion = useMemo(() => {
    if (!newBookingData.bookingDate || !newBookingData.bookingTime) return null;
    const ticketCounts = scheduleParticipantTicketAssignmentResult.ticketCounts || {};
    const totalTickets = Object.values(ticketCounts).reduce((sum, qty) => sum + (qty || 0), 0);
    return resolveApplicableBookingPromotion(schedulePricingPromotions, {
      activityId: selectedActivityForBooking?.activity?.id,
      categoryKey: selectedActivityForBooking?.activity?.booking_types?.type_key,
      bookingDate: newBookingData.bookingDate,
      bookingTime: newBookingData.bookingTime,
      channel: 'in_person',
      totalTickets,
      purchaseAt: new Date(),
    });
  }, [
    schedulePricingPromotions,
    selectedActivityForBooking?.activity?.id,
    selectedActivityForBooking?.activity?.booking_types?.type_key,
    newBookingData.bookingDate,
    newBookingData.bookingTime,
    scheduleParticipantTicketAssignmentResult.ticketCounts,
  ]);

  const scheduleMultiDayConfig = useMemo(
    () => parseMultiDaySettings(
      selectedActivityForBooking?.activity?.ticket_settings,
      selectedActivityForBooking?.activity?.duration_minutes,
    ),
    [
      selectedActivityForBooking?.activity?.ticket_settings,
      selectedActivityForBooking?.activity?.duration_minutes,
    ],
  );

  const scheduleMultiDayWeekDayCount = useMemo(() => {
    if (!scheduleMultiDayConfig || !newBookingData.bookingDate || !selectedActivityForBooking?.activity?.id) {
      return null;
    }
    const byDow = activitySchedules[selectedActivityForBooking.activity.id] || {};
    const rows = Object.values(byDow).flat();
    return resolveMultiDaySeriesDayCountForDate(rows, newBookingData.bookingDate)
      || scheduleMultiDayConfig.dayCount
      || null;
  }, [
    scheduleMultiDayConfig,
    newBookingData.bookingDate,
    selectedActivityForBooking?.activity?.id,
    activitySchedules,
  ]);

  const schedulePriceOverridesByItemId = useMemo(
    () => buildEffectiveTicketPriceOverrides({
      items: scheduleTicketInventoryItems,
      selectedTickets: scheduleParticipantTicketAssignmentResult.ticketCounts || {},
      promotion: scheduleResolvedPricingPromotion,
      weekDayCount: scheduleMultiDayWeekDayCount,
      fullWeekDayCount: scheduleMultiDayConfig?.dayCount || null,
    }),
    [
      scheduleResolvedPricingPromotion,
      scheduleTicketInventoryItems,
      scheduleParticipantTicketAssignmentResult.ticketCounts,
      scheduleMultiDayWeekDayCount,
      scheduleMultiDayConfig?.dayCount,
    ],
  );

  const scheduleEffectiveTicketSettings = useMemo(() => {
    if (scheduleResolvedPricingPromotion?.apply_conditional_free_rules === false) {
      return { ...parsedScheduleTicketSettings, pricing_rules: [] };
    }
    return parsedScheduleTicketSettings;
  }, [parsedScheduleTicketSettings, scheduleResolvedPricingPromotion]);

  const scheduleTicketPricing = useMemo(() => calculateTicketPricing({
    selectedTickets: scheduleParticipantTicketAssignmentResult.ticketCounts,
    items: scheduleTicketInventoryItems,
    ticketSettings: scheduleEffectiveTicketSettings,
    legacyPromotions: scheduleLegacyPromotions,
    priceOverridesByItemId: schedulePriceOverridesByItemId,
  }), [
    scheduleParticipantTicketAssignmentResult.ticketCounts,
    scheduleTicketInventoryItems,
    scheduleEffectiveTicketSettings,
    scheduleLegacyPromotions,
    schedulePriceOverridesByItemId
  ]);

  const scheduleTicketCartItems = useMemo(() => (
    (scheduleTicketPricing.lineItems || [])
      .filter((line) => line.paid_quantity > 0 && line.item)
      .map((line) => ({
        id: line.item.id,
        name: line.item.name,
        price: line.unit_price,
        quantity: line.paid_quantity,
        category_id: line.item.category_id ?? null,
        item_tax_overrides: line.item.item_tax_overrides ?? [],
        modifiers: [],
      }))
  ), [scheduleTicketPricing.lineItems]);

  const scheduleTicketTaxCalculation = useMemo(() => {
    const ticketSubtotal = Number(scheduleTicketPricing.total) || 0;
    if (scheduleTicketCartItems.length === 0 || ticketSubtotal <= 0) {
      return { totalTax: 0, aggregatedTaxes: {}, aggregatedRebates: {} };
    }
    return taxCalc.calculateTotalTax(scheduleTicketCartItems, 0, 0, ticketSubtotal);
  }, [scheduleTicketCartItems, scheduleTicketPricing.total, taxCalc.calculateTotalTax]);

  const newBookingCartDisplayLines = useMemo(() => {
    const ticketLines = (scheduleTicketPricing.lineItems || []).map((line) => ({
      key: `ticket-${line.inventory_item_id}`,
      label: line.item?.name || 'Ticket',
      detail: line.paid_quantity > 0
        ? `${line.quantity} selected • ${line.paid_quantity} paid`
        : `${line.quantity} selected • Free`,
      amount: line.subtotal || 0
    }));

    const addonLines = bookingAdditionalItems
      .filter((item) => item.description.trim())
      .map((item) => {
        const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
        const unitPrice = Number.parseFloat(item.unitPrice) || 0;
        return {
          key: `addon-${item.id}`,
          label: item.description.trim(),
          detail: `${quantity} × ${formatBookingCartCurrency(unitPrice)}`,
          amount: quantity * unitPrice
        };
      });

    return [...ticketLines, ...addonLines];
  }, [scheduleTicketPricing.lineItems, bookingAdditionalItems]);

  const newBookingCartSummary = useMemo(() => {
    const ticketSubtotal = Number(scheduleTicketPricing.total) || 0;
    const ticketTaxes = Number(scheduleTicketTaxCalculation.totalTax) || 0;
    const additionalItemsSubtotal = bookingAdditionalItems.reduce((sum, item) => {
      const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
      const unitPrice = Number.parseFloat(item.unitPrice) || 0;
      return sum + (quantity * unitPrice);
    }, 0);

    const additionalItemsTaxes = bookingAdditionalItems.reduce((sum, item) => {
      const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
      const unitPrice = Number.parseFloat(item.unitPrice) || 0;
      const itemSubtotal = quantity * unitPrice;
      const selectedTaxRateIds = Array.isArray(item.taxRateIds)
        ? item.taxRateIds
        : item.taxRateId ? [item.taxRateId] : [];
      const totalTaxRate = selectedTaxRateIds.reduce((taxSum, taxRateId) => {
        const taxRate = bookingItemTaxRates.find((entry) => entry.id === taxRateId);
        return taxSum + (Number(taxRate?.rate) || 0);
      }, 0);
      return sum + (itemSubtotal * totalTaxRate);
    }, 0);

    const subtotal = ticketSubtotal + additionalItemsSubtotal;
    const taxes = ticketTaxes + additionalItemsTaxes;
    const totalPrice = subtotal + taxes;
    const totalPaid = newBookingData.paymentStatus === 'paid' ? totalPrice : 0;
    const totalDue = Math.max(0, totalPrice - totalPaid);

    const onlinePaymentSettings = parseOnlinePaymentSettings(parsedScheduleTicketSettings);
    const checkoutAmounts = calculateOnlineCheckoutAmounts(totalPrice, onlinePaymentSettings);
    const dueNow = newBookingData.paymentStatus === 'unpaid' && checkoutAmounts.isDeposit
      ? Math.min(totalDue, checkoutAmounts.chargeNow)
      : totalDue;

    return {
      subtotal,
      taxes,
      totalPrice,
      totalPaid,
      totalDue,
      dueNow,
      isDeposit: checkoutAmounts.isDeposit,
      depositDueNow: checkoutAmounts.chargeNow,
      balanceDueAtCheckIn: checkoutAmounts.balanceDue,
    };
  }, [
    scheduleTicketPricing.total,
    scheduleTicketTaxCalculation.totalTax,
    bookingAdditionalItems,
    bookingItemTaxRates,
    newBookingData.paymentStatus,
    parsedScheduleTicketSettings,
  ]);

  const formatBookingCartCurrency = (value) => `$${(Number(value) || 0).toFixed(2)}`;

  const slotEditorDayKey = useMemo(() => {
    if (!selectedActivityForBooking?.date) return 'monday';
    const dateStr = dayjs(selectedActivityForBooking.date).tz(businessTimezone).format('YYYY-MM-DD');
    return getDayKeyFromDateString(dateStr);
  }, [selectedActivityForBooking?.date, businessTimezone]);

  // Generate time slots for the schedule grid (15 min, operating hours ±3h for selected day)
  const timeSlots = useMemo(() => {
    const dateForGrid = selectedDate
      ? dayjs(selectedDate).tz(businessTimezone).format('YYYY-MM-DD')
      : null;
    const dayKey = dateForGrid ? getDayKeyFromDateString(dateForGrid) : 'monday';
    return buildFifteenMinuteTimeOptions(operatingHours, dayKey, { format: '24h' }).map((o) => o.value);
  }, [operatingHours, selectedDate, businessTimezone]);

  // Normalize time for comparison (e.g. "10:00", "10:00:00", "10:00 AM" -> "10:00")
  const normalizeTime = (t) => {
    if (!t) return '';
    const s = String(t).trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s.substring(0, 5);
    const parsed = dayjs(`1970-01-01 ${s}`, { strict: false });
    return parsed.isValid() ? parsed.format('HH:mm') : s.substring(0, 5);
  };

  const formatScheduleTime = (t) => {
    const normalized = normalizeTime(t);
    if (!normalized) return '';
    const [hourPart, minutePart] = normalized.split(':');
    const hour = Number(hourPart);
    if (!Number.isFinite(hour) || !minutePart) return t;

    const suffix = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutePart} ${suffix}`;
  };

  // Get bookings for a specific activity and time
  const getBookingsForSlot = (activityId, date, time) => {
    const dateStr = dayjs(date).tz(businessTimezone).format('YYYY-MM-DD');
    const timeNorm = normalizeTime(time);
    return bookings.filter(b =>
      b.activity_id === activityId &&
      b.booking_date === dateStr &&
      normalizeTime(b.booking_time) === timeNorm &&
      !shouldHideFromScheduleSlot(b) &&
      (showCanceled || b.status !== 'cancelled') &&
      bookingMatchesScheduleSearch(b, searchQuery)
    );
  };

  const bookingNumberById = useMemo(() => {
    const map = new Map();
    (bookings || []).forEach((booking) => {
      if (booking?.id && booking?.booking_number) {
        map.set(booking.id, booking.booking_number);
      }
    });
    return map;
  }, [bookings]);

  const parentBookingsById = useMemo(() => {
    const map = new Map();
    (bookings || []).forEach((booking) => {
      if (booking?.id && booking?.multi_day_role === 'parent') {
        map.set(booking.id, booking);
      }
    });
    return map;
  }, [bookings]);

  const resolveBookingNumberLabel = (booking) => {
    if (booking?.booking_number) return booking.booking_number;
    if (booking?.parent_booking_id) {
      return bookingNumberById.get(booking.parent_booking_id) || booking.parent_booking_id;
    }
    return booking?.id || '';
  };

  const openBookingDetailResolved = (booking, options = {}) => {
    const detailId = resolveMultiDayDetailBookingId(booking);
    if (detailId) openBookingDetail(detailId, options);
  };

  const openBookingFromScheduleContext = (booking, options = {}) => {
    const resolved =
      bookings.find((b) => b.id === resolveMultiDayDetailBookingId(booking)) || booking;
    closeTimeSlotModal();
    closeScheduleSlotModal();
    openBookingDetailResolved(resolved, { onUpdated: loadData, ...options });
  };

  // Get all bookings for a specific time slot (across all activities)
  const getBookingsForTimeSlot = (date, time) => {
    const dateStr = dayjs(date).tz(businessTimezone).format('YYYY-MM-DD');
    const timeNorm = normalizeTime(time);
    return bookings.filter(b =>
      b.booking_date === dateStr &&
      normalizeTime(b.booking_time) === timeNorm &&
      !shouldHideFromScheduleSlot(b) &&
      (showCanceled || b.status !== 'cancelled') &&
      bookingMatchesScheduleSearch(b, searchQuery)
    );
  };

  /**
   * Bookings for the open schedule-slot modal: activity + date + time, merged with any rows tied to
   * the matching booking_sessions row (handles session-based counts vs stored booking_time quirks).
   */
  const getBookingsForSelectedScheduleModal = () => {
    if (!selectedActivityForBooking?.activity?.id || !selectedActivityForBooking?.date) return [];
    const activityId = selectedActivityForBooking.activity.id;
    const date = selectedActivityForBooking.date;
    /** Match the saved schedule slot, not slotEditorTime (can lag on first paint or differ while editing). */
    const timeForMatch =
      selectedActivityForBooking.schedule?.start_time ??
      selectedActivityForBooking.time ??
      '';
    const bySlot = getBookingsForSlot(activityId, date, timeForMatch);
    const dateStr = dayjs(date).tz(businessTimezone).format('YYYY-MM-DD');
    const timeNorm = normalizeTime(timeForMatch);
    const session = sessions.find(
      (s) =>
        s.activity_id === activityId &&
        s.session_date === dateStr &&
        normalizeTime(s.start_time) === timeNorm
    );
    if (!session?.id) return bySlot;
    const bySession = bookings.filter(
      (b) =>
        b.session_id === session.id &&
        (showCanceled || b.status !== 'cancelled')
    );
    const merged = new Map();
    [...bySlot, ...bySession].forEach((b) => merged.set(b.id, b));
    return Array.from(merged.values()).sort((a, b) => {
      const da = String(a.booking_date || '').localeCompare(String(b.booking_date || ''));
      if (da !== 0) return da;
      return String(a.booking_time || '').localeCompare(String(b.booking_time || ''));
    });
  };

  const handleTimeSlotClick = (time) => {
    const slotBookings = dateRange.flatMap((date) => getBookingsForTimeSlot(date, time));
    if (slotBookings.length > 0) {
      setSelectedTimeSlot({ time });
      setIsTimeSlotModalOpen(true);
    }
  };

  const handleCheckInComplete = () => {
    loadData(); // Refresh all data after check-in
  };

  const closeTimeSlotModal = () => {
    setIsTimeSlotModalOpen(false);
    setSelectedTimeSlot(null);
  };

  const openScheduleSlotModal = (activity, date, time, schedule = null, mode = 'details') => {
    setSelectedActivityForBooking({
      activity,
      date,
      time: time || null,
      spaces: scheduleSlotTotalSpaces(schedule),
      schedule
    });
    setSlotModalMode(mode);
    setShowAddBookingModal(true);
  };

  const closeScheduleSlotModal = () => {
    removeHelcimIframe();
    setShowAddBookingModal(false);
    setSelectedActivityForBooking(null);
    setSlotEditorTime('');
    setSlotEditorSpaces('1');
    setSlotEditorSaving(false);
    setSlotEditorInitial({ time: '', spaces: '1' });
    setSlotModalMode('details');
    setSlotEmailType('confirmation');
    setSlotEmailSelectedIds(new Set());
    setSlotEmailSending(false);
    setNewBookingTab('customer');
    setNewBookingSubmitting(false);
    setNewBookingData({
      customerId: null,
      customerFirstName: '',
      customerLastName: '',
      bookingTypeId: '',
      bookingDate: '',
      bookingTime: '',
      customerEmail: '',
      customerPhone: '',
      notes: '',
      paymentStatus: 'unpaid'
    });
    setNewBookingCalendarOpen(false);
    setNewBookingCalendarMonth(new Date());
    setBookingAdditionalItems([]);
    setStoredHelcimCard(null);
    setStoredHelcimCardLoading(false);
    setHelcimCardSaving(false);
    helcimPayRef.current = { checkoutToken: null, customerId: null };
    helcimPaymentFinalizedRef.current = false;
    setCustomerSuggestions([]);
    setLinkedParticipants([]);
    setSelectedParticipantKeys([]);
    setManualParticipants([]);
    setParticipantTicketByKey({});
    setStaffTicketLimitOverride(false);
    setBlockSeatsModalOpen(false);
    setBlockPartialSeatsCount('1');
  };

  useEffect(() => {
    setStaffTicketLimitOverride(false);
  }, [selectedActivityForBooking?.activity?.id]);

  const getSelectedSlotBlockContext = () => {
    if (!selectedActivityForBooking?.activity?.id || !selectedActivityForBooking?.date) {
      return null;
    }
    const schedule = selectedActivityForBooking.schedule || { spaces: selectedActivityForBooking.spaces };
    const total = scheduleSlotTotalSpaces(schedule);
    const bookedCount = getBookingsCountForActivityAtDateTime(
      selectedActivityForBooking.activity.id,
      selectedActivityForBooking.date,
      selectedActivityForBooking.time,
    );
    const available = getEffectiveAvailableForSlot(
      selectedActivityForBooking.activity.id,
      selectedActivityForBooking.date,
      selectedActivityForBooking.time,
      schedule,
    );
    const ring = getScheduleSlotRingMetrics(schedule, bookedCount);
    const nominal = ring.N;
    const blockedSeats = ring.blocked;
    return { total, bookedCount, available, nominal, blockedSeats };
  };

  const openBlockSeatsModal = () => {
    if (!selectedActivityForBooking?.schedule?.id) {
      toast.error('No schedule slot to update');
      return;
    }
    const ctx = getSelectedSlotBlockContext();
    const a = ctx?.available ?? 0;
    setBlockPartialSeatsCount(a > 0 ? '1' : '0');
    setBlockSeatsModalOpen(true);
  };

  const closeBlockSeatsModal = () => {
    setBlockSeatsModalOpen(false);
  };

  const handleBlockAllSeats = async () => {
    if (!selectedActivityForBooking?.activity?.id || !selectedActivityForBooking?.date) return;

    const ctx = getSelectedSlotBlockContext();
    if (ctx && ctx.total > 0 && ctx.available === 0) {
      toast.error('All seats are already blocked or full. Nothing to change.');
      return;
    }
    if (ctx && ctx.total === 0) {
      toast.error('This time is already at zero capacity.');
      return;
    }

    const bookedCount = getBookingsCountForActivityAtDateTime(
      selectedActivityForBooking.activity.id,
      selectedActivityForBooking.date,
      selectedActivityForBooking.time,
    );

    if (bookedCount > 0) {
      await saveSelectedSlotChanges({
        nextTime: slotEditorTime,
        nextSpaces: String(bookedCount),
        nextIsActive: true,
        successMessage: 'All remaining seats blocked'
      });
    } else {
      await saveSelectedSlotChanges({
        nextTime: slotEditorTime,
        nextSpaces: '0',
        nextIsActive: true,
        successMessage: 'All seats blocked'
      });
    }
    closeBlockSeatsModal();
  };

  const handleBlockPartialSeatsConfirm = async () => {
    if (!selectedActivityForBooking?.activity?.id || !selectedActivityForBooking?.date) return;

    const ctx = getSelectedSlotBlockContext();
    if (!ctx) return;

    const { total, bookedCount, available } = ctx;
    if (total <= 0) {
      toast.error('This slot is already fully blocked (0 capacity).');
      return;
    }
    if (available === 0) {
      toast.error('There are no open seats to block. The slot is already at capacity.');
      return;
    }

    const x = parseInt(String(blockPartialSeatsCount).trim(), 10);
    if (!Number.isFinite(x) || x < 1) {
      toast.error('Enter a number of seats to block (at least 1).');
      return;
    }
    if (x > available) {
      toast.error(
        `You can only block up to ${available} open ${available === 1 ? 'seat' : 'seats'}.`
      );
      return;
    }

    const newSpaces = Math.max(bookedCount, total - x);
    const ok = await saveSelectedSlotChanges({
      nextTime: slotEditorTime,
      nextSpaces: String(newSpaces),
      nextIsActive: true,
      successMessage: x === available
        ? 'All remaining open seats blocked'
        : `Blocked ${x} ${x === 1 ? 'seat' : 'seats'}`
    });
    if (ok) closeBlockSeatsModal();
  };

  const handleRestoreBlockedSeats = async () => {
    if (!selectedActivityForBooking?.schedule?.id) return;

    const ctx = getSelectedSlotBlockContext();
    if (!ctx?.nominal || ctx.nominal <= 0) {
      toast.error('No saved full capacity to restore for this slot.');
      return;
    }
    if (ctx.blockedSeats <= 0) {
      toast.error('No admin-blocked seats to restore.');
      return;
    }

    const ok = await saveSelectedSlotChanges({
      nextTime: slotEditorTime,
      nextSpaces: String(Math.max(ctx.nominal, ctx.bookedCount)),
      nextIsActive: true,
      successMessage: `Restored ${ctx.blockedSeats} blocked ${ctx.blockedSeats === 1 ? 'seat' : 'seats'}`,
    });
    if (ok) closeBlockSeatsModal();
  };

  const saveSelectedSlotChanges = async ({
    nextTime = slotEditorTime,
    nextSpaces = slotEditorSpaces,
    nextIsActive = true,
    successMessage = 'Schedule slot updated'
  } = {}) => {
    if (!selectedActivityForBooking?.schedule?.id || !auth.selectedBusinessId) return false;

    const parsedSpaces = parseInt(nextSpaces, 10);

    if (!nextTime) {
      toast.error('Please enter a valid time');
      return false;
    }

    if (!Number.isFinite(parsedSpaces) || parsedSpaces < 0) {
      toast.error('Spaces must be 0 or more (0 = blocked)');
      return false;
    }

    const currentTime = normalizeTime(selectedActivityForBooking.time || '');
    const currentSpaces = scheduleSlotTotalSpaces(
      selectedActivityForBooking.schedule || { spaces: selectedActivityForBooking.spaces }
    );
    const currentNom = selectedActivityForBooking.schedule?.nominal_max_spaces;
    const currentNomN =
      currentNom != null && currentNom !== '' && Number.isFinite(Number(currentNom))
        ? Math.max(0, Number(currentNom))
        : null;
    const bookedForSlot = getBookingsForSlot(
      selectedActivityForBooking.activity.id,
      selectedActivityForBooking.date,
      selectedActivityForBooking.time
    ).length;
    const nextNominal = Math.max(
      currentNomN ?? 0,
      currentSpaces,
      parsedSpaces,
      bookedForSlot
    );
    const currentIsActive = selectedActivityForBooking.schedule?.is_active !== false;
    if (
      currentTime === nextTime &&
      currentSpaces === parsedSpaces &&
      currentIsActive === nextIsActive &&
      (currentNomN ?? 0) === nextNominal
    ) {
      return true;
    }

    const scheduleStartTime = normalizeTime(nextTime);

    try {
      setSlotEditorSaving(true);

      const { error } = await supabase
        .from('booking_activity_schedules')
        .update({
          start_time: scheduleStartTime,
          spaces: parsedSpaces,
          is_active: nextIsActive,
          nominal_max_spaces: nextNominal
        })
        .eq('id', selectedActivityForBooking.schedule.id)
        .eq('business_id', auth.selectedBusinessId);

      if (error) throw error;

      setSelectedActivityForBooking((prev) => (
        prev
          ? {
              ...prev,
              time: scheduleStartTime,
              spaces: parsedSpaces,
              schedule: {
                ...prev.schedule,
                start_time: scheduleStartTime,
                spaces: parsedSpaces,
                is_active: nextIsActive,
                nominal_max_spaces: nextNominal
              }
            }
          : prev
      ));

      setSlotEditorTime(nextTime);
      setSlotEditorSpaces(String(parsedSpaces));
      setSlotEditorInitial({ time: nextTime, spaces: String(parsedSpaces) });
      await loadActivitySchedules();
      toast.success(successMessage);
      return true;
    } catch (error) {
      console.error('Error updating slot:', error);
      toast.error(error?.message || 'Error updating slot');
      return false;
    } finally {
      setSlotEditorSaving(false);
    }
  };

  useEffect(() => {
    if (slotModalMode !== 'email' || !showAddBookingModal) return;
    const slotBookings = getBookingsForSelectedScheduleModal().filter(
      (row) => String(row.customer_email || '').trim(),
    );
    setSlotEmailSelectedIds(new Set(slotBookings.map((row) => row.id)));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when slot bookings change
  }, [slotModalMode, showAddBookingModal, selectedActivityForBooking, bookings, sessions]);

  const toggleSlotEmailSelection = (bookingId, checked) => {
    setSlotEmailSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(bookingId);
      else next.delete(bookingId);
      return next;
    });
  };

  const handleSendSlotEmails = async () => {
    if (!auth.selectedBusinessId) return;

    const slotBookings = getBookingsForSelectedScheduleModal().filter(
      (row) => slotEmailSelectedIds.has(row.id) && String(row.customer_email || '').trim(),
    );
    if (slotBookings.length === 0) {
      toast.error('Select at least one booking with a customer email');
      return;
    }

    setSlotEmailSending(true);
    bookingPaymentService.setBusinessId(auth.selectedBusinessId);

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of slotBookings) {
      try {
        if (slotEmailType === 'payment') {
          if (row.requires_approval && !row.approved_at) {
            skipped += 1;
            continue;
          }
          const pricing = getSlotModalPricing(row);
          if (pricing.totalDue <= 0) {
            skipped += 1;
            continue;
          }
          const dueAt = row.deposit_due_at
            ? String(row.deposit_due_at).slice(0, 10)
            : dayjs().add(7, 'day').format('YYYY-MM-DD');
          await bookingPaymentService.sendPaymentRequest({
            bookingId: row.id,
            requestType: 'custom',
            amount: pricing.totalDue,
            dueAt,
            resend: true,
          });
          sent += 1;
        } else {
          const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-booking-confirmation`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
              businessId: auth.selectedBusinessId,
              bookingId: row.id,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data?.error || `HTTP ${res.status}`);
          }
          if (data?.sent || data?.skipped) sent += 1;
          else throw new Error(data?.error || 'Could not send confirmation');
        }
      } catch (error) {
        console.error('Slot email send failed:', error);
        failed += 1;
      }
    }

    setSlotEmailSending(false);

    if (sent > 0) {
      toast.success(`Sent ${sent} email${sent === 1 ? '' : 's'}`);
    }
    if (skipped > 0) {
      toast(`${skipped} booking${skipped === 1 ? '' : 's'} skipped (no balance or not approved yet)`, { icon: 'ℹ️' });
    }
    if (failed > 0) {
      toast.error(`${failed} email${failed === 1 ? '' : 's'} failed`);
    }
    if (sent === 0 && failed === 0 && skipped === 0) {
      toast.error('No emails were sent');
    }
  };

  const resetSelectedSlotDraft = () => {
    setSlotEditorTime(slotEditorInitial.time);
    setSlotEditorSpaces(slotEditorInitial.spaces);
  };

  const handleSaveSlotChanges = async () => {
    await saveSelectedSlotChanges({
      nextTime: slotEditorTime,
      nextSpaces: slotEditorSpaces,
      nextIsActive: true,
      successMessage: 'Schedule slot saved'
    });
  };

  const printSelectedSlotSummary = () => {
    if (!selectedActivityForBooking?.activity?.id || !selectedActivityForBooking?.date) return;

    const slotBookings = getBookingsForSlot(
      selectedActivityForBooking.activity.id,
      selectedActivityForBooking.date,
      selectedActivityForBooking.time
    );
    const bookedCount = getBookingsCountForActivityAtDateTime(
      selectedActivityForBooking.activity.id,
      selectedActivityForBooking.date,
      selectedActivityForBooking.time,
    );
    const scheduleForPrint =
      selectedActivityForBooking.schedule || { spaces: selectedActivityForBooking.spaces };
    const ring = getScheduleSlotRingMetrics(scheduleForPrint, bookedCount);
    const { available, blocked, T, S } = ring;
    const showNominal = ring.N != null && ring.N > 0;

    const printEsc = (v) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) {
      toast.error('Popup blocked. Allow popups to print this summary.');
      return;
    }

    const capacityLines = [];
    if (showNominal) {
      capacityLines.push(
        `<div><strong>Total seats (for this time):</strong> ${T}</div>`,
        `<div><strong>Booked:</strong> ${bookedCount} &nbsp;|&nbsp; <strong>Open:</strong> ${available} &nbsp;|&nbsp; <strong>Blocked (admin):</strong> ${
          blocked > 0
            ? `<span style="color:#b91c1c;font-weight:700;">${blocked}</span>`
            : '0'
        } &nbsp;|&nbsp; <strong>Sellable slot capacity:</strong> ${S}</div>`
      );
    } else {
      capacityLines.push(
        `<div><strong>Booked:</strong> ${bookedCount} &nbsp;|&nbsp; <strong>Open:</strong> ${available} &nbsp;|&nbsp; <strong>Slot capacity:</strong> ${S}</div>`
      );
    }
    const capacityBlock = `<div style="margin-bottom: 20px; padding: 12px 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 14px; line-height: 1.6;">${capacityLines.join(
      ''
    )}</div>`;

    const rowsHtml = slotBookings.length === 0
      ? '<tr><td colspan="4" style="padding:12px;border:1px solid #ddd;text-align:center;">No bookings for this slot</td></tr>'
      : slotBookings.map((booking) => {
          const contact = booking.customer_email || booking.customer_phone || 'No contact info';
          return `
          <tr>
            <td style="padding:12px;border:1px solid #ddd;">${printEsc(booking.booking_number) || ''}</td>
            <td style="padding:12px;border:1px solid #ddd;">${printEsc(contact)}</td>
            <td style="padding:12px;border:1px solid #ddd;">${printEsc(booking.status) || ''}</td>
            <td style="padding:12px;border:1px solid #ddd;">${printEsc(booking.payment_status) || ''}</td>
          </tr>
        `;
        })
        .join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>Booking Summary</title>
        </head>
        <body style="font-family: Arial, sans-serif; padding: 24px;">
          <h1 style="margin-bottom: 8px;">${printEsc(selectedActivityForBooking.activity?.activity_name) || 'Activity'}</h1>
          <div style="margin-bottom: 4px;"><strong>Date:</strong> ${printEsc(
            formatDateForBusiness(selectedActivityForBooking.date, businessTimezone, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric'
            })
          )}</div>
          <div style="margin-bottom: 4px;"><strong>Time:</strong> ${printEsc(
            formatScheduleTime(slotEditorTime || selectedActivityForBooking.time) || 'N/A'
          )}</div>
          ${capacityBlock}
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr>
                <th style="padding:12px;border:1px solid #ddd;text-align:left;">Booking #</th>
                <th style="padding:12px;border:1px solid #ddd;text-align:left;">Contact</th>
                <th style="padding:12px;border:1px solid #ddd;text-align:left;">Status</th>
                <th style="padding:12px;border:1px solid #ddd;text-align:left;">Payment</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const submitBookingFromSlot = async (
    businessHoursOverrideApprovedBy = null,
    categoryCapacityOverrideId = null,
  ) => {
    const liveCustomerFields = customerFieldsLiveRef.current || {};
    const customerFirstName = String(
      liveCustomerFields.customerFirstName ?? newBookingData.customerFirstName ?? '',
    );
    const customerLastName = String(
      liveCustomerFields.customerLastName ?? newBookingData.customerLastName ?? '',
    );
    const customerEmail = String(
      liveCustomerFields.customerEmail ?? newBookingData.customerEmail ?? '',
    );
    const customerPhone = String(
      liveCustomerFields.customerPhone ?? newBookingData.customerPhone ?? '',
    );

    if (
      customerFirstName !== newBookingData.customerFirstName
      || customerLastName !== newBookingData.customerLastName
      || customerEmail !== newBookingData.customerEmail
      || customerPhone !== newBookingData.customerPhone
    ) {
      setNewBookingData((prev) => ({
        ...prev,
        customerFirstName,
        customerLastName,
        customerEmail,
        customerPhone,
      }));
    }

    const selectedParticipantsPreview = [
      ...linkedParticipants.filter((participant) => selectedParticipantKeys.includes(participantSelectionKey(participant))),
      ...manualParticipants,
    ];

    const selectedParticipants = selectedParticipantsPreview.map((participant) => {
      const assignmentKey = participant.id || participantSelectionKey(participant);
      const assignedTicket = scheduleParticipantTicketAssignmentResult.participantAssignments?.[assignmentKey];
      const inventoryItemId = assignedTicket?.inventory_item_id
        || participant.inventory_item_id
        || participantTicketByKey[assignmentKey]
        || null;
      const inventoryItem = scheduleTicketInventoryItems.find((item) => item.id === inventoryItemId);
      return {
        firstName: participant.first_name || '',
        lastName: participant.last_name || '',
        dateOfBirth: participant.date_of_birth || null,
        phoneNumber: participant.phone_number || null,
        email: participant.email || null,
        isMinor: participant.participant_type === 'minor' || participant.is_minor === true,
        ticketType: assignedTicket?.inventory_item_name || inventoryItem?.name || null,
        inventoryItemId,
      };
    }).filter((participant) => String(participant.firstName || '').trim() || String(participant.lastName || '').trim());

    if (selectedParticipants.length === 0 && `${customerFirstName} ${customerLastName}`.trim()) {
      selectedParticipants.push({
        firstName: customerFirstName.trim(),
        lastName: customerLastName.trim(),
        dateOfBirth: null,
        phoneNumber: customerPhone.trim() || null,
        email: customerEmail.trim() || null,
        isMinor: false,
      });
    }

    if (selectedParticipants.some((participant) => !String(participant.firstName || '').trim())) {
      throw new Error('Each participant needs a first name');
    }

    let customerId = newBookingData.customerId || null;
    if (!customerId && (customerEmail.trim() || customerPhone.trim())) {
      const customerResult = await waiverOTPService.createOrGetCustomer(
        auth.selectedBusinessId,
        customerPhone.trim(),
        customerEmail.trim(),
        customerFirstName.trim(),
        customerLastName.trim(),
      );
      const resolvedCustomerId = customerResult?.customerId || customerResult?.customer_id || null;
      if (!resolvedCustomerId) {
        throw new Error(customerResult?.error || 'Could not create customer account. Enter email or phone and try again.');
      }
      customerId = resolvedCustomerId;
      setNewBookingData((prev) => ({ ...prev, customerId }));
    }

    const manualAddons = bookingAdditionalItems
      .filter((item) => item.description.trim())
      .map((item) => ({
        addonId: null,
        addonName: item.description.trim(),
        quantity: Math.max(1, parseInt(item.quantity, 10) || 1),
        unitPrice: Number.parseFloat(item.unitPrice) || 0,
        taxRateIds: (Array.isArray(item.taxRateIds) ? item.taxRateIds : item.taxRateId ? [item.taxRateId] : []).filter(Boolean),
      }));

    const createdIp = await SecurityUtils.getClientIP().catch(() => null);

    const booking = await bookingService.createBooking({
      activityId: selectedActivityForBooking.activity.id,
      bookingTypeId: newBookingData.bookingTypeId || null,
      customerId,
      customerFirstName: customerFirstName.trim(),
      customerLastName: customerLastName.trim(),
      customerEmail: customerEmail.trim(),
      customerPhone: customerPhone.trim(),
      bookingDate: newBookingData.bookingDate,
      bookingTime: normalizeTime(newBookingData.bookingTime || ''),
      participants: selectedParticipants,
      addons: manualAddons,
      notes: newBookingData.notes.trim(),
      paymentStatus: newBookingData.paymentStatus || 'unpaid',
      durationMinutes: selectedActivityForBooking.activity?.duration_minutes || null,
      resourceAssignments: flattenScheduleResourceAssignments(
        selectedActivityForBooking.schedule?.resource_assignments,
      ),
      resourceAssignmentSource: 'schedule',
      createdBy: auth.authUser?.id,
      createdIp,
      ticketLimitOverride: staffTicketLimitOverride && canOverrideTicketLimits,
      businessHoursOverrideApprovedBy,
      categoryCapacityOverrideId:
        categoryCapacityOverrideId || categoryCapacityOverrideIdRef.current || null,
    });

    const savedCount = Array.isArray(booking?.booking_participants)
      ? booking.booking_participants.length
      : 0;
    if (selectedParticipants.length > 0 && savedCount < selectedParticipants.length) {
      throw new Error(
        `Booking was created but only ${savedCount} of ${selectedParticipants.length} participants saved. Open the booking and add the missing guests.`
      );
    }

    toast.success('Booking created successfully');
    categoryCapacityOverrideIdRef.current = null;
    closeScheduleSlotModal();
    await loadData();
    openBookingDetailResolved(booking, { onUpdated: loadData });
  };

  const handleCategoryCapacityOverrideApproved = async (pin) => {
    const bookingTypeId =
      selectedActivityForBooking?.activity?.type_id
      || newBookingData.bookingTypeId
      || null;
    if (!bookingTypeId) {
      throw new Error('Could not determine booking category.');
    }
    const { overrideId } = await approveCategoryCapacityOverride(
      auth.selectedBusinessId,
      pin,
      {
        bookingTypeId,
        bookingDate: newBookingData.bookingDate,
        bookingTime: newBookingData.bookingTime,
        reason: 'Staff schedule booking — category capacity override',
      },
    );
    categoryCapacityOverrideIdRef.current = overrideId;
    setCategoryCapacityOverrideModal({ open: false, reason: '' });
    try {
      setNewBookingSubmitting(true);
      await submitBookingFromSlot(null, overrideId);
    } catch (error) {
      console.error('Error creating booking after capacity override:', error);
      toast.error(error?.message || 'Error creating booking');
      categoryCapacityOverrideIdRef.current = null;
    } finally {
      setNewBookingSubmitting(false);
    }
  };

  const handleHoursOverrideApproved = async (pin) => {
    const { approvedBy } = await approveBusinessHoursOverride(auth.selectedBusinessId, pin);
    setHoursOverrideModal({ open: false, reason: '' });
    try {
      setNewBookingSubmitting(true);
      await submitBookingFromSlot(approvedBy);
    } catch (error) {
      console.error('Error creating booking from slot:', error);
      toast.error(error?.message || 'Error creating booking');
    } finally {
      setNewBookingSubmitting(false);
    }
  };

  const handleCreateBookingFromSlot = async () => {
    if (!canCreateBookings) {
      toast.error('You do not have permission to create bookings');
      return;
    }
    if (!selectedActivityForBooking?.activity?.id || !selectedActivityForBooking?.date) {
      toast.error('Select a valid schedule slot first');
      return;
    }
    if (!newBookingData.bookingDate || !newBookingData.bookingTime) {
      toast.error('Please choose an available booking date and time');
      return;
    }

    const liveCustomerFields = customerFieldsLiveRef.current || {};
    const customerFirstName = String(
      liveCustomerFields.customerFirstName ?? newBookingData.customerFirstName ?? '',
    );
    const customerLastName = String(
      liveCustomerFields.customerLastName ?? newBookingData.customerLastName ?? '',
    );
    const customerEmail = String(
      liveCustomerFields.customerEmail ?? newBookingData.customerEmail ?? '',
    );
    const customerPhone = String(
      liveCustomerFields.customerPhone ?? newBookingData.customerPhone ?? '',
    );

    if (
      !newBookingData.customerId &&
      !customerEmail.trim() &&
      !customerPhone.trim() &&
      !`${customerFirstName} ${customerLastName}`.trim()
    ) {
      toast.error('Enter customer details or select an existing customer');
      return;
    }

    const selectedParticipantsPreview = [
      ...linkedParticipants.filter((participant) => selectedParticipantKeys.includes(participantSelectionKey(participant))),
      ...manualParticipants,
    ];

    let participantCount = selectedParticipantsPreview.filter((participant) => (
      String(participant.first_name || '').trim() || String(participant.last_name || '').trim()
    )).length;
    if (participantCount === 0 && `${customerFirstName} ${customerLastName}`.trim()) {
      participantCount = 1;
    }

    const limitCheck = validateParticipantCountAgainstTicketLimits(
      participantCount,
      staffTicketLimits,
      { override: staffTicketLimitOverride && canOverrideTicketLimits }
    );
    if (!limitCheck.ok) {
      toast.error(limitCheck.message);
      return;
    }

    const hoursCheck = checkBookingBusinessHours({
      bookingDate: newBookingData.bookingDate,
      bookingTime: normalizeTime(newBookingData.bookingTime || ''),
      durationMinutes: selectedActivityForBooking.activity?.duration_minutes || 60,
      operatingHours: auth.businessData?.operating_hours || operatingHours,
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

    const typeKey = selectedActivityForBooking.activity?.booking_types?.type_key || '';
    const unitsRequested = estimateBookingCapacityUnits({
      participants: selectedParticipantsPreview.map((participant) => ({
        participant_type: participant.participant_type,
        is_minor: participant.participant_type === 'minor',
      })),
      typeKey,
      fallbackCount: participantCount,
    });
    try {
      const capacityCheck = await validateCategoryCapacity({
        businessId: auth.selectedBusinessId,
        activityId: selectedActivityForBooking.activity.id,
        bookingDate: newBookingData.bookingDate,
        bookingTime: normalizeTime(newBookingData.bookingTime || ''),
        unitsRequested,
      });
      if (!capacityCheck?.ok && capacityCheck?.requires_override) {
        setCategoryCapacityOverrideModal({
          open: true,
          reason: capacityCheck.message,
        });
        return;
      }
      if (!capacityCheck?.ok) {
        toast.error(capacityCheck.message || 'Not enough capacity for this booking.');
        return;
      }
    } catch (error) {
      console.error('Category capacity pre-check failed:', error);
      toast.error(error?.message || 'Could not verify category capacity.');
      return;
    }

    try {
      setNewBookingSubmitting(true);
      await submitBookingFromSlot();
    } catch (error) {
      console.error('Error creating booking from slot:', error);
      if (error?.requiresOverride || error?.code === 'category_capacity') {
        setCategoryCapacityOverrideModal({
          open: true,
          reason: error.message,
        });
        return;
      }
      toast.error(error?.message || 'Error creating booking');
    } finally {
      setNewBookingSubmitting(false);
    }
  };

  // Get availability for a session
  const getAvailability = (session) => {
    const sessionBookings = bookings.filter(b => 
      b.session_id === session.id &&
      (showCanceled || b.status !== 'cancelled')
    );
    const booked = sessionBookings.length;
    const available = (session.max_capacity || session.available_spots || 0) - booked;
    return { booked, available, total: session.max_capacity || 0 };
  };

  // Generate dates for the selected range (timezone-aware)
  const dateRange = useMemo(() => {
    const dates = [];
    const baseDate = dayjs(selectedDate).tz(businessTimezone);
    for (let i = 0; i < dayRange; i++) {
      const date = baseDate.add(i, 'day').toDate();
      dates.push(date);
    }
    return dates;
  }, [selectedDate, dayRange, businessTimezone]);

  // Calendar navigation (timezone-aware)
  const navigateMonth = (direction) => {
    const newDate = dayjs(calendarViewDate).tz(businessTimezone).add(direction, 'month').toDate();
    setCalendarViewDate(newDate);
  };

  const navigateDay = (direction) => {
    const newDate = dayjs(selectedDate).tz(businessTimezone).add(direction, 'day').toDate();
    setSelectedDate(newDate);
  };

  // Get days in month for calendar (timezone-aware)
  const getDaysInMonth = (baseDate) => {
    const baseInTz = dayjs(baseDate).tz(businessTimezone);
    const year = baseInTz.year();
    const month = baseInTz.month();
    const firstDay = dayjs.tz(`${year}-${String(month + 1).padStart(2, '0')}-01`, businessTimezone);
    const lastDay = firstDay.endOf('month');
    const daysInMonth = lastDay.date();
    const startingDayOfWeek = firstDay.day();

    const days = [];
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(firstDay.date(day).toDate());
    }
    return days;
  };

  const isToday = (date) => {
    if (!date) return false;
    // Use timezone-aware comparison
    const todayInTz = dayjs().tz(businessTimezone).format('YYYY-MM-DD');
    const dateInTz = dayjs(date).tz(businessTimezone).format('YYYY-MM-DD');
    return dateInTz === todayInTz;
  };

  const isSelected = (date) => {
    if (!date) return false;
    // Use timezone-aware comparison
    const selectedInTz = dayjs(selectedDate).tz(businessTimezone).format('YYYY-MM-DD');
    const dateInTz = dayjs(date).tz(businessTimezone).format('YYYY-MM-DD');
    return dateInTz === selectedInTz;
  };

  const isSameDay = (a, b) => {
    if (!a || !b) return false;
    // Use timezone-aware comparison
    const aInTz = dayjs(a).tz(businessTimezone).format('YYYY-MM-DD');
    const bInTz = dayjs(b).tz(businessTimezone).format('YYYY-MM-DD');
    return aInTz === bInTz;
  };

  const getDateLaneLabel = (date) => {
    // Use timezone-aware date operations
    const todayInTz = dayjs().tz(businessTimezone);
    const tomorrowInTz = todayInTz.add(1, 'day');
    const dateInTz = dayjs(date).tz(businessTimezone);

    if (isSameDay(date, todayInTz.toDate())) return 'Today';
    if (isSameDay(date, tomorrowInTz.toDate())) return 'Tomorrow';
    return formatDateForBusiness(date, businessTimezone, { weekday: 'long', month: 'short', day: 'numeric' });
  };

  const getBookingsCountForActivityOnDate = (activityId, date) => {
    if (!activityId || !date) return 0;
    // Use timezone-aware date string
    const dateStr = dayjs(date).tz(businessTimezone).format('YYYY-MM-DD');
    return bookings.filter(b =>
      b.activity_id === activityId &&
      b.booking_date === dateStr &&
      (showCanceled || b.status !== 'cancelled')
    ).length;
  };

  // Get schedules for an activity on a specific date
  // Priority: Date-specific schedules override indefinite (default) schedules
  const getSchedulesForActivityOnDate = (activityId, date) => {
    if (!activityId || !date) return [];
    const dayOfWeek = dayjs(date).tz(businessTimezone).day();
    const activitySchedule = activitySchedules[activityId];
    if (!activitySchedule || !activitySchedule[dayOfWeek]) {
      return [];
    }
    const allSchedules = activitySchedule[dayOfWeek];
    const dateStr = dayjs(date).tz(businessTimezone).format('YYYY-MM-DD');
    
    // Separate date-specific and indefinite schedules
    const dateSpecificSchedules = [];
    const indefiniteSchedules = [];
    
    allSchedules.forEach(schedule => {
      const isIndefinite = !schedule.start_date && !schedule.end_date;
      
      if (isIndefinite) {
        indefiniteSchedules.push(schedule);
      } else {
        // Check if date falls within the schedule's date range
        const startDate = schedule.start_date ? dayjs(schedule.start_date).format('YYYY-MM-DD') : null;
        const endDate = schedule.end_date ? dayjs(schedule.end_date).format('YYYY-MM-DD') : null;
        
        if (startDate && endDate) {
          // Both dates provided - check if date is within range
          if (dateStr >= startDate && dateStr <= endDate) {
            dateSpecificSchedules.push(schedule);
          }
        } else if (startDate) {
          // Only start date - check if date is on or after start
          if (dateStr >= startDate) {
            dateSpecificSchedules.push(schedule);
          }
        } else if (endDate) {
          // Only end date - check if date is on or before end
          if (dateStr <= endDate) {
            dateSpecificSchedules.push(schedule);
          }
        }
      }
    });
    
    // Prioritize date-specific schedules, fallback to indefinite
    const schedulesToUse = dateSpecificSchedules.length > 0 ? dateSpecificSchedules : indefiniteSchedules;
    
    // Sort by start_time
    return schedulesToUse.sort((a, b) => {
      // Simple string comparison for time format "XX:XX AM/PM"
      return a.start_time.localeCompare(b.start_time);
    });
  };

  const refreshEffectiveCapacity = useCallback(async () => {
    if (!auth.selectedBusinessId || activities.length === 0) return;

    const entries = [];
    for (const date of dateRange) {
      const dateStr = dayjs(date).tz(businessTimezone).format('YYYY-MM-DD');
      for (const activity of activities) {
        const schedules = getSchedulesForActivityOnDate(activity.id, date);
        const countedTimes = new Set();
        for (const schedule of schedules) {
          const timeNorm = normalizeTime(schedule.start_time);
          if (countedTimes.has(timeNorm)) continue;
          countedTimes.add(timeNorm);
          const key = `${activity.id}|${dateStr}|${timeNorm}`;
          try {
            const ctx = await fetchEffectiveSlotCapacity({
              businessId: auth.selectedBusinessId,
              activityId: activity.id,
              bookingDate: dateStr,
              bookingTime: schedule.start_time,
            });
            entries.push([key, ctx]);
          } catch (error) {
            console.warn('Effective capacity fetch failed:', key, error);
          }
        }
      }
    }
    setEffectiveCapacityByKey(Object.fromEntries(entries));
  }, [activities, auth.selectedBusinessId, businessTimezone, dateRange, activitySchedules]);

  useEffect(() => {
    if (activities.length > 0 && Object.keys(activitySchedules).length > 0) {
      refreshEffectiveCapacity();
    }
  }, [activities.length, activitySchedules, bookings.length, refreshEffectiveCapacity]);

  // Get resources for a schedule
  const getResourcesForSchedule = (schedule) => {
    if (!schedule || !schedule.resource_assignments) return [];
    const resourceNames = [];
    Object.entries(schedule.resource_assignments).forEach(([categoryId, resourceIdOrArray]) => {
      const category = resources.find(cat => cat.categoryId === categoryId);
      if (category) {
        // Handle both single values (backward compatibility) and arrays
        const resourceIds = Array.isArray(resourceIdOrArray) 
          ? resourceIdOrArray 
          : resourceIdOrArray ? [resourceIdOrArray] : [];
        
        resourceIds.forEach(resourceId => {
          const resource = category.resources.find(r => r.id === resourceId);
          if (resource) {
            resourceNames.push(resource.name);
          }
        });
      }
    });
    return resourceNames;
  };

  // Get availability for an activity on a date
  const getAvailabilityForActivityOnDate = (activityId, date) => {
    const dateStr = dayjs(date).tz(businessTimezone).format('YYYY-MM-DD');
    const schedules = getSchedulesForActivityOnDate(activityId, date);
    
    if (schedules.length === 0) {
      return { booked: 0, available: 0, total: 0, hasSchedule: false };
    }

    // Sum up spaces from all schedules for this day
    const totalSpaces = schedules.reduce((sum, s) => sum + scheduleSlotTotalSpaces(s), 0);
    
    const countByParticipants = activityCountsParticipants(activityId);
    const typeKey = activities.find((a) => a.id === activityId)?.booking_types?.type_key || '';
    const occupancyForDate = slotOccupancyByKey[`${activityId}|${dateStr}`];
    let totalBooked = 0;
    const countedSlotTimes = new Set();
    schedules.forEach((schedule) => {
      if (countByParticipants && occupancyForDate) {
        const slotKey = normalizeTime(schedule.start_time);
        if (countedSlotTimes.has(slotKey)) return;
        countedSlotTimes.add(slotKey);
        totalBooked += resolvePortalSlotOccupancyCount(occupancyForDate, schedule.start_time);
        return;
      }
      const bookingsForSlot = bookings.filter((b) =>
        b.activity_id === activityId &&
        b.booking_date === dateStr &&
        b.booking_time === schedule.start_time &&
        !shouldHideFromScheduleSlot(b) &&
        (showCanceled || b.status !== 'cancelled')
      );
      totalBooked += bookingsForSlot.reduce(
        (sum, booking) => sum + bookingOccupancyUnits(booking, {
          countByParticipants,
          typeKey,
          parentBookingsById,
        }),
        0,
      );
    });

    const available = Math.max(0, totalSpaces - totalBooked);

    return { booked: totalBooked, available, total: totalSpaces, hasSchedule: true };
  };

  const activityCountsParticipants = (activityId) => {
    const activity = activities.find((a) => a.id === activityId);
    const typeKey = activity?.booking_types?.type_key;
    return activityCountsParticipantsByType(typeKey);
  };

  const getBookingsCountForActivityAtDateTime = (activityId, date, time) => {
    if (!activityId || !date || !time) return 0;
    const dateStr = dayjs(date).tz(businessTimezone).format('YYYY-MM-DD');
    const timeNorm = normalizeTime(time);
    const countByParticipants = activityCountsParticipants(activityId);
    const typeKey = activities.find((a) => a.id === activityId)?.booking_types?.type_key || '';
    if (countByParticipants) {
      const occupancyForDate = slotOccupancyByKey[`${activityId}|${dateStr}`];
      if (occupancyForDate) {
        return resolvePortalSlotOccupancyCount(occupancyForDate, time);
      }
    }
    return bookings
      .filter((booking) =>
        booking.activity_id === activityId &&
        booking.booking_date === dateStr &&
        normalizeTime(booking.booking_time) === timeNorm &&
        !shouldHideFromScheduleSlot(booking) &&
        (showCanceled || booking.status !== 'cancelled')
      )
      .reduce(
        (sum, booking) => sum + bookingOccupancyUnits(booking, {
          countByParticipants,
          typeKey,
          parentBookingsById,
        }),
        0,
      );
  };

  const getDayBookingsForResourceCheck = (dateStr) =>
    (bookings || []).filter((booking) => {
      const bookingDateKey = String(booking?.booking_date || '').slice(0, 10);
      return (
        bookingDateKey === dateStr &&
        ACTIVE_BOOKING_STATUSES_FOR_RESOURCE.includes(booking.status) &&
        !shouldHideFromScheduleSlot(booking)
      );
    });

  const isScheduleBlockedBySharedResources = (activityId, dateStr, schedule) => {
    if (!listScheduleResourceRequirements(schedule?.resource_assignments).length) {
      return false;
    }
    const activity = activities.find((row) => row.id === activityId);
    const durationMinutes =
      Number(activity?.duration_minutes) > 0 ? Number(activity.duration_minutes) : 90;
    const resourceOk = areRequiredResourcesAvailableForSlot({
      schedule,
      bookingDate: dateStr,
      bookingTime:
        normalizeBookingScheduleTime(schedule?.start_time) || schedule?.start_time,
      durationMinutes,
      dayBookings: getDayBookingsForResourceCheck(dateStr),
    });
    return !resourceOk.ok;
  };

  const getEffectiveAvailableForSlot = (activityId, date, time, schedule) => {
    const dateStr = dayjs(date).tz(businessTimezone).format('YYYY-MM-DD');
    const timeNorm = normalizeTime(time);
    const booked = getBookingsCountForActivityAtDateTime(activityId, date, time);
    const total = scheduleSlotTotalSpaces(schedule);
    const slotRemaining = Math.max(0, total - booked);
    const ctx = effectiveCapacityByKey[`${activityId}|${dateStr}|${timeNorm}`];
    let effective = slotRemaining;
    if (ctx) {
      const fromCapacity = effectiveSpacesLeftFromCapacityContext(ctx, booked);
      if (fromCapacity != null) effective = fromCapacity;
    }
    if (effective > 0 && isScheduleBlockedBySharedResources(activityId, dateStr, schedule || { start_time: time })) {
      return 0;
    }
    return effective;
  };

  /** All published times for a date, with available count after shared-room checks. */
  const getSchedulesWithAvailabilityForActivityOnDate = (activityId, date) => {
    const dateStr = dayjs(date).tz(businessTimezone).format('YYYY-MM-DD');
    return getSchedulesForActivityOnDate(activityId, date)
      .map((schedule) => {
        const booked = getBookingsCountForActivityAtDateTime(activityId, date, schedule.start_time);
        const total = scheduleSlotTotalSpaces(schedule);
        let available = Math.max(0, total - booked);
        const roomBlocked =
          available > 0 && isScheduleBlockedBySharedResources(activityId, dateStr, schedule);
        if (roomBlocked) available = 0;
        return {
          ...schedule,
          booked,
          total,
          available,
          roomBlocked,
        };
      })
      .sort((a, b) => normalizeTime(a.start_time).localeCompare(normalizeTime(b.start_time)));
  };

  const getAvailableSchedulesForActivityOnDate = (activityId, date) =>
    getSchedulesWithAvailabilityForActivityOnDate(activityId, date).filter(
      (schedule) => schedule.available > 0,
    );

  const availableBookingDates = useMemo(() => {
    if (!selectedActivityForBooking?.activity?.id) return [];

    const anchor = selectedActivityForBooking?.date
      ? dayjs(selectedActivityForBooking.date).tz(businessTimezone)
      : dayjs().tz(businessTimezone);

    const dates = [];
    for (let offset = 0; offset < 120; offset += 1) {
      const date = anchor.add(offset, 'day').toDate();
      // Include any day with published schedule times (even if rooms are currently full),
      // so Super/Ultimate don't look like they have "no dates" when only rooms are busy.
      const schedules = getSchedulesWithAvailabilityForActivityOnDate(
        selectedActivityForBooking.activity.id,
        date,
      );
      if (schedules.length > 0) {
        dates.push({
          date,
          dateKey: dayjs(date).tz(businessTimezone).format('YYYY-MM-DD'),
          schedules,
        });
      }
    }
    return dates;
  }, [selectedActivityForBooking, businessTimezone, activitySchedules, bookings, showCanceled, activities]);

  const availableBookingDateKeys = useMemo(
    () => new Set(availableBookingDates.map((entry) => entry.dateKey)),
    [availableBookingDates]
  );

  const availableBookingTimes = useMemo(() => {
    if (!selectedActivityForBooking?.activity?.id || !newBookingData.bookingDate) return [];
    const targetDate = dayjs.tz(newBookingData.bookingDate, businessTimezone).toDate();
    return getSchedulesWithAvailabilityForActivityOnDate(
      selectedActivityForBooking.activity.id,
      targetDate,
    );
  }, [
    selectedActivityForBooking,
    newBookingData.bookingDate,
    businessTimezone,
    activitySchedules,
    bookings,
    showCanceled,
    activities,
  ]);

  useEffect(() => {
    if (slotModalMode !== 'new') return;

    const firstAvailableDate = availableBookingDates[0]?.dateKey || '';
    if (!newBookingData.bookingDate || !availableBookingDateKeys.has(newBookingData.bookingDate)) {
      if (firstAvailableDate && firstAvailableDate !== newBookingData.bookingDate) {
        setNewBookingData((prev) => ({
          ...prev,
          bookingDate: firstAvailableDate,
          bookingTime: ''
        }));
      }
      return;
    }

    const bookableTimes = availableBookingTimes.filter((schedule) => schedule.available > 0);
    const validTimeKeys = new Set(bookableTimes.map((schedule) => normalizeTime(schedule.start_time)));
    const normalizedCurrentTime = normalizeTime(newBookingData.bookingTime);
    if (!normalizedCurrentTime || !validTimeKeys.has(normalizedCurrentTime)) {
      const firstAvailableTime = bookableTimes[0]?.start_time
        ? normalizeTime(bookableTimes[0].start_time)
        : '';
      if (firstAvailableTime !== normalizedCurrentTime) {
        setNewBookingData((prev) => ({
          ...prev,
          bookingTime: firstAvailableTime
        }));
      }
    }
  }, [
    slotModalMode,
    newBookingData.bookingDate,
    newBookingData.bookingTime,
    availableBookingDates,
    availableBookingDateKeys,
    availableBookingTimes
  ]);

  // Get progress percentage for activity
  const getProgressPercentage = (activityId, date) => {
    const availability = getAvailabilityForActivityOnDate(activityId, date);
    if (availability.total === 0) return 0;
    return Math.min(100, (availability.booked / availability.total) * 100);
  };

  if (!canViewBookings) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h3>Access Denied</h3>
        <p>You do not have permission to view the schedule.</p>
      </div>
    );
  }

  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      // Fill space under module header + tabs so the list scrolls inside this panel.
      height: 'calc(100vh - 230px)',
      minHeight: 420,
      backgroundColor: '#f9fafb',
      overflow: 'hidden',
    },
    calendarHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '12px'
    },
    calendarTitle: {
      fontSize: '16px',
      fontWeight: '600',
      color: TavariStyles.colors.gray900
    },
    calendarGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(7, 1fr)',
      gap: '4px',
      marginBottom: '8px'
    },
    calendarDayHeader: {
      fontSize: '11px',
      fontWeight: '600',
      color: TavariStyles.colors.gray600,
      textAlign: 'center',
      padding: '4px'
    },
    calendarDay: {
      aspectRatio: '1',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '13px',
      cursor: 'pointer',
      borderRadius: '4px',
      border: '1px solid transparent'
    },
    calendarDayToday: {
      backgroundColor: '#fef3c7',
      fontWeight: '700'
    },
    calendarDaySelected: {
      backgroundColor: TavariStyles.colors.primary,
      color: 'white',
      fontWeight: '700'
    },
    datePickerWrapper: {
      position: 'relative',
      marginLeft: viewportWidth <= 768 ? 0 : '12px',
      width: viewportWidth <= 768 ? '100%' : 'auto'
    },
    dateButton: {
      padding: '8px 12px',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      backgroundColor: 'white',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: '600',
      color: TavariStyles.colors.gray900,
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      minWidth: viewportWidth <= 768 ? '100%' : '175px',
      justifyContent: 'space-between'
    },
    calendarPopover: {
      position: 'absolute',
      top: 'calc(100% + 8px)',
      left: 0,
      zIndex: 50,
      width: '280px',
      backgroundColor: 'white',
      border: '1px solid #e5e7eb',
      borderRadius: '12px',
      boxShadow: '0 10px 25px rgba(0,0,0,0.12)',
      padding: '14px'
    },
    mainContent: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: 'white',
      overflow: 'hidden',
      minHeight: 0,
    },
    header: {
      padding: '16px clamp(14px, 4vw, 30px)',
      borderBottom: '1px solid #e5e7eb',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'stretch',
      flexShrink: 0,
      backgroundColor: 'white',
      zIndex: 5,
    },
    scheduleScrollArea: {
      flex: 1,
      minHeight: 0,
      overflow: 'auto',
      WebkitOverflowScrolling: 'touch',
    },
    /** Date + search + view/range controls on one row (wraps on narrow viewports) */
    headerToolbarRow: {
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '10px 12px',
      width: '100%'
    },
    headerLeft: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      minWidth: 0,
      flexWrap: 'wrap',
      flex: '0 0 auto'
    },
    headerTitle: {
      fontSize: '20px',
      fontWeight: '600',
      color: TavariStyles.colors.gray900,
      whiteSpace: 'nowrap'
    },
    headerSearchWrap: {
      flex: '1 1 200px',
      minWidth: 'min(100%, 160px)',
      maxWidth: '480px',
      display: 'flex',
      alignItems: 'center'
    },
    viewControls: {
      display: 'flex',
      gap: '10px',
      alignItems: 'center',
      flexWrap: 'wrap',
      justifyContent: 'flex-start',
      flex: '0 0 auto',
      minWidth: 0
    },
    controlsGroup: {
      display: 'flex',
      gap: '10px',
      alignItems: 'center',
      flexWrap: 'wrap',
      minWidth: 0,
      flex: '0 1 auto'
    },
    rangeButtonsGroup: {
      display: 'flex',
      gap: '10px',
      alignItems: 'center',
      flexWrap: 'wrap',
      minWidth: 0,
      flex: '0 1 auto'
    },
    viewButton: {
      padding: '6px 12px',
      border: '1px solid #e5e7eb',
      borderRadius: '6px',
      backgroundColor: 'white',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: '500',
      whiteSpace: 'nowrap'
    },
    viewButtonActive: {
      backgroundColor: TavariStyles.colors.primary,
      color: 'white',
      borderColor: TavariStyles.colors.primary
    },
    scheduleTable: {
      padding: '20px clamp(14px, 4vw, 30px)'
    },
    dateLanesWrapper: {
      padding: '14px clamp(14px, 4vw, 30px)',
      backgroundColor: 'white',
    },
    dateLanes: {
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      alignItems: 'stretch',
      width: '100%'
    },
    dateLane: {
      border: '1px solid #e5e7eb',
      borderRadius: '12px',
      backgroundColor: '#f9fafb',
      // Must stay visible so sticky day/column headers can pin to the scroll area.
      overflow: 'visible',
      width: '100%'
    },
    dateLaneHeader: {
      padding: '12px 14px',
      backgroundColor: TavariStyles.colors.primary,
      borderBottom: `1px solid ${TavariStyles.colors.primary}`,
      position: 'sticky',
      top: 0,
      zIndex: 4,
    },
    scheduleColumnHeaderRow: {
      display: 'grid',
      gridTemplateColumns: '40px 100px 1fr 120px 150px 48px',
      gap: '12px',
      padding: '12px 16px',
      backgroundColor: TavariStyles.colors.primary,
      borderBottom: `1px solid ${TavariStyles.colors.primary}`,
      alignItems: 'center',
      justifyItems: 'center',
      position: 'sticky',
      zIndex: 3,
      boxShadow: '0 1px 0 rgba(0,0,0,0.08)',
    },
    scheduleColumnHeaderLabel: {
      fontSize: '13px',
      fontWeight: '600',
      color: 'white',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      textAlign: 'center',
    },
    dateLaneTitle: {
      fontSize: '14px',
      fontWeight: '700',
      color: 'white',
      marginBottom: '2px'
    },
    laneContent: {
      padding: '10px',
      width: '100%'
    },
    activityCard: {
      padding: '10px 12px',
      border: '1px solid #e5e7eb',
      borderRadius: '10px',
      backgroundColor: 'white',
      marginBottom: '10px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    activityCardTitle: {
      fontSize: '13px',
      fontWeight: '600',
      color: TavariStyles.colors.gray900
    },
    activityCount: {
      fontSize: '13px',
      fontWeight: '700',
      padding: '4px 10px',
      borderRadius: '999px',
      backgroundColor: '#e5e7eb',
      color: TavariStyles.colors.gray700,
      whiteSpace: 'nowrap'
    },
    emptyLaneText: {
      padding: '12px',
      fontSize: '13px',
      color: TavariStyles.colors.gray600
    },
    scheduleRow: {
      display: 'grid',
      gridTemplateColumns: '100px 1fr',
      borderBottom: '1px solid #e5e7eb',
      padding: '12px 0',
      minHeight: '60px'
    },
    timeCell: {
      fontWeight: '600',
      color: TavariStyles.colors.gray700,
      fontSize: '14px',
      paddingRight: '20px'
    },
    activitiesCell: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    },
    activityItem: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '8px 12px',
      backgroundColor: '#f9fafb',
      borderRadius: '6px',
      border: '1px solid #e5e7eb'
    },
    activityName: {
      fontWeight: '500',
      fontSize: '14px',
      color: TavariStyles.colors.gray900
    },
    availabilityBadge: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      fontSize: '13px',
      padding: '4px 10px',
      borderRadius: '12px',
      fontWeight: '600'
    },
    availabilityAvailable: {
      backgroundColor: '#d1fae5',
      color: '#065f46'
    },
    availabilityLimited: {
      backgroundColor: '#fef3c7',
      color: '#92400e'
    },
    availabilityFull: {
      backgroundColor: '#fee2e2',
      color: '#991b1b'
    },
    searchInput: {
      padding: '8px 12px',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      fontSize: '13px',
      minWidth: 0,
      width: '100%',
      boxSizing: 'border-box'
    },
    modalOverlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    },
    modalContent: {
      backgroundColor: 'white',
      borderRadius: '12px',
      width: bookingModalWidth,
      maxWidth: bookingModalWidth,
      height: bookingModalHeight,
      maxHeight: bookingModalHeight,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
    },
    modalHeader: {
      padding: '20px 24px',
      borderBottom: '1px solid #e5e7eb',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    modalTitle: {
      fontSize: '20px',
      fontWeight: '600',
      color: TavariStyles.colors.gray900
    },
    modalBody: {
      padding: '20px 24px',
      overflow: 'hidden',
      flex: 1
    },
    modalBookingCard: {
      padding: '16px',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      marginBottom: '12px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'start'
    },
    timeSlotActionCard: {
      width: '100%',
      padding: '16px 18px',
      border: '1px solid #e5e7eb',
      borderRadius: '12px',
      marginBottom: '12px',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: '14px',
      textAlign: 'left',
      cursor: 'pointer',
      backgroundColor: '#fff',
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      boxSizing: 'border-box'
    },
    modalBookingInfo: {
      flex: 1
    },
    modalBookingActions: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      marginLeft: '16px'
    }
  };

  const days = getDaysInMonth(calendarViewDate);
  const monthName = calendarViewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const newBookingCalendarDays = getDaysInMonth(newBookingCalendarMonth);
  const newBookingCalendarMonthLabel = newBookingCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const selectedDateLabel = formatDateForBusiness(selectedDate, businessTimezone, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  const modalBookingDateValue = slotModalMode === 'new' && newBookingData.bookingDate
    ? dayjs.tz(newBookingData.bookingDate, businessTimezone).toDate()
    : selectedActivityForBooking?.date;
  const modalBookingTimeValue = slotModalMode === 'new' && newBookingData.bookingTime
    ? newBookingData.bookingTime
    : (slotEditorTime || selectedActivityForBooking?.time);

  return (
    <SecurityWrapper>
      <POSAuthWrapper
        requiredRoles={['employee', 'manager', 'owner']}
        requireBusiness={true}
        componentName="BookingsScheduleView"
      >
        <div style={styles.container}>
          {/* Main Content */}
          <div style={styles.mainContent}>
            {/* Header — date, search, and filters on one row */}
            <div style={styles.header}>
              <div style={styles.headerToolbarRow}>
                <div style={styles.headerLeft}>
                  <div style={styles.headerTitle}>
                    All Activities
                  </div>

                  <div style={styles.datePickerWrapper}>
                    <button
                      ref={calendarButtonRef}
                      type="button"
                      style={styles.dateButton}
                      onClick={() => {
                        setCalendarViewDate(selectedDate);
                        setIsCalendarOpen(open => !open);
                      }}
                      aria-haspopup="dialog"
                      aria-expanded={isCalendarOpen}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selectedDateLabel}
                      </span>
                      <FiChevronRight size={16} style={{ transform: isCalendarOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 120ms ease' }} />
                    </button>

                    {isCalendarOpen && (
                      <div ref={calendarPopoverRef} style={styles.calendarPopover}>
                        <div style={styles.calendarHeader}>
                          <button
                            type="button"
                            onClick={() => navigateMonth(-1)}
                            style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
                          >
                            <FiChevronLeft size={18} />
                          </button>
                          <div style={styles.calendarTitle}>{monthName}</div>
                          <button
                            type="button"
                            onClick={() => navigateMonth(1)}
                            style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
                          >
                            <FiChevronRight size={18} />
                          </button>
                        </div>

                        <div style={styles.calendarGrid}>
                          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                            <div key={day} style={styles.calendarDayHeader}>{day}</div>
                          ))}
                          {days.map((date, index) => (
                            <div
                              key={index}
                              onClick={() => {
                                if (!date) return;
                                setSelectedDate(date);
                                setCalendarViewDate(date);
                                setIsCalendarOpen(false);
                              }}
                              style={{
                                ...styles.calendarDay,
                                ...(isToday(date) && !isSelected(date) ? styles.calendarDayToday : {}),
                                ...(isSelected(date) ? styles.calendarDaySelected : {}),
                                ...(!date ? { cursor: 'default' } : {})
                              }}
                            >
                              {date ? date.getDate() : ''}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div style={styles.headerSearchWrap}>
                  <input
                    type="text"
                    placeholder="Search by name, booking #, date, email, or phone..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ ...styles.searchInput, width: '100%' }}
                  />
                </div>

                <div style={styles.viewControls}>
                  <div style={styles.controlsGroup}>
                    <button
                      onClick={() => setViewMode('rows')}
                      style={{
                        ...styles.viewButton,
                        ...(viewMode === 'rows' ? styles.viewButtonActive : {})
                      }}
                    >
                      ≡ Rows
                    </button>
                    <button
                      onClick={() => setViewMode('boxes')}
                      style={{
                        ...styles.viewButton,
                        ...(viewMode === 'boxes' ? styles.viewButtonActive : {})
                      }}
                    >
                      Boxes
                    </button>
                    <button
                      onClick={() => setShowCanceled(!showCanceled)}
                      style={{
                        ...styles.viewButton,
                        ...(showCanceled ? styles.viewButtonActive : {})
                      }}
                    >
                      Canceled
                    </button>
                  </div>
                  <div style={styles.rangeButtonsGroup}>
                    {[1, 3, 7, 14].map(days => (
                      <button
                        key={days}
                        onClick={() => setDayRange(days)}
                        style={{
                          ...styles.viewButton,
                          ...(dayRange === days ? styles.viewButtonActive : {})
                        }}
                      >
                        {days} day{days > 1 ? 's' : ''}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Date Lanes (Today / Tomorrow / ...) — scrolls under frozen toolbar */}
            <div style={styles.scheduleScrollArea}>
            {showAddBookingModal && slotModalMode === 'new' ? (
              <div style={{
                padding: '48px 24px',
                textAlign: 'center',
                color: TavariStyles.colors.gray500,
                fontSize: 14,
              }}>
                Schedule paused while creating a booking
              </div>
            ) : (
            <>
            <div style={styles.dateLanesWrapper}>
              <div style={styles.dateLanes}>
                {dateRange.map((date, idx) => (
                  <div key={idx} style={styles.dateLane}>
                    <div
                      ref={idx === 0 ? scheduleDayHeaderRef : undefined}
                      style={styles.dateLaneHeader}
                    >
                      <div style={styles.dateLaneTitle}>{getDateLaneLabel(date)}</div>
                    </div>
                    
                    {/* Header Row — sticks under the day label while rows scroll */}
                    <div style={{
                      ...styles.scheduleColumnHeaderRow,
                      top: scheduleDayHeaderHeight,
                    }}>
                      <div></div>
                      <div style={styles.scheduleColumnHeaderLabel}>Time</div>
                      <div style={styles.scheduleColumnHeaderLabel}>Activity</div>
                      <div style={styles.scheduleColumnHeaderLabel}>Resources</div>
                      <div style={styles.scheduleColumnHeaderLabel}>Status</div>
                      <div></div>
                    </div>
                    
                    <div style={styles.laneContent}>
                      {loading ? (
                        <div style={styles.emptyLaneText}>Loading…</div>
                      ) : activities.length === 0 ? (
                        <div style={styles.emptyLaneText}>No categories yet.</div>
                      ) : (() => {
                        // Joined view: all activities' slots for this date, sorted by time then activity name
                        const searchTrimmed = String(searchQuery || '').trim();
                        const hasActiveSearch = searchTrimmed.length > 0;
                        const searchLower = searchTrimmed.toLowerCase();
                        let rowsForDate = [];
                        activities.forEach(activity => {
                          const schedules = getSchedulesForActivityOnDate(activity.id, date);
                          schedules.forEach((schedule, scheduleIndex) => {
                            rowsForDate.push({ activity, schedule, scheduleIndex });
                          });
                        });
                        if (hasActiveSearch) {
                          rowsForDate = rowsForDate.filter(({ activity, schedule }) => {
                            const matchingBookings = getBookingsForSlot(
                              activity.id,
                              date,
                              schedule.start_time,
                            );
                            if (matchingBookings.length > 0) return true;
                            // Allow finding empty slots by activity name
                            return String(activity.activity_name || '')
                              .toLowerCase()
                              .includes(searchLower);
                          });
                        }
                        rowsForDate.sort((a, b) => {
                          const tA = normalizeTime(a.schedule.start_time);
                          const tB = normalizeTime(b.schedule.start_time);
                          const timeCmp = tA.localeCompare(tB);
                          if (timeCmp !== 0) return timeCmp;
                          return (a.activity.activity_name || '').localeCompare(b.activity.activity_name || '');
                        });

                        const isMultiDayBannerRow = ({ activity, schedule }) => {
                          if (isMultiDayScheduleRow(schedule)) return true;
                          return Boolean(parseMultiDaySettings(activity?.ticket_settings));
                        };
                        const multiDayBannerRows = rowsForDate.filter(isMultiDayBannerRow);
                        const normalRows = rowsForDate.filter((row) => !isMultiDayBannerRow(row));

                        const renderScheduleRow = ({ activity, schedule, scheduleIndex }, { banner = false } = {}) => {
                              const dateStr = dayjs(date).tz(businessTimezone).format('YYYY-MM-DD');
                              const booked = getBookingsCountForActivityAtDateTime(
                                activity.id,
                                date,
                                schedule.start_time,
                              );
                              const ring = getScheduleSlotRingMetrics(schedule, booked);
                              const {
                                S: total,
                                T: ringTotal,
                                N: nominalForRing,
                                blocked: blockedSeats,
                              } = ring;
                              const available = getEffectiveAvailableForSlot(
                                activity.id,
                                date,
                                schedule.start_time,
                                schedule,
                              );
                              const roomBlocked =
                                booked < total &&
                                available === 0 &&
                                isScheduleBlockedBySharedResources(activity.id, dateStr, schedule);
                              const primary = TavariStyles.colors.primary;
                              const pieBackground = roomBlocked && booked === 0
                                ? `conic-gradient(${BLOCKED_SEAT_RING} 0deg 360deg)`
                                : buildScheduleSlotPieBackground(ring, primary);
                              const rowBackground = banner
                                ? (hexToRgba(primary, 0.12) || `${primary}22`)
                                : buildScheduleSlotRowBackground({
                                    booked,
                                    blockedSeats,
                                    total,
                                    ringTotal,
                                    primaryColor: primary,
                                    roomBlocked,
                                  });
                              const centerColor =
                                roomBlocked && booked === 0
                                  ? BLOCKED_SEAT_RING
                                  : booked > 0
                                    ? TavariStyles.colors.gray900
                                    : blockedSeats > 0
                                      ? TavariStyles.colors.gray900
                                      : TavariStyles.colors.gray700;
                              const resourceNames = getResourcesForSchedule(schedule);
                              const durationMins =
                                parseMultiDaySettings(activity?.ticket_settings, activity?.duration_minutes)?.dailyDurationMinutes
                                || Number(activity?.duration_minutes)
                                || 0;
                              let timeLabel = formatScheduleTime(schedule.start_time) || '-';
                              if (banner && durationMins > 0) {
                                const startNorm = normalizeBookingScheduleTime(schedule.start_time);
                                if (startNorm) {
                                  const endLabel = formatScheduleTime(
                                    dayjs(`1970-01-01 ${startNorm}`).add(durationMins, 'minute').format('HH:mm'),
                                  );
                                  if (endLabel) timeLabel = `${timeLabel} – ${endLabel}`;
                                }
                              }
                              return (
                                <div 
                                  key={`${banner ? 'md' : 'row'}-${activity.id}-${schedule.start_time}-${scheduleIndex}`}
                                  onClick={() => openScheduleSlotModal(activity, date, schedule.start_time, schedule)}
                                  style={{
                                    display: 'grid',
                                    gridTemplateColumns: '40px 100px 1fr 120px 150px 48px',
                                    gap: '12px',
                                    padding: banner ? '12px 16px' : '10px 16px',
                                    borderBottom: '1px solid #e5e7eb',
                                    borderLeft: banner ? `4px solid ${primary}` : undefined,
                                    alignItems: 'center',
                                    justifyItems: 'center',
                                    backgroundColor: rowBackground,
                                    cursor: 'pointer'
                                  }}
                                >
                                  <div style={{
                                    width: '36px',
                                    height: '36px',
                                    borderRadius: '50%',
                                    border: total === 0 ? `2px solid ${TavariStyles.colors.gray400}` : 'none',
                                    background:
                                      pieBackground ||
                                      (total === 0 ? TavariStyles.colors.gray200 : PIE_EMPTY_COLOR),
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    position: 'relative',
                                    flexShrink: 0,
                                    overflow: 'hidden',
                                  }}
                                  title={
                                    ringTotal > 0
                                      ? `Total ${ringTotal} seats · ${booked} booked · ${blockedSeats} blocked`
                                      : ''
                                  }
                                  >
                                    <div style={{
                                      fontSize: '11px',
                                      fontWeight: '700',
                                      color: centerColor,
                                      textShadow: '0 0 2px #fff, 0 0 4px #fff',
                                      zIndex: 1,
                                      lineHeight: 1.1,
                                      textAlign: 'center',
                                    }}>
                                      {booked}
                                    </div>
                                  </div>

                                  <div style={{
                                    fontSize: banner ? '12px' : '13px',
                                    fontWeight: '600',
                                    color: TavariStyles.colors.gray900,
                                    width: '100%',
                                    textAlign: 'center'
                                  }}>
                                    {timeLabel}
                                  </div>

                                  <div style={{
                                    fontSize: '14px',
                                    fontWeight: '600',
                                    color: TavariStyles.colors.gray900,
                                    width: '100%',
                                    textAlign: 'center',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                  }}>
                                    {banner ? `Multi-day · ${activity.activity_name}` : activity.activity_name}
                                  </div>

                                  <div style={{
                                    fontSize: '13px',
                                    color: TavariStyles.colors.gray600,
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    width: '100%',
                                    minWidth: 0
                                  }}>
                                    <span style={{
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      maxWidth: '100%',
                                      display: 'inline-block',
                                      textAlign: 'center'
                                    }}>
                                      {resourceNames.length > 0 ? resourceNames.join(', ') : '-'}
                                    </span>
                                  </div>

                                  <div style={{
                                    fontSize: '13px',
                                    fontWeight: '500',
                                    color: TavariStyles.colors.gray700,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    width: '100%',
                                    textAlign: 'center',
                                    gap: '2px',
                                    minWidth: 0
                                  }}>
                                    {total === 0 && booked === 0 && blockedSeats === 0 ? (
                                      <span>Blocked (no spaces)</span>
                                    ) : roomBlocked && booked === 0 ? (
                                      <span style={{ color: BLOCKED_SEAT_RING, fontWeight: '600' }}>
                                        Rooms in use
                                      </span>
                                    ) : (
                                      <>
                                        <span>
                                          {booked} booked, {available} open
                                          {nominalForRing != null && nominalForRing > 0
                                            ? ` · ${ringTotal} total`
                                            : ''}
                                        </span>
                                        {blockedSeats > 0 && (
                                          <span style={{ color: BLOCKED_SEAT_RING, fontWeight: '600' }}>
                                            {blockedSeats} seat{blockedSeats === 1 ? '' : 's'} blocked
                                          </span>
                                        )}
                                        {roomBlocked && booked > 0 && available === 0 && (
                                          <span style={{ color: BLOCKED_SEAT_RING, fontWeight: '600' }}>
                                            Rooms in use
                                          </span>
                                        )}
                                      </>
                                    )}
                                  </div>

                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (available === 0) return;
                                      openScheduleSlotModal(activity, date, schedule.start_time, schedule, 'new');
                                    }}
                                    disabled={available === 0}
                                    style={{
                                      width: '36px',
                                      height: '36px',
                                      borderRadius: '8px',
                                      border: '1px solid #e5e7eb',
                                      backgroundColor: available === 0 ? '#f3f4f6' : 'white',
                                      cursor: available === 0 ? 'not-allowed' : 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      flexShrink: 0,
                                      transition: 'all 0.2s',
                                    }}
                                  >
                                    +
                                  </button>
                                </div>
                              );
                        };

                        const bannerNodes = multiDayBannerRows.map((row) => renderScheduleRow(row, { banner: true }));
                        const scheduleRows = normalRows.map((row) => renderScheduleRow(row, { banner: false }));
                        const allDayNodes = [...bannerNodes, ...scheduleRows];
                        if (allDayNodes.length > 0) {
                          return allDayNodes;
                        }
                        const dateStrForLane = dayjs(date).tz(businessTimezone).format('YYYY-MM-DD');
                        const bookingsForDate = bookings.filter(b =>
                          b.booking_date === dateStrForLane
                          && (showCanceled || b.status !== 'cancelled')
                          && bookingMatchesScheduleSearch(b, searchQuery)
                        );
                        if (bookingsForDate.length > 0) {
                          return (
                            <div key={`fallback-${idx}`} style={{ padding: '16px', backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                              <div style={{ fontSize: '13px', fontWeight: '600', color: TavariStyles.colors?.gray600 || '#6b7280', marginBottom: '8px' }}>
                                Bookings for this day (no schedule slots defined)
                              </div>
                              {bookingsForDate.map(b => (
                                <div
                                  key={b.id}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => openBookingFromScheduleContext(b)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      openBookingFromScheduleContext(b);
                                    }
                                  }}
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '8px 12px',
                                    marginBottom: '4px',
                                    backgroundColor: 'white',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '14px'
                                  }}
                                >
                                  <span style={{ fontWeight: '600' }}>{b.booking_activities?.activity_name || 'Activity'}</span>
                                  <span>{b.booking_time} — {b.customer_email || b.booking_number || b.id?.slice(0, 8)}</span>
                                </div>
                              ))}
                            </div>
                          );
                        }
                        if (hasActiveSearch) {
                          return (
                            <div key={`empty-search-${idx}`} style={{ padding: '16px', color: TavariStyles.colors?.gray500 || '#6b7280', fontSize: '14px' }}>
                              No bookings match “{searchTrimmed}” for this day.
                            </div>
                          );
                        }
                        return <div key={`empty-${idx}`} style={{ padding: '16px', color: TavariStyles.colors?.gray500 || '#6b7280', fontSize: '14px' }}>No schedule slots or bookings for this day.</div>;
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Schedule Table */}
            <div style={styles.scheduleTable}>
              {loading ? (
                <div style={{ padding: '40px', textAlign: 'center' }}>Loading schedule...</div>
              ) : (
                <div>
                  {/* Time Slots */}
                  {timeSlots.map(time => {
                    const slotBookings = dateRange.flatMap(date => {
                      if (selectedActivities.length === 0) return [];
                      return selectedActivities.flatMap(activityId => {
                        const activityBookings = getBookingsForSlot(activityId, date, time);
                        return activityBookings.map(booking => ({
                          ...booking,
                          date,
                          activityId
                        }));
                      });
                    });

                    if (slotBookings.length === 0 && viewMode === 'rows') return null;

                    return (
                      <div key={time} style={styles.scheduleRow}>
                        <div 
                          style={{
                            ...styles.timeCell,
                            cursor: 'pointer',
                            userSelect: 'none'
                          }}
                          onClick={() => {
                            // Check if there are bookings for this time slot across all dates
                            const hasBookings = dateRange.some(date => {
                              const slotBookings = getBookingsForTimeSlot(date, time);
                              return slotBookings.length > 0;
                            });
                            if (hasBookings) {
                              handleTimeSlotClick(time);
                            }
                          }}
                        >
                          {time}
                        </div>
                        <div style={styles.activitiesCell}>
                          {slotBookings.map((booking, idx) => {
                            const activity = activities.find(a => a.id === booking.activity_id);
                            const session = sessions.find(s => s.id === booking.session_id);
                            const availability = session ? getAvailability(session) : { booked: 1, available: 0, total: 0 };

                            return (
                              <div
                                key={booking.id ? `${booking.id}-${idx}` : idx}
                                role="button"
                                tabIndex={0}
                                title="Open booking details"
                                style={styles.activityItem}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openBookingFromScheduleContext(booking);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openBookingFromScheduleContext(booking);
                                  }
                                }}
                              >
                                <div style={styles.activityName}>
                                  {activity?.activity_name || 'Activity'}
                                  {resolveBookingNumberLabel(booking) && ` - #${resolveBookingNumberLabel(booking)}`}
                                </div>
                                <div style={{
                                  ...styles.availabilityBadge,
                                  ...(availability.available > 0 
                                    ? availability.available > 5 
                                      ? styles.availabilityAvailable 
                                      : styles.availabilityLimited
                                    : styles.availabilityFull
                                  )
                                }}>
                                  {availability.booked > 0 && `${availability.booked} booked`}
                                  {availability.available > 0 && `, ${availability.available} available`}
                                  {availability.total > 0 && ` (${availability.total} total)`}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            </>
            )}
            </div>
          </div>
        </div>

        {/* Time Slot Modal — one action card per booking; tap opens the standard booking detail modal. */}
        {isTimeSlotModalOpen && selectedTimeSlot && (
          <div style={styles.modalOverlay} onClick={closeTimeSlotModal}>
            <div style={{ ...styles.modalContent, height: 'auto', maxHeight: 'min(92vh, 900px)' }} onClick={(e) => e.stopPropagation()}>
              <div style={styles.modalHeader}>
                <div>
                  <div style={styles.modalTitle}>
                    Bookings for {selectedTimeSlot.time}
                  </div>
                  <div style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginTop: '4px' }}>
                    {dayRange === 1 
                      ? formatDateForBusiness(selectedDate, businessTimezone, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
                      : `${formatDateForBusiness(dateRange[0], businessTimezone, { month: 'short', day: 'numeric' })} - ${formatDateForBusiness(dateRange[dateRange.length - 1], businessTimezone, { month: 'short', day: 'numeric', year: 'numeric' })}`
                    }
                  </div>
                  <div style={{ fontSize: '13px', color: TavariStyles.colors.gray500, marginTop: '8px', maxWidth: '520px', lineHeight: 1.45 }}>
                    This time may have several bookings (different families). Each card is one booking — usually the person who reserved it. Tap a card to check in only that booking’s guests, then use “View booking details” there if you need the full record.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeTimeSlotModal}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    padding: '8px',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <FiX size={24} />
                </button>
              </div>
              <div style={{ ...styles.modalBody, maxHeight: 'min(65vh, 560px)', overflowY: 'auto' }}>
                {(() => {
                  const modalBookings = dateRange
                    .flatMap((date) => getBookingsForTimeSlot(date, selectedTimeSlot.time))
                    .sort((a, b) => {
                      const da = String(a.booking_date || '').localeCompare(String(b.booking_date || ''));
                      if (da !== 0) return da;
                      return String(a.booking_time || '').localeCompare(String(b.booking_time || ''));
                    });
                  if (modalBookings.length === 0) {
                    return (
                      <div style={{ textAlign: 'center', padding: '40px', color: TavariStyles.colors.gray600 }}>
                        No bookings found for this time slot
                      </div>
                    );
                  }
                  return modalBookings.map((booking) => {
                    const activity = activities.find((a) => a.id === booking.activity_id);
                    const displayBooking = bookingForParticipantDisplay(booking, parentBookingsById);
                    const bookerName = customerDisplayNameForSlotModal(displayBooking);
                    const parts = displayBooking.booking_participants || [];
                    const partyHost = parts.find((p) => p.party_role === 'host_adult');
                    const partyChild = parts.find((p) => p.party_role === 'birthday_child');
                    const guestCount = parts.length;
                    const checkedIn = parts.filter((p) => p.checked_in_at).length;
                    const formatPartyName = (p, i) => getParticipantDisplayName(p, i);
                    const guestSummary =
                      partyHost || partyChild
                        ? [
                            partyHost ? `Host: ${formatPartyName(partyHost)}` : null,
                            partyChild ? `Birthday: ${formatPartyName(partyChild)}` : null,
                            `${checkedIn}/${guestCount} checked in`,
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : guestCount === 0
                          ? 'No guest rows on file yet'
                          : `${guestCount} in this party · ${checkedIn} checked in`;
                    return (
                      <button
                        key={booking.id}
                        type="button"
                        aria-label={`Open booking details for ${bookerName}`}
                        style={styles.timeSlotActionCard}
                        onClick={() => openBookingFromScheduleContext(displayBooking)}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = TavariStyles.colors.primary;
                          e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.08)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = '#e5e7eb';
                          e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)';
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: '11px',
                              fontWeight: 700,
                              letterSpacing: '0.06em',
                              textTransform: 'uppercase',
                              color: TavariStyles.colors.gray500,
                              marginBottom: '4px',
                            }}
                          >
                            Booked by
                          </div>
                          <div
                            style={{
                              fontWeight: '800',
                              fontSize: '18px',
                              lineHeight: 1.25,
                              marginBottom: '8px',
                              color: TavariStyles.colors.gray900,
                              wordBreak: 'break-word',
                            }}
                          >
                            {bookerName}
                          </div>
                          <div style={{ fontWeight: '600', fontSize: '14px', marginBottom: '6px', color: TavariStyles.colors.gray700 }}>
                            {activity?.activity_name || 'Activity'}
                          </div>
                          <div style={{ color: TavariStyles.colors.gray600, fontSize: '13px', marginBottom: '6px' }}>
                            {new Date(booking.booking_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                            {booking.customer_email || booking.customer_phone
                              ? ` · ${booking.customer_email || booking.customer_phone}`
                              : ''}
                          </div>
                          {booking.booking_number ? (
                            <div style={{ color: TavariStyles.colors.gray500, fontSize: '13px', marginBottom: '8px' }}>
                              Booking #{booking.booking_number}
                            </div>
                          ) : null}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '4px 12px',
                                borderRadius: '12px',
                                fontSize: '13px',
                                fontWeight: '600',
                                backgroundColor: booking.status === 'checked_in' ? '#d1fae5' : 
                                                booking.status === 'cancelled' ? '#fee2e2' : '#fef3c7',
                                color: booking.status === 'checked_in' ? '#065f46' : 
                                       booking.status === 'cancelled' ? '#991b1b' : '#92400e'
                              }}
                            >
                              {formatBookingStatusLabel(booking.status)}
                            </span>
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              fontSize: '13px',
                              fontWeight: '600',
                              color: TavariStyles.colors.gray700,
                              marginBottom: '4px'
                            }}
                          >
                            <FiUsers size={16} aria-hidden style={{ opacity: 0.75 }} />
                            {guestSummary}
                          </div>
                          <div style={{ fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.primary, marginTop: '6px' }}>
                            Tap to open booking details
                          </div>
                        </div>
                        <FiChevronRight size={22} color="#9ca3af" aria-hidden style={{ flexShrink: 0, marginTop: '4px' }} />
                      </button>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Add Booking Modal */}
        {showAddBookingModal && (
          <div style={styles.modalOverlay} onClick={closeScheduleSlotModal}>
            <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
              <div style={styles.modalHeader}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  minWidth: 0,
                  flex: 1,
                  flexWrap: 'wrap'
                }}>
                  <div style={styles.modalTitle}>
                    {selectedActivityForBooking?.activity?.activity_name || 'Activity'}
                  </div>
                  <div style={{ fontSize: '14px', color: TavariStyles.colors.gray600 }}>
                    {modalBookingDateValue
                      ? formatDateForBusiness(modalBookingDateValue, businessTimezone, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
                      : 'N/A'}
                  </div>
                  <div style={{ fontSize: '14px', color: TavariStyles.colors.gray600 }}>
                    {formatScheduleTime(modalBookingTimeValue) || 'No time selected'}
                  </div>
                </div>
                <button
                  onClick={closeScheduleSlotModal}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    padding: '8px',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <FiX size={24} />
                </button>
              </div>
              <div style={styles.modalBody}>
                <div style={{
                  display: 'flex',
                  gap: '24px',
                  alignItems: 'stretch',
                  minHeight: 0,
                  height: '100%',
                  flexDirection: isCompactModalLayout ? 'column' : 'row'
                }}>
                  <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '18px',
                    textAlign: 'left',
                    color: TavariStyles.colors.gray600,
                    padding: '12px 8px 12px 12px',
                    minHeight: 0,
                    overflowY: 'auto'
                  }}>
                    {slotModalMode === 'new' && (
                      <>
                        <div style={{
                          fontSize: '24px',
                          fontWeight: '600',
                          color: TavariStyles.colors.gray900
                        }}>
                          Create New Booking
                        </div>
                        <div style={{
                          display: 'flex',
                          gap: '8px',
                          flexWrap: 'wrap',
                          marginBottom: '8px'
                        }}>
                          {[
                            ['customer', 'Customer'],
                            ['booking', 'Booking'],
                            ['notes', 'Notes'],
                            ['payment', 'Payment']
                          ].map(([tabId, label]) => (
                            <button
                              key={tabId}
                              onClick={() => setNewBookingTab(tabId)}
                              style={{
                                padding: '8px 14px',
                                borderRadius: '8px',
                                border: `1px solid ${newBookingTab === tabId ? TavariStyles.colors.primary : TavariStyles.colors.gray300}`,
                                backgroundColor: newBookingTab === tabId ? TavariStyles.colors.primary : 'white',
                                color: newBookingTab === tabId ? 'white' : TavariStyles.colors.gray800,
                                fontSize: '13px',
                                fontWeight: '600',
                                cursor: 'pointer'
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>

                        {newBookingTab === 'customer' && (
                          <>
                            <ScheduleNewBookingCustomerFields
                              customerId={newBookingData.customerId}
                              customerFirstName={newBookingData.customerFirstName}
                              customerLastName={newBookingData.customerLastName}
                              customerEmail={newBookingData.customerEmail}
                              customerPhone={newBookingData.customerPhone}
                              gridTemplateColumns={bookingModalTwoColumnGrid}
                              contentMaxWidth={bookingModalContentMaxWidth}
                              onFieldsChange={handleDeferredCustomerFields}
                              liveFieldsRef={customerFieldsLiveRef}
                              syncVersion={customerFieldsSyncVersion}
                            />

                            {(customerLookupLoading || customerSuggestions.length > 0) && (
                              <div style={{
                                width: '100%',
                                maxWidth: bookingModalContentMaxWidth,
                                border: '1px solid #e5e7eb',
                                borderRadius: '10px',
                                backgroundColor: 'white',
                                overflow: 'hidden'
                              }}>
                                {customerLookupLoading && (
                                  <div style={{ padding: '12px 14px', fontSize: '13px' }}>
                                    Searching customers...
                                  </div>
                                )}
                                {!customerLookupLoading && customerSuggestions.map((customer) => (
                                  <button
                                    key={customer.id}
                                    onClick={() => selectSuggestedCustomer(customer)}
                                    style={{
                                      width: '100%',
                                      padding: '12px 14px',
                                      border: 'none',
                                      borderBottom: '1px solid #f3f4f6',
                                      backgroundColor: 'white',
                                      textAlign: 'left',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    <div style={{ fontWeight: '600', color: TavariStyles.colors.gray900 }}>
                                      {customer.customer_name || customer.customer_email || customer.customer_phone || 'Customer'}
                                    </div>
                                    <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600 }}>
                                      {[customer.customer_email, customer.customer_phone].filter(Boolean).join(' | ')}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}

                            <div style={{ width: '100%', maxWidth: bookingModalContentMaxWidth }}>
                              <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 12,
                                marginBottom: '10px',
                                flexWrap: 'wrap',
                              }}>
                                <div style={{
                                  fontSize: '13px',
                                  fontWeight: '600',
                                  color: TavariStyles.colors.gray900,
                                }}>
                                  Participants
                                </div>
                                <button
                                  type="button"
                                  onClick={addManualParticipant}
                                  style={{
                                    padding: '8px 12px',
                                    borderRadius: 8,
                                    border: 'none',
                                    background: TavariStyles.colors.primary,
                                    color: '#fff',
                                    fontWeight: 600,
                                    fontSize: 13,
                                    cursor: 'pointer',
                                  }}
                                >
                                  + Add participant
                                </button>
                              </div>
                              <p style={{
                                margin: '0 0 12px',
                                fontSize: 13,
                                color: TavariStyles.colors.gray600,
                                lineHeight: 1.45,
                              }}>
                                Select linked people from an existing customer account, or add participants manually and choose their tickets.
                                New customers are created automatically when you enter email or phone and save the booking.
                              </p>

                              {linkedParticipants.length === 0 && manualParticipants.length === 0 ? (
                                <div style={{
                                  padding: '14px 16px',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: '10px',
                                  backgroundColor: '#f9fafb',
                                  fontSize: '13px',
                                  marginBottom: 12,
                                }}>
                                  No participants yet. Search an existing customer above, or click <strong>Add participant</strong> to enter people manually.
                                </div>
                              ) : null}

                              {linkedParticipants.length > 0 ? (
                                <div style={{
                                  border: '1px solid #e5e7eb',
                                  borderRadius: '10px',
                                  overflow: 'hidden',
                                  backgroundColor: 'white',
                                  marginBottom: 12,
                                }}>
                                  {linkedParticipants.map((participant) => {
                                    const participantKey = participantSelectionKey(participant);
                                    const fullName = [participant.first_name, participant.last_name].filter(Boolean).join(' ') || 'Participant';
                                    const participantMeta = [participant.participant_type, participant.date_of_birth].filter(Boolean).join(' | ');
                                    const selected = selectedParticipantKeys.includes(participantKey);
                                    const assignedTicketId = participantTicketByKey[participantKey]
                                      || scheduleParticipantTicketAssignmentResult.participantAssignments?.[participantKey]?.inventory_item_id
                                      || '';
                                    return (
                                      <div
                                        key={participantKey}
                                        style={{
                                          display: 'flex',
                                          flexDirection: 'column',
                                          gap: 8,
                                          padding: '12px 14px',
                                          borderBottom: '1px solid #f3f4f6'
                                        }}
                                      >
                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                                          <TavariCheckbox
                                            checked={selected}
                                            onChange={() => toggleParticipantSelection(participant)}
                                            id={`booking-participant-${participantKey}`}
                                            name={`booking-participant-${participantKey}`}
                                            size="md"
                                            style={{ marginTop: '2px', flexShrink: 0 }}
                                          />
                                          <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: '600', color: TavariStyles.colors.gray900 }}>
                                              {fullName}
                                            </div>
                                            {participantMeta ? (
                                              <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600 }}>
                                                {participantMeta}
                                              </div>
                                            ) : null}
                                          </div>
                                        </div>
                                        {selected && scheduleTicketInventoryItems.length > 0 ? (
                                          <select
                                            value={assignedTicketId || ''}
                                            onChange={(e) => setParticipantTicket(participantKey, e.target.value || null)}
                                            style={{
                                              marginLeft: 36,
                                              width: 'calc(100% - 36px)',
                                              padding: '8px 10px',
                                              borderRadius: 8,
                                              border: `1px solid ${TavariStyles.colors.gray300}`,
                                              fontSize: 13,
                                              background: '#fff',
                                            }}
                                          >
                                            <option value="">Select ticket…</option>
                                            {scheduleTicketInventoryItems.map((item) => (
                                              <option key={item.id} value={item.id}>
                                                {item.name || 'Ticket'}
                                                {item.price != null ? ` — $${Number(item.price || 0).toFixed(2)}` : ''}
                                              </option>
                                            ))}
                                          </select>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}

                              {manualParticipants.map((participant) => {
                                const assignedTicketId = participantTicketByKey[participant.id]
                                  || participant.inventory_item_id
                                  || scheduleParticipantTicketAssignmentResult.participantAssignments?.[participant.id]?.inventory_item_id
                                  || '';
                                return (
                                  <div
                                    key={participant.id}
                                    style={{
                                      padding: 14,
                                      border: '1px solid #e5e7eb',
                                      borderRadius: 10,
                                      background: '#fff',
                                      marginBottom: 10,
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: 10,
                                    }}
                                  >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <strong style={{ fontSize: 13, color: TavariStyles.colors.gray800 }}>Manual participant</strong>
                                      <button
                                        type="button"
                                        onClick={() => removeManualParticipant(participant.id)}
                                        style={{
                                          border: 'none',
                                          background: 'transparent',
                                          color: '#b91c1c',
                                          cursor: 'pointer',
                                          fontWeight: 600,
                                          fontSize: 13,
                                        }}
                                      >
                                        Remove
                                      </button>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: bookingModalTwoColumnGrid, gap: 10 }}>
                                      <input
                                        type="text"
                                        placeholder="First name *"
                                        value={participant.first_name || ''}
                                        onChange={(e) => updateManualParticipant(participant.id, { first_name: e.target.value })}
                                        style={{ padding: '8px 10px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: 8, fontSize: 14 }}
                                      />
                                      <input
                                        type="text"
                                        placeholder="Last name"
                                        value={participant.last_name || ''}
                                        onChange={(e) => updateManualParticipant(participant.id, { last_name: e.target.value })}
                                        style={{ padding: '8px 10px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: 8, fontSize: 14 }}
                                      />
                                      <input
                                        type="date"
                                        value={participant.date_of_birth || ''}
                                        onChange={(e) => updateManualParticipant(participant.id, { date_of_birth: e.target.value })}
                                        style={{ padding: '8px 10px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: 8, fontSize: 14 }}
                                      />
                                      <select
                                        value={participant.participant_type || 'minor'}
                                        onChange={(e) => updateManualParticipant(participant.id, { participant_type: e.target.value })}
                                        style={{ padding: '8px 10px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: 8, fontSize: 14, background: '#fff' }}
                                      >
                                        <option value="minor">Child / minor</option>
                                        <option value="adult">Adult</option>
                                      </select>
                                    </div>
                                    {scheduleTicketInventoryItems.length > 0 ? (
                                      <select
                                        value={assignedTicketId || ''}
                                        onChange={(e) => setParticipantTicket(participant.id, e.target.value || null)}
                                        style={{
                                          width: '100%',
                                          padding: '8px 10px',
                                          borderRadius: 8,
                                          border: `1px solid ${TavariStyles.colors.gray300}`,
                                          fontSize: 13,
                                          background: '#fff',
                                        }}
                                      >
                                        <option value="">Select ticket…</option>
                                        {scheduleTicketInventoryItems.map((item) => (
                                          <option key={item.id} value={item.id}>
                                            {item.name || 'Ticket'}
                                            {item.price != null ? ` — $${Number(item.price || 0).toFixed(2)}` : ''}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <div style={{ fontSize: 13, color: TavariStyles.colors.gray600 }}>
                                        No tickets configured for this activity yet.
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            {staffTicketLimits.enforced && (
                              <StaffBookingTicketLimitsPanel
                                limits={staffTicketLimits}
                                participantCount={scheduleStaffParticipantCount}
                                overrideActive={staffTicketLimitOverride}
                                onOverrideChange={setStaffTicketLimitOverride}
                                canOverride={canOverrideTicketLimits}
                                style={{ width: '100%', maxWidth: bookingModalContentMaxWidth }}
                              />
                            )}
                          </>
                        )}

                        {newBookingTab === 'booking' && (
                          <>
                            {availableBookingDates.length === 0 ? (
                              <div style={{
                                width: '100%',
                                maxWidth: bookingModalContentMaxWidth,
                                padding: '14px 16px',
                                border: '1px solid #e5e7eb',
                                borderRadius: '10px',
                                backgroundColor: '#f9fafb',
                                fontSize: '13px',
                                color: TavariStyles.colors.gray600
                              }}>
                                No available booking dates were found for this activity.
                              </div>
                            ) : (
                              <>
                                <div style={{ width: '100%', maxWidth: bookingModalContentMaxWidth, position: 'relative' }}>
                                  <div style={{ fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray900, marginBottom: '8px' }}>
                                    Booking Date
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (newBookingData.bookingDate) {
                                        setNewBookingCalendarMonth(dayjs.tz(newBookingData.bookingDate, businessTimezone).toDate());
                                      }
                                      setNewBookingCalendarOpen((prev) => !prev);
                                    }}
                                    style={{
                                      width: '100%',
                                      padding: '10px 12px',
                                      border: `1px solid ${TavariStyles.colors.gray300}`,
                                      borderRadius: '8px',
                                      fontSize: '14px',
                                      backgroundColor: 'white',
                                      textAlign: 'left',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    {newBookingData.bookingDate
                                      ? formatDateForBusiness(dayjs.tz(newBookingData.bookingDate, businessTimezone).toDate(), businessTimezone, {
                                          weekday: 'short',
                                          month: 'short',
                                          day: 'numeric',
                                          year: 'numeric'
                                        })
                                      : 'Select a date'}
                                  </button>

                                  {newBookingCalendarOpen && (
                                    <div style={{
                                      position: 'absolute',
                                      top: '100%',
                                      left: 0,
                                      marginTop: '8px',
                                      width: '320px',
                                      padding: '14px',
                                      border: '1px solid #e5e7eb',
                                      borderRadius: '12px',
                                      backgroundColor: 'white',
                                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                                      zIndex: 20
                                    }}>
                                      <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        marginBottom: '12px'
                                      }}>
                                        <button
                                          type="button"
                                          onClick={() => setNewBookingCalendarMonth((prev) => dayjs(prev).subtract(1, 'month').toDate())}
                                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px' }}
                                        >
                                          <FiChevronLeft size={18} />
                                        </button>
                                        <div style={{ fontSize: '14px', fontWeight: '600', color: TavariStyles.colors.gray900 }}>
                                          {newBookingCalendarMonthLabel}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => setNewBookingCalendarMonth((prev) => dayjs(prev).add(1, 'month').toDate())}
                                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px' }}
                                        >
                                          <FiChevronRight size={18} />
                                        </button>
                                      </div>

                                      <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(7, 1fr)',
                                        gap: '6px',
                                        marginBottom: '8px'
                                      }}>
                                        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, idx) => (
                                          <div
                                            key={`${label}-${idx}`}
                                            style={{
                                              textAlign: 'center',
                                              fontSize: '11px',
                                              fontWeight: '700',
                                              color: TavariStyles.colors.gray500
                                            }}
                                          >
                                            {label}
                                          </div>
                                        ))}
                                      </div>

                                      <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(7, 1fr)',
                                        gap: '6px'
                                      }}>
                                        {newBookingCalendarDays.map((date, idx) => {
                                          if (!date) {
                                            return <div key={`blank-${idx}`} style={{ height: '34px' }} />;
                                          }

                                          const dateKey = dayjs(date).tz(businessTimezone).format('YYYY-MM-DD');
                                          const isAvailable = availableBookingDateKeys.has(dateKey);
                                          const isCurrentSelection = newBookingData.bookingDate === dateKey;

                                          return (
                                            <button
                                              key={dateKey}
                                              type="button"
                                              disabled={!isAvailable}
                                              onClick={() => {
                                                setNewBookingData((prev) => ({
                                                  ...prev,
                                                  bookingDate: dateKey,
                                                  bookingTime: ''
                                                }));
                                                setNewBookingCalendarOpen(false);
                                              }}
                                              style={{
                                                height: '34px',
                                                borderRadius: '8px',
                                                border: `1px solid ${isCurrentSelection ? TavariStyles.colors.primary : '#e5e7eb'}`,
                                                backgroundColor: isCurrentSelection
                                                  ? TavariStyles.colors.primary
                                                  : isAvailable ? 'white' : '#f3f4f6',
                                                color: isCurrentSelection
                                                  ? 'white'
                                                  : isAvailable ? TavariStyles.colors.gray900 : TavariStyles.colors.gray400,
                                                cursor: isAvailable ? 'pointer' : 'not-allowed',
                                                fontSize: '13px',
                                                fontWeight: isCurrentSelection ? '700' : '500'
                                              }}
                                            >
                                              {date.getDate()}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>

                                <div style={{ width: '100%', maxWidth: bookingModalContentMaxWidth }}>
                                  <div style={{ fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray900, marginBottom: '8px' }}>
                                    Booking Time
                                  </div>
                                  {availableBookingTimes.length === 0 ? (
                                    <div style={{
                                      padding: '14px 16px',
                                      border: '1px solid #e5e7eb',
                                      borderRadius: '10px',
                                      backgroundColor: '#f9fafb',
                                      fontSize: '13px',
                                      color: TavariStyles.colors.gray600,
                                    }}
                                    >
                                      No time slots for this date.
                                    </div>
                                  ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                      {availableBookingTimes.map((schedule) => {
                                        const timeValue = normalizeTime(schedule.start_time);
                                        const isBookable = schedule.available > 0;
                                        const isSelected = normalizeTime(newBookingData.bookingTime) === timeValue;
                                        const statusLabel = !isBookable
                                          ? (schedule.roomBlocked ? 'Rooms in use' : 'Unavailable')
                                          : schedule.total > 1
                                            ? `${schedule.available} spaces left`
                                            : 'Available';
                                        return (
                                          <button
                                            key={`${schedule.id}-${schedule.start_time}`}
                                            type="button"
                                            disabled={!isBookable}
                                            onClick={() => {
                                              if (!isBookable) return;
                                              setNewBookingData((prev) => ({ ...prev, bookingTime: timeValue }));
                                            }}
                                            style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'space-between',
                                              width: '100%',
                                              padding: '14px 18px',
                                              borderRadius: 10,
                                              border: isSelected
                                                ? `2px solid ${TavariStyles.colors.primary}`
                                                : '1px solid #e5e7eb',
                                              backgroundColor: !isBookable
                                                ? '#f3f4f6'
                                                : isSelected
                                                  ? `${TavariStyles.colors.primary}15`
                                                  : '#f9fafb',
                                              cursor: isBookable ? 'pointer' : 'not-allowed',
                                              textAlign: 'left',
                                            }}
                                          >
                                            <span style={{
                                              fontSize: 16,
                                              fontWeight: isBookable ? 600 : 500,
                                              color: isBookable ? TavariStyles.colors.gray900 : TavariStyles.colors.gray400,
                                            }}
                                            >
                                              {formatScheduleTime(schedule.start_time)}
                                            </span>
                                            <span style={{
                                              fontSize: 14,
                                              fontWeight: isBookable ? 500 : 600,
                                              color: TavariStyles.colors.gray400,
                                            }}
                                            >
                                              {statusLabel}
                                            </span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                  {availableBookingTimes.length > 0
                                    && availableBookingTimes.every((schedule) => schedule.available <= 0) ? (
                                    <div style={{ marginTop: 8, fontSize: 13, color: TavariStyles.colors.gray600 }}>
                                      All times on this date are unavailable. Try another date.
                                    </div>
                                  ) : null}
                                </div>
                              </>
                            )}

                            <div style={{ width: '100%', maxWidth: bookingModalContentMaxWidth }}>
                              <div style={{ fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray900, marginBottom: '8px' }}>
                                Booking Type
                              </div>
                              <select
                                value={newBookingData.bookingTypeId}
                                onChange={(e) => setNewBookingData((prev) => ({ ...prev, bookingTypeId: e.target.value }))}
                                style={{
                                  width: '100%',
                                  padding: '10px 12px',
                                  border: `1px solid ${TavariStyles.colors.gray300}`,
                                  borderRadius: '8px',
                                  fontSize: '14px',
                                  boxSizing: 'border-box',
                                  backgroundColor: 'white'
                                }}
                              >
                                <option value="">Select a booking type...</option>
                                {bookingTypes.filter((type) => type.is_active).map((type) => (
                                  <option key={type.id} value={type.id}>
                                    {type.display_name || type.type_name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div style={{ width: '100%', maxWidth: bookingModalContentMaxWidth }}>
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '12px',
                                marginBottom: '10px',
                                flexWrap: 'wrap'
                              }}>
                                <div>
                                  <div style={{ fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray900 }}>
                                    Additional Items
                                  </div>
                                  <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: '2px' }}>
                                    Add manual line items for this booking when needed.
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={addAdditionalBookingItem}
                                  style={{
                                    padding: '8px 14px',
                                    borderRadius: '8px',
                                    border: `1px solid ${TavariStyles.colors.primary}`,
                                    backgroundColor: 'white',
                                    color: TavariStyles.colors.primary,
                                    fontSize: '13px',
                                    fontWeight: '600',
                                    cursor: 'pointer'
                                  }}
                                >
                                  Add Item
                                </button>
                              </div>

                              {bookingAdditionalItems.length === 0 ? (
                                <div style={{
                                  padding: '14px 16px',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: '10px',
                                  backgroundColor: '#f9fafb',
                                  fontSize: '13px',
                                  color: TavariStyles.colors.gray600
                                }}>
                                  No additional items added.
                                </div>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                  {bookingAdditionalItems.map((item) => (
                                    (() => {
                                      const selectedTaxRateIds = Array.isArray(item.taxRateIds)
                                        ? item.taxRateIds
                                        : item.taxRateId ? [item.taxRateId] : [];
                                      const selectedTaxRates = bookingItemTaxRates.filter((taxRate) => selectedTaxRateIds.includes(taxRate.id));
                                      const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
                                      const unitPrice = Number.parseFloat(item.unitPrice) || 0;
                                      const subtotal = quantity * unitPrice;
                                      const totalTaxRate = selectedTaxRates.reduce((sum, taxRate) => sum + (Number(taxRate?.rate) || 0), 0);
                                      const taxAmount = subtotal * totalTaxRate;
                                      const total = subtotal + taxAmount;
                                      const selectedTaxSummary = selectedTaxRates.length > 0
                                        ? selectedTaxRates.map((taxRate) => `${taxRate.name} (${((Number(taxRate.rate) || 0) * 100).toFixed(2)}%)`).join(', ')
                                        : 'No tax selected';

                                      return (
                                        <div
                                          key={item.id}
                                          style={{
                                            border: '1px solid #e5e7eb',
                                            borderRadius: '10px',
                                            padding: '14px',
                                            backgroundColor: 'white'
                                          }}
                                        >
                                          <div style={{
                                            display: 'grid',
                                            gridTemplateColumns: bookingAdditionalItemGridColumns,
                                            gap: '12px',
                                            alignItems: 'end'
                                          }}>
                                            <div>
                                              <div style={{ fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray900, marginBottom: '6px' }}>
                                                Description
                                              </div>
                                              <input
                                                type="text"
                                                value={item.description}
                                                onChange={(e) => updateAdditionalBookingItem(item.id, 'description', e.target.value)}
                                                placeholder="Item description"
                                                style={{
                                                  width: '100%',
                                                  padding: '10px 12px',
                                                  border: `1px solid ${TavariStyles.colors.gray300}`,
                                                  borderRadius: '8px',
                                                  fontSize: '14px',
                                                  boxSizing: 'border-box',
                                                  backgroundColor: 'white'
                                                }}
                                              />
                                            </div>
                                            <div>
                                              <div style={{ fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray900, marginBottom: '6px' }}>
                                                Quantity
                                              </div>
                                              <input
                                                type="number"
                                                min="1"
                                                step="1"
                                                value={item.quantity}
                                                onChange={(e) => updateAdditionalBookingItem(item.id, 'quantity', e.target.value)}
                                                style={{
                                                  width: '100%',
                                                  padding: '10px 12px',
                                                  border: `1px solid ${TavariStyles.colors.gray300}`,
                                                  borderRadius: '8px',
                                                  fontSize: '14px',
                                                  boxSizing: 'border-box',
                                                  backgroundColor: 'white'
                                                }}
                                              />
                                            </div>
                                            <div>
                                              <div style={{ fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray900, marginBottom: '6px' }}>
                                                Unit Price
                                              </div>
                                              <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={item.unitPrice}
                                                onChange={(e) => updateAdditionalBookingItem(item.id, 'unitPrice', e.target.value)}
                                                placeholder="0.00"
                                                style={{
                                                  width: '100%',
                                                  padding: '10px 12px',
                                                  border: `1px solid ${TavariStyles.colors.gray300}`,
                                                  borderRadius: '8px',
                                                  fontSize: '14px',
                                                  boxSizing: 'border-box',
                                                  backgroundColor: 'white'
                                                }}
                                              />
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => removeAdditionalBookingItem(item.id)}
                                              style={{
                                                padding: '10px 12px',
                                                borderRadius: '8px',
                                                border: '1px solid #ef4444',
                                                backgroundColor: 'white',
                                                color: '#ef4444',
                                                fontSize: '13px',
                                                fontWeight: '600',
                                                cursor: 'pointer'
                                              }}
                                            >
                                              Remove
                                            </button>
                                          </div>

                                          <div style={{ marginTop: '14px' }}>
                                            <div style={{ fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray900, marginBottom: '8px' }}>
                                              Taxes
                                            </div>
                                            {bookingItemTaxRates.length === 0 ? (
                                              <div style={{
                                                padding: '12px 14px',
                                                border: '1px solid #e5e7eb',
                                                borderRadius: '8px',
                                                backgroundColor: '#f9fafb',
                                                fontSize: '13px',
                                                color: TavariStyles.colors.gray600
                                              }}>
                                                No active tax rates found for this business.
                                              </div>
                                            ) : (
                                              <div style={{
                                                display: 'grid',
                                                gridTemplateColumns: bookingAdditionalItemTaxGridColumns,
                                                gap: '10px',
                                                padding: '12px 14px',
                                                border: '1px solid #e5e7eb',
                                                borderRadius: '8px',
                                                backgroundColor: '#f9fafb'
                                              }}>
                                                {bookingItemTaxRates.map((taxRate) => (
                                                  <TavariCheckbox
                                                    key={`${item.id}-${taxRate.id}`}
                                                    id={`booking-addon-tax-${item.id}-${taxRate.id}`}
                                                    name={`booking-addon-tax-${item.id}`}
                                                    checked={selectedTaxRateIds.includes(taxRate.id)}
                                                    onChange={(checked) => toggleAdditionalBookingItemTax(item.id, taxRate.id, checked)}
                                                    label={`${taxRate.name} (${((Number(taxRate.rate) || 0) * 100).toFixed(2)}%)`}
                                                    size="md"
                                                    appearance="native"
                                                    style={{ alignItems: 'center' }}
                                                    labelStyle={{ fontWeight: '500', color: TavariStyles.colors.gray800 }}
                                                  />
                                                ))}
                                              </div>
                                            )}
                                          </div>

                                          <div style={{
                                            marginTop: '10px',
                                            fontSize: '13px',
                                            color: TavariStyles.colors.gray600
                                          }}>
                                            {`Subtotal $${subtotal.toFixed(2)} | Tax $${taxAmount.toFixed(2)} | Total $${total.toFixed(2)} | ${selectedTaxSummary}`}
                                          </div>
                                        </div>
                                      );
                                    })()
                                  ))}
                                </div>
                              )}
                            </div>
                            <div style={{
                              width: '100%',
                              maxWidth: bookingModalContentMaxWidth,
                              fontSize: '13px',
                              color: TavariStyles.colors.gray600
                            }}>
                              Only bookable dates and times with remaining availability are shown.
                            </div>
                          </>
                        )}

                        {newBookingTab === 'notes' && (
                          <div style={{ width: '100%', maxWidth: bookingModalContentMaxWidth }}>
                            <div style={{ fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray900, marginBottom: '8px' }}>
                              Notes
                            </div>
                            <textarea
                              rows={6}
                              value={newBookingData.notes}
                              onChange={(e) => {
                                const notes = e.target.value;
                                setNewBookingData((prev) => (
                                  prev.notes === notes ? prev : { ...prev, notes }
                                ));
                              }}
                              placeholder="Booking notes..."
                              style={{
                                width: '100%',
                                padding: '10px 12px',
                                border: `1px solid ${TavariStyles.colors.gray300}`,
                                borderRadius: '8px',
                                fontSize: '14px',
                                boxSizing: 'border-box',
                                fontFamily: 'inherit',
                                resize: 'vertical',
                                backgroundColor: 'white'
                              }}
                            />
                          </div>
                        )}

                        {newBookingTab === 'payment' && (
                          <>
                            <div style={{ width: '100%', maxWidth: bookingModalContentMaxWidth }}>
                              <div style={{ fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray900, marginBottom: '10px' }}>
                                Customer Account
                              </div>
                              <div style={{
                                padding: '16px',
                                border: '1px solid #e5e7eb',
                                borderRadius: '10px',
                                backgroundColor: 'white',
                                width: '100%',
                                maxWidth: bookingModalContentMaxWidth,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px'
                              }}>
                                {newBookingData.customerId ? (
                                  <>
                                    <div style={{ fontSize: '15px', fontWeight: '600', color: TavariStyles.colors.gray900 }}>
                                      {[newBookingData.customerFirstName, newBookingData.customerLastName].filter(Boolean).join(' ') || 'Selected customer'}
                                    </div>
                                    <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600 }}>
                                      {[newBookingData.customerEmail, newBookingData.customerPhone].filter(Boolean).join(' | ') || 'Customer account selected'}
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600 }}>
                                      No customer account is selected yet.
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setNewBookingTab('customer')}
                                      style={{
                                        alignSelf: 'flex-start',
                                        padding: '10px 16px',
                                        borderRadius: '8px',
                                        border: `1px solid ${TavariStyles.colors.primary}`,
                                        backgroundColor: 'white',
                                        color: TavariStyles.colors.primary,
                                        fontSize: '13px',
                                        fontWeight: '600',
                                        cursor: 'pointer'
                                      }}
                                    >
                                      Go To Customer Tab
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                            <div style={{ width: '100%', maxWidth: bookingModalContentMaxWidth }}>
                              <div style={{ fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray900, marginBottom: '10px' }}>
                                Helcim Payment Method
                              </div>

                              {!newBookingData.customerId ? (
                                <div style={{
                                  padding: '14px 16px',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: '10px',
                                  backgroundColor: '#f9fafb',
                                  fontSize: '13px',
                                  color: TavariStyles.colors.gray600,
                                  width: '100%',
                                  maxWidth: bookingModalContentMaxWidth
                                }}>
                                  Select a customer account first, then use the Helcim button below to securely add or update the card on file.
                                </div>
                              ) : storedHelcimCardLoading ? (
                                <div style={{
                                  padding: '14px 16px',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: '10px',
                                  backgroundColor: '#f9fafb',
                                  fontSize: '13px',
                                  color: TavariStyles.colors.gray600,
                                  width: '100%',
                                  maxWidth: bookingModalContentMaxWidth
                                }}>
                                  Loading saved Helcim payment details...
                                </div>
                              ) : (
                                <div style={{
                                  padding: '16px',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: '10px',
                                  backgroundColor: 'white',
                                  width: '100%',
                                  maxWidth: bookingModalContentMaxWidth,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '10px'
                                }}>
                                  {storedHelcimCard?.maskedCard ? (
                                    <>
                                      <div style={{ fontSize: '15px', fontWeight: '600', color: TavariStyles.colors.gray900 }}>
                                        {storedHelcimCard.cardType
                                          ? `${storedHelcimCard.cardType} ending in ${storedHelcimCard.lastFour || 'unknown'}`
                                          : `Card ending in ${storedHelcimCard.lastFour || 'unknown'}`}
                                      </div>
                                      <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600 }}>
                                        {storedHelcimCard.cardExpiry
                                          ? `Stored in Helcim • Exp ${storedHelcimCard.cardExpiry}`
                                          : 'Stored in Helcim'}
                                      </div>
                                    </>
                                  ) : (
                                    <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600 }}>
                                      No saved payment method found in Helcim for this customer yet.
                                    </div>
                                  )}

                                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                    <button
                                      type="button"
                                      onClick={startHelcimCardVault}
                                      disabled={helcimCardSaving}
                                      style={{
                                        alignSelf: 'flex-start',
                                        padding: '10px 16px',
                                        borderRadius: '8px',
                                        border: `1px solid ${TavariStyles.colors.primary}`,
                                        backgroundColor: helcimCardSaving ? '#e5e7eb' : TavariStyles.colors.primary,
                                        color: helcimCardSaving ? TavariStyles.colors.gray600 : 'white',
                                        fontSize: '13px',
                                        fontWeight: '600',
                                        cursor: helcimCardSaving ? 'not-allowed' : 'pointer'
                                      }}
                                    >
                                      {helcimCardSaving
                                        ? 'Opening Helcim...'
                                        : storedHelcimCard?.maskedCard
                                          ? 'Open Helcim To Update Card'
                                          : 'Open Helcim To Add Card'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => fetchStoredHelcimCard(newBookingData.customerId)}
                                      disabled={storedHelcimCardLoading || helcimCardSaving}
                                      style={{
                                        alignSelf: 'flex-start',
                                        padding: '10px 16px',
                                        borderRadius: '8px',
                                        border: '1px solid #d1d5db',
                                        backgroundColor: 'white',
                                        color: TavariStyles.colors.gray800,
                                        fontSize: '13px',
                                        fontWeight: '600',
                                        cursor: storedHelcimCardLoading || helcimCardSaving ? 'not-allowed' : 'pointer'
                                      }}
                                    >
                                      Refresh Saved Card
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                            <div style={{ width: '100%', maxWidth: bookingModalContentMaxWidth }}>
                              <div style={{ fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray900, marginBottom: '8px' }}>
                                Payment Status
                              </div>
                              <select
                                value={newBookingData.paymentStatus}
                                onChange={(e) => setNewBookingData((prev) => ({ ...prev, paymentStatus: e.target.value }))}
                                style={{
                                  width: '100%',
                                  padding: '10px 12px',
                                  border: `1px solid ${TavariStyles.colors.gray300}`,
                                  borderRadius: '8px',
                                  fontSize: '14px',
                                  boxSizing: 'border-box',
                                  backgroundColor: 'white'
                                }}
                              >
                                <option value="unpaid">Unpaid</option>
                                <option value="partial">Partial</option>
                                <option value="paid">Paid</option>
                              </select>
                            </div>
                            <div style={{
                              padding: '14px 16px',
                              border: '1px solid #e5e7eb',
                              borderRadius: '10px',
                              backgroundColor: '#f9fafb',
                              fontSize: '13px',
                              width: '100%',
                              maxWidth: bookingModalContentMaxWidth
                            }}>
                              Card details are collected inside Helcim's hosted secure form and only masked payment details are shown back in Tavari.
                            </div>
                          </>
                        )}

                        <div style={{ display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
                          <button
                            onClick={handleCreateBookingFromSlot}
                            disabled={newBookingSubmitting}
                            style={{
                              padding: '10px 18px',
                              backgroundColor: newBookingSubmitting ? TavariStyles.colors.gray400 : TavariStyles.colors.primary,
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              fontSize: '14px',
                              fontWeight: '600',
                              cursor: newBookingSubmitting ? 'not-allowed' : 'pointer'
                            }}
                          >
                            {newBookingSubmitting ? 'Creating...' : 'Create Booking'}
                          </button>
                          <button
                            onClick={() => setSlotModalMode('details')}
                            disabled={newBookingSubmitting}
                            style={{
                              padding: '10px 18px',
                              backgroundColor: 'white',
                              color: TavariStyles.colors.primary,
                              border: `1px solid ${TavariStyles.colors.primary}`,
                              borderRadius: '8px',
                              fontSize: '14px',
                              fontWeight: '600',
                              cursor: newBookingSubmitting ? 'not-allowed' : 'pointer'
                            }}
                          >
                            Back to Slot
                          </button>
                        </div>
                      </>
                    )}

                    {slotModalMode === 'email' && (
                      <>
                        <div style={{
                          fontSize: '18px',
                          fontWeight: '600',
                          color: TavariStyles.colors.gray900,
                          marginBottom: '8px',
                        }}
                        >
                          Email customers for this slot
                        </div>
                        <div style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginBottom: '16px', lineHeight: 1.5 }}>
                          Send a confirmation or payment request to bookings in this time slot.
                        </div>

                        <div style={{ marginBottom: '16px' }}>
                          <label htmlFor="slot-email-type" style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: 6 }}>
                            Email type
                          </label>
                          <select
                            id="slot-email-type"
                            value={slotEmailType}
                            onChange={(event) => setSlotEmailType(event.target.value)}
                            disabled={slotEmailSending}
                            style={{
                              width: '100%',
                              maxWidth: '320px',
                              padding: '10px 12px',
                              borderRadius: 8,
                              border: `1px solid ${TavariStyles.colors.gray300}`,
                              fontSize: 14,
                              backgroundColor: 'white',
                            }}
                          >
                            <option value="confirmation">Booking confirmation</option>
                            <option value="payment">Payment request (balance due)</option>
                          </select>
                        </div>

                        {(() => {
                          const slotBookings = getBookingsForSelectedScheduleModal();
                          const emailable = slotBookings.filter((row) => String(row.customer_email || '').trim());
                          if (emailable.length === 0) {
                            return (
                              <div style={{
                                padding: '16px',
                                borderRadius: 8,
                                border: `1px dashed ${TavariStyles.colors.gray300}`,
                                color: TavariStyles.colors.gray600,
                                fontSize: 14,
                              }}
                              >
                                No bookings with customer email addresses in this slot.
                              </div>
                            );
                          }
                          return (
                            <div style={{ display: 'grid', gap: 10 }}>
                              {emailable.map((row) => {
                                const displayRow = bookingForParticipantDisplay(row, parentBookingsById);
                                const title = customerDisplayNameForSlotModal(displayRow);
                                const email = String(row.customer_email || '').trim();
                                const checked = slotEmailSelectedIds.has(row.id);
                                return (
                                  <label
                                    key={row.id}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'flex-start',
                                      gap: 10,
                                      padding: '12px 14px',
                                      border: `1px solid ${TavariStyles.colors.gray200}`,
                                      borderRadius: 8,
                                      backgroundColor: checked ? '#f0fdf4' : '#fff',
                                      cursor: slotEmailSending ? 'not-allowed' : 'pointer',
                                    }}
                                  >
                                    <TavariCheckbox
                                      checked={checked}
                                      onChange={(value) => toggleSlotEmailSelection(row.id, value)}
                                      disabled={slotEmailSending}
                                      size="sm"
                                    />
                                    <span style={{ fontSize: 14, lineHeight: 1.45 }}>
                                      <strong>{title}</strong>
                                      <br />
                                      {email}
                                      {row.booking_number ? (
                                        <>
                                          <br />
                                          <span style={{ color: TavariStyles.colors.gray500, fontSize: 13 }}>
                                            {row.booking_number}
                                          </span>
                                        </>
                                      ) : null}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </>
                    )}

                    {slotModalMode === 'details' && (
                      <>
                        {(() => {
                          const cap = getSelectedSlotBlockContext();
                          if (!cap) return null;
                          return (
                            <div style={{
                              width: '100%',
                              maxWidth: '420px',
                              marginBottom: '16px',
                              padding: '12px 14px',
                              borderRadius: 8,
                              border: '1px solid #e5e7eb',
                              backgroundColor: '#f9fafb',
                              fontSize: 13,
                              lineHeight: 1.5,
                              color: TavariStyles.colors.gray700,
                            }}
                            >
                              <div style={{ fontWeight: 700, color: TavariStyles.colors.gray900, marginBottom: 6 }}>
                                Capacity for this slot
                              </div>
                              <div>
                                <strong>Bookable now:</strong> {cap.total}
                                {cap.nominal != null && cap.nominal > cap.total ? (
                                  <>
                                    {' '}· <strong>Full capacity:</strong> {cap.nominal}
                                    {' '}· <span style={{ color: '#b45309' }}><strong>Blocked:</strong> {cap.blockedSeats}</span>
                                  </>
                                ) : null}
                              </div>
                              <div style={{ marginTop: 4 }}>
                                <strong>Booked:</strong> {cap.bookedCount}
                                {' '}· <strong>Open for new bookings:</strong> {cap.available}
                              </div>
                              <div style={{ marginTop: 8, fontSize: 13, color: TavariStyles.colors.gray500 }}>
                                Use <strong>Block seats…</strong> on the right to take open seats off the pool without cancelling existing bookings.
                              </div>
                            </div>
                          );
                        })()}

                        <div style={{
                          width: '100%',
                          maxWidth: '420px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '16px'
                        }}>
                          <div style={{
                            fontSize: '13px',
                            fontWeight: '600',
                            color: TavariStyles.colors.gray900,
                            minWidth: '110px'
                          }}>
                            Time
                          </div>
                          <BookingTimeSlotSelect
                            value={slotEditorTime}
                            onChange={setSlotEditorTime}
                            operatingHours={operatingHours}
                            dayKey={slotEditorDayKey}
                            format="24h"
                            disabled={slotEditorSaving}
                            placeholder="Select time…"
                            style={{
                              width: '220px',
                              padding: '10px 12px',
                              fontSize: '14px'
                            }}
                          />
                        </div>

                        <div style={{
                          width: '100%',
                          maxWidth: '420px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '16px'
                        }}>
                          <div style={{
                            fontSize: '13px',
                            fontWeight: '600',
                            color: TavariStyles.colors.gray900,
                            minWidth: '110px'
                          }}>
                            How many spaces
                          </div>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={slotEditorSpaces}
                            disabled={slotEditorSaving}
                            onChange={(e) => setSlotEditorSpaces(e.target.value)}
                            style={{
                              width: '220px',
                              padding: '10px 12px',
                              border: `1px solid ${TavariStyles.colors.gray300}`,
                              borderRadius: '8px',
                              fontSize: '14px',
                              boxSizing: 'border-box',
                              backgroundColor: slotEditorSaving ? '#f3f4f6' : 'white'
                            }}
                          />
                        </div>

                        <div
                          style={{
                            marginTop: '8px',
                            paddingTop: '20px',
                            borderTop: `1px solid ${TavariStyles.colors.gray200}`,
                            width: '100%',
                            alignSelf: 'stretch',
                          }}
                        >
                          <div
                            style={{
                              fontSize: '15px',
                              fontWeight: '600',
                              color: TavariStyles.colors.gray900,
                              marginBottom: '12px',
                            }}
                          >
                            Bookings for this slot
                          </div>
                          {(() => {
                            const slotModalBookings = getBookingsForSelectedScheduleModal();
                            if (slotModalBookings.length === 0) {
                              return (
                                <div
                                  style={{
                                    padding: '24px',
                                    textAlign: 'center',
                                    color: TavariStyles.colors.gray600,
                                    fontSize: '14px',
                                    border: `1px dashed ${TavariStyles.colors.gray300}`,
                                    borderRadius: '8px',
                                    backgroundColor: TavariStyles.colors.gray50,
                                  }}
                                >
                                  No bookings for this slot.
                                </div>
                              );
                            }
                            return slotModalBookings.map((booking) => {
                              const displayBooking = bookingForParticipantDisplay(booking, parentBookingsById);
                              const pricing = getSlotModalPricing(booking);
                              const waiverState = getSlotModalWaiverState(displayBooking);
                              const camperRegistrationState = getSlotModalCamperRegistrationState(displayBooking);
                              const needsAttention =
                                !pricing.paymentComplete ||
                                (waiverState.requiresWaiver && !waiverState.waiversVerified) ||
                                (camperRegistrationState.requiresCamperRegistration &&
                                  !camperRegistrationState.registrationsVerified);
                              const cardBg = needsAttention ? '#fff7ed' : '#ffffff';
                              const cardBorder = needsAttention ? '#fed7aa' : '#e5e7eb';
                              const guestLine = formatGuestTicketLine(displayBooking);
                              const customerTitle = customerDisplayNameForSlotModal(displayBooking);
                              const bookingRef = resolveBookingNumberLabel(booking) || booking.id;

                              return (
                                <div
                                  key={booking.id}
                                  style={{
                                    display: 'flex',
                                    flexDirection: 'row',
                                    alignItems: 'stretch',
                                    justifyContent: 'space-between',
                                    gap: 16,
                                    width: '100%',
                                    padding: '16px',
                                    border: `1px solid ${cardBorder}`,
                                    borderRadius: '8px',
                                    marginBottom: '12px',
                                    backgroundColor: cardBg,
                                    boxSizing: 'border-box',
                                  }}
                                >
                                  <div
                                    style={{
                                      flex: 1,
                                      minWidth: 0,
                                      cursor: 'pointer',
                                      textAlign: 'left',
                                    }}
                                    onClick={() => openBookingFromScheduleContext(booking)}
                                  >
                                    <div
                                      style={{
                                        fontWeight: '700',
                                        fontSize: '18px',
                                        color: TavariStyles.colors.gray900,
                                        marginBottom: '10px',
                                      }}
                                    >
                                      {customerTitle}
                                    </div>
                                    <div
                                      style={{
                                        fontSize: '13px',
                                        color: TavariStyles.colors.gray700,
                                        lineHeight: 1.5,
                                        marginBottom: '6px',
                                      }}
                                    >
                                      <strong>Guests:</strong> {guestLine}
                                    </div>
                                    <div
                                      style={{
                                        fontSize: '13px',
                                        color: TavariStyles.colors.gray700,
                                        lineHeight: 1.5,
                                        marginBottom: '6px',
                                      }}
                                    >
                                      <strong>Total Price:</strong> ${pricing.totalPrice.toFixed(2)}
                                      {' · '}
                                      <strong>Total Paid:</strong> ${pricing.totalPaid.toFixed(2)}
                                      {' · '}
                                      <strong>Total Due:</strong> ${pricing.totalDue.toFixed(2)}
                                    </div>
                                    <div style={{ fontSize: '13px', color: TavariStyles.colors.gray700 }}>
                                      <strong>Booking Number:</strong> {bookingRef}
                                    </div>
                                  </div>

                                  <div
                                    style={{
                                      display: 'flex',
                                      flexDirection: 'column',
                                      alignItems: 'flex-end',
                                      gap: 10,
                                      flexShrink: 0,
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <BookingCheckInButton
                                      booking={booking}
                                      onCheckInComplete={handleCheckInComplete}
                                      canCheckIn={canCheckIn}
                                    />
                                    {waiverState.requiresWaiver ? (
                                      waiverState.waiversVerified ? (
                                        <div
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 6,
                                            fontSize: '13px',
                                            fontWeight: 600,
                                            color: '#059669',
                                          }}
                                        >
                                          <FiCheckCircle size={18} aria-hidden />
                                          Waivers verified
                                        </div>
                                      ) : (
                                        <div
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 6,
                                            fontSize: '13px',
                                            fontWeight: 600,
                                            color: '#c2410c',
                                          }}
                                        >
                                          <FiAlertCircle size={18} aria-hidden />
                                          Waivers not verified
                                        </div>
                                      )
                                    ) : (
                                      <div
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 6,
                                          fontSize: '13px',
                                          fontWeight: 600,
                                          color: TavariStyles.colors.gray600,
                                        }}
                                      >
                                        <FiCheckCircle size={18} aria-hidden />
                                        Waivers not required
                                      </div>
                                    )}
                                    {camperRegistrationState.requiresCamperRegistration ? (
                                      camperRegistrationState.registrationsVerified ? (
                                        <div
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 6,
                                            fontSize: '13px',
                                            fontWeight: 600,
                                            color: '#059669',
                                          }}
                                        >
                                          <FiCheckCircle size={18} aria-hidden />
                                          Camper registration complete
                                        </div>
                                      ) : (
                                        <div
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 6,
                                            fontSize: '13px',
                                            fontWeight: 600,
                                            color: '#c2410c',
                                          }}
                                        >
                                          <FiAlertCircle size={18} aria-hidden />
                                          Camper registration missing
                                        </div>
                                      )
                                    ) : null}
                                    <div
                                      style={{
                                        display: 'inline-block',
                                        padding: '4px 12px',
                                        borderRadius: '12px',
                                        fontSize: '13px',
                                        fontWeight: '600',
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
                                      {formatBookingStatusLabel(booking.status)}
                                    </div>
                                  </div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </>
                    )}
                  </div>

                  <div style={{
                    width: bookingModalActionColumnWidth,
                    borderLeft: isCompactModalLayout ? 'none' : '1px solid #e5e7eb',
                    paddingLeft: isCompactModalLayout ? '0' : '20px',
                    paddingTop: isCompactModalLayout ? '20px' : '0',
                    borderTop: isCompactModalLayout ? '1px solid #e5e7eb' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    flexShrink: 0
                  }}>
                    <button
                      onClick={() => setSlotModalMode('new')}
                      style={{ ...styles.viewButton, width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
                    >
                      New
                    </button>
                    <button
                      onClick={handleSaveSlotChanges}
                      disabled={slotEditorSaving || slotModalMode !== 'details'}
                      style={{ ...styles.viewButton, width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
                    >
                      Save
                    </button>
                    <button
                      onClick={slotModalMode === 'details' ? resetSelectedSlotDraft : closeScheduleSlotModal}
                      disabled={slotEditorSaving}
                      style={{ ...styles.viewButton, width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={openBlockSeatsModal}
                      disabled={slotEditorSaving || slotModalMode !== 'details'}
                      style={{ ...styles.viewButton, width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
                    >
                      Block seats…
                    </button>
                    <button
                      onClick={printSelectedSlotSummary}
                      style={{ ...styles.viewButton, width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
                    >
                      Print
                    </button>
                    <button
                      onClick={() => setSlotModalMode('email')}
                      style={{ ...styles.viewButton, width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
                    >
                      Email
                    </button>
                    {slotModalMode === 'email' && (
                      <>
                        <button
                          onClick={handleSendSlotEmails}
                          disabled={slotEmailSending || slotEmailSelectedIds.size === 0}
                          style={{
                            ...styles.viewButton,
                            width: '100%',
                            textAlign: 'left',
                            justifyContent: 'flex-start',
                            opacity: slotEmailSending || slotEmailSelectedIds.size === 0 ? 0.6 : 1,
                          }}
                        >
                          {slotEmailSending ? 'Sending…' : 'Send'}
                        </button>
                        <button
                          onClick={() => setSlotModalMode('details')}
                          disabled={slotEmailSending}
                          style={{ ...styles.viewButton, width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
                        >
                          Back to slot
                        </button>
                      </>
                    )}

                    {slotModalMode === 'new' && (
                      <div style={{
                        marginTop: '12px',
                        padding: '14px 16px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '12px',
                        backgroundColor: '#f9fafb',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px'
                      }}>
                        {newBookingCartDisplayLines.length > 0 && (
                          <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                            paddingBottom: '8px',
                            borderBottom: '1px solid #e5e7eb'
                          }}>
                            {newBookingCartDisplayLines.map((line) => (
                              <div
                                key={line.key}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'flex-start',
                                  gap: '10px'
                                }}
                              >
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray900 }}>
                                    {line.label}
                                  </div>
                                  <div style={{ fontSize: '11px', color: TavariStyles.colors.gray600 }}>
                                    {line.detail}
                                  </div>
                                </div>
                                <div style={{ fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray900, whiteSpace: 'nowrap' }}>
                                  {formatBookingCartCurrency(line.amount)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {newBookingCartSummary.isDeposit && newBookingData.paymentStatus === 'unpaid' && (
                          <div style={{
                            marginBottom: '8px',
                            padding: '10px 12px',
                            borderRadius: '8px',
                            backgroundColor: '#ecfdf5',
                            border: '1px solid #a7f3d0',
                            fontSize: '13px',
                            color: '#065f46',
                          }}>
                            Online deposit for this activity: {formatBookingCartCurrency(newBookingCartSummary.depositDueNow)} now,
                            {formatBookingCartCurrency(newBookingCartSummary.balanceDueAtCheckIn)} at check-in.
                          </div>
                        )}

                        {[
                          ['Sub Total', newBookingCartSummary.subtotal],
                          ['Taxes', newBookingCartSummary.taxes],
                          ['Total Price', newBookingCartSummary.totalPrice],
                          ['Total Paid', newBookingCartSummary.totalPaid],
                          ['Total Due', newBookingCartSummary.totalDue],
                          [newBookingCartSummary.isDeposit && newBookingData.paymentStatus === 'unpaid' ? 'Deposit due now' : 'Due Now', newBookingCartSummary.dueNow]
                        ].map(([label, value], index) => (
                          <div
                            key={label}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: '12px',
                              paddingTop: index === 3 ? '8px' : '0',
                              borderTop: index === 3 ? '1px solid #e5e7eb' : 'none'
                            }}
                          >
                            <div style={{
                              fontSize: '13px',
                              color: label === 'Due Now' ? TavariStyles.colors.gray900 : TavariStyles.colors.gray600,
                              fontWeight: label === 'Total Price' || label === 'Due Now' ? '700' : '500'
                            }}>
                              {label}
                            </div>
                            <div style={{
                              fontSize: '13px',
                              color: TavariStyles.colors.gray900,
                              fontWeight: label === 'Total Price' || label === 'Due Now' ? '700' : '600'
                            }}>
                              {formatBookingCartCurrency(value)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {blockSeatsModalOpen && (() => {
              const blockCtx = getSelectedSlotBlockContext();
              const blockOpen = blockCtx ? blockCtx.available : 0;
              const blockedSeats = blockCtx?.blockedSeats ?? 0;
              const blockAllDisabled =
                slotEditorSaving ||
                !blockCtx ||
                (blockCtx.total > 0 && blockCtx.available === 0) ||
                blockCtx.total === 0;
              const partialDisabled = slotEditorSaving || !blockCtx || blockOpen < 1;
              const restoreDisabled = slotEditorSaving || !blockCtx || blockedSeats < 1;
              return (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  zIndex: 10050,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(15, 23, 42, 0.5)',
                  padding: '16px',
                  boxSizing: 'border-box'
                }}
                onClick={closeBlockSeatsModal}
                role="presentation"
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    padding: '22px',
                    maxWidth: '420px',
                    width: '100%',
                    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
                    border: '1px solid #e5e7eb',
                    position: 'relative'
                  }}
                >
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={closeBlockSeatsModal}
                    style={{
                      position: 'absolute',
                      top: '14px',
                      right: '14px',
                      background: 'none',
                      border: 'none',
                      padding: '6px',
                      cursor: 'pointer',
                      color: TavariStyles.colors.gray500,
                      lineHeight: 1
                    }}
                  >
                    <FiX size={22} />
                  </button>
                  <div style={{ fontSize: '18px', fontWeight: '700', color: TavariStyles.colors.gray900, marginBottom: '4px', paddingRight: '32px' }}>
                    Block seats
                  </div>
                  {!blockCtx ? (
                    <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginBottom: '16px' }}>No slot data.</div>
                  ) : (
                    <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginBottom: '18px' }}>
                      <strong>Bookable {blockCtx.total}</strong>
                      {blockCtx.nominal != null && blockCtx.nominal > blockCtx.total ? (
                        <>
                          {' · '}
                          <span>Full capacity {blockCtx.nominal}</span>
                          {' · '}
                          <span style={{ color: '#b45309' }}>Blocked {blockedSeats}</span>
                        </>
                      ) : null}
                      {' · '}
                      <span>Booked {blockCtx.bookedCount}</span>
                      {' · '}
                      <span>Open {blockCtx.available}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: TavariStyles.colors.gray700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
                        1 · Block all seats
                      </div>
                      <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, margin: '0 0 10px', lineHeight: 1.45 }}>
                        Stops all new bookings for this time. Existing bookings stay. If the slot is empty, it stays on the schedule with no capacity.
                      </p>
                      <button
                        type="button"
                        onClick={handleBlockAllSeats}
                        disabled={blockAllDisabled}
                        style={{
                          width: '100%',
                          padding: '12px 16px',
                          borderRadius: '8px',
                          border: 'none',
                          backgroundColor: blockAllDisabled ? '#e5e7eb' : TavariStyles.colors.primary,
                          color: blockAllDisabled ? TavariStyles.colors.gray500 : 'white',
                          fontSize: '14px',
                          fontWeight: '600',
                          cursor: blockAllDisabled ? 'not-allowed' : 'pointer'
                        }}
                      >
                        Block all seats
                      </button>
                    </div>
                    <div
                      style={{
                        borderTop: '1px solid #e5e7eb',
                        paddingTop: '4px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px'
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: TavariStyles.colors.gray700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
                          2 · Block a number of seats
                        </div>
                        <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, margin: '0 0 10px', lineHeight: 1.45 }}>
                          Reduces how many people can book by this amount (only from seats that are still open).
                        </p>
                      </div>
                      <input
                        type="number"
                        min={1}
                        max={blockOpen > 0 ? blockOpen : undefined}
                        value={blockPartialSeatsCount}
                        onChange={(e) => setBlockPartialSeatsCount(e.target.value)}
                        disabled={partialDisabled}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          border: `1px solid ${TavariStyles.colors.gray300}`,
                          borderRadius: '8px',
                          fontSize: '15px',
                          boxSizing: 'border-box',
                          backgroundColor: partialDisabled ? '#f3f4f6' : 'white'
                        }}
                      />
                      {blockOpen > 0 ? (
                        <div style={{ fontSize: '13px', color: TavariStyles.colors.gray500 }}>
                          Enter 1–{blockOpen} (open seats you can take off the pool right now).
                        </div>
                      ) : blockCtx && blockCtx.total > 0 ? (
                        <div style={{ fontSize: '13px', color: TavariStyles.colors.gray500 }}>
                          No open seats to block. Use &quot;Block all seats&quot; if the slot is not yet full, or add capacity under Save first.
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={handleBlockPartialSeatsConfirm}
                        disabled={partialDisabled}
                        style={{
                          width: '100%',
                          padding: '10px 16px',
                          borderRadius: '8px',
                          border: `1px solid ${partialDisabled ? '#e5e7eb' : TavariStyles.colors.primary}`,
                          backgroundColor: 'white',
                          color: partialDisabled ? TavariStyles.colors.gray400 : TavariStyles.colors.primary,
                          fontSize: '14px',
                          fontWeight: '600',
                          cursor: partialDisabled ? 'not-allowed' : 'pointer'
                        }}
                      >
                        Block this many seats
                      </button>
                    </div>
                    {blockedSeats > 0 ? (
                      <div
                        style={{
                          borderTop: '1px solid #e5e7eb',
                          paddingTop: '16px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '10px',
                        }}
                      >
                        <div style={{ fontSize: '13px', fontWeight: '700', color: TavariStyles.colors.gray700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          3 · Restore blocked seats
                        </div>
                        <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, margin: 0, lineHeight: 1.45 }}>
                          Put admin-blocked seats back on sale (restores bookable capacity to {blockCtx.nominal ?? blockCtx.total}).
                        </p>
                        <button
                          type="button"
                          onClick={handleRestoreBlockedSeats}
                          disabled={restoreDisabled}
                          style={{
                            width: '100%',
                            padding: '10px 16px',
                            borderRadius: '8px',
                            border: `1px solid ${restoreDisabled ? '#e5e7eb' : '#059669'}`,
                            backgroundColor: 'white',
                            color: restoreDisabled ? TavariStyles.colors.gray400 : '#059669',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: restoreDisabled ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Restore {blockedSeats} blocked {blockedSeats === 1 ? 'seat' : 'seats'}
                        </button>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={closeBlockSeatsModal}
                      style={{
                        width: '100%',
                        padding: '8px',
                        border: 'none',
                        background: 'transparent',
                        color: TavariStyles.colors.gray600,
                        fontSize: '13px',
                        cursor: 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
              );
            })()}
          </div>
        )}
        <BookingBusinessHoursOverrideModal
          open={hoursOverrideModal.open}
          reason={hoursOverrideModal.reason}
          onCancel={() => setHoursOverrideModal({ open: false, reason: '' })}
          onApproved={handleHoursOverrideApproved}
        />
        <BookingCategoryCapacityOverrideModal
          open={categoryCapacityOverrideModal.open}
          reason={categoryCapacityOverrideModal.reason}
          onCancel={() => {
            categoryCapacityOverrideIdRef.current = null;
            setCategoryCapacityOverrideModal({ open: false, reason: '' });
          }}
          onApproved={handleCategoryCapacityOverrideApproved}
        />
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default BookingsScheduleView;

