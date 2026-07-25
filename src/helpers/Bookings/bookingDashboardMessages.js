import {
  BOOKING_HISTORY_ACTIONS,
  formatHistoryActionLabel,
  getHistoryChangeLines,
  resolveHistoryActorLabel,
} from './bookingHistory';

const DEFAULT_STYLE = {
  badge: 'Update',
  badgeColor: '#6b7280',
  badgeBg: '#f3f4f6',
};

const ACTION_STYLES = {
  [BOOKING_HISTORY_ACTIONS.CREATED]: {
    badge: 'New booking',
    badgeColor: '#047857',
    badgeBg: '#ecfdf5',
  },
  [BOOKING_HISTORY_ACTIONS.REQUEST_SUBMITTED]: {
    badge: 'Party request',
    badgeColor: '#6d28d9',
    badgeBg: '#f5f3ff',
  },
  [BOOKING_HISTORY_ACTIONS.CANCELLED]: {
    badge: 'Cancelled',
    badgeColor: '#b91c1c',
    badgeBg: '#fef2f2',
  },
  [BOOKING_HISTORY_ACTIONS.RESTORED]: {
    badge: 'Restored',
    badgeColor: '#047857',
    badgeBg: '#ecfdf5',
  },
  [BOOKING_HISTORY_ACTIONS.APPROVED]: {
    badge: 'Approved',
    badgeColor: '#1d4ed8',
    badgeBg: '#eff6ff',
  },
  [BOOKING_HISTORY_ACTIONS.APPROVAL_REVOKED]: {
    badge: 'Approval removed',
    badgeColor: '#b45309',
    badgeBg: '#fffbeb',
  },
  [BOOKING_HISTORY_ACTIONS.SCHEDULE_UPDATED]: {
    badge: 'Schedule',
    badgeColor: '#0369a1',
    badgeBg: '#f0f9ff',
  },
  [BOOKING_HISTORY_ACTIONS.STATUS_CHANGED]: {
    badge: 'Status',
    badgeColor: '#4b5563',
    badgeBg: '#f3f4f6',
  },
  [BOOKING_HISTORY_ACTIONS.CHECK_IN]: {
    badge: 'Checked in',
    badgeColor: '#0f766e',
    badgeBg: '#f0fdfa',
  },
  [BOOKING_HISTORY_ACTIONS.CHECK_IN_CLEARED]: {
    badge: 'Check-in cleared',
    badgeColor: '#6b7280',
    badgeBg: '#f3f4f6',
  },
  [BOOKING_HISTORY_ACTIONS.RESOURCE_UPDATED]: {
    badge: 'Room / resource',
    badgeColor: '#7c3aed',
    badgeBg: '#f5f3ff',
  },
  [BOOKING_HISTORY_ACTIONS.OPTIONS_UPDATED]: {
    badge: 'Order / add-ons',
    badgeColor: '#7c3aed',
    badgeBg: '#f5f3ff',
  },
  [BOOKING_HISTORY_ACTIONS.MANUAL_ITEM_ADDED]: {
    badge: 'Item added',
    badgeColor: '#7c3aed',
    badgeBg: '#f5f3ff',
  },
  [BOOKING_HISTORY_ACTIONS.MANUAL_ITEM_REMOVED]: {
    badge: 'Item removed',
    badgeColor: '#7c3aed',
    badgeBg: '#f5f3ff',
  },
  [BOOKING_HISTORY_ACTIONS.PRICING_UPDATED]: {
    badge: 'Pricing',
    badgeColor: '#b45309',
    badgeBg: '#fffbeb',
  },
  [BOOKING_HISTORY_ACTIONS.PARTICIPANTS_UPDATED]: {
    badge: 'Participants',
    badgeColor: '#0369a1',
    badgeBg: '#f0f9ff',
  },
  [BOOKING_HISTORY_ACTIONS.EXTENDED]: {
    badge: 'Extended',
    badgeColor: '#0369a1',
    badgeBg: '#f0f9ff',
  },
  [BOOKING_HISTORY_ACTIONS.NOTE_ADDED]: {
    badge: 'Note',
    badgeColor: '#6b7280',
    badgeBg: '#f3f4f6',
  },
  [BOOKING_HISTORY_ACTIONS.NOTE_UPDATED]: {
    badge: 'Note',
    badgeColor: '#6b7280',
    badgeBg: '#f3f4f6',
  },
  [BOOKING_HISTORY_ACTIONS.NOTE_DELETED]: {
    badge: 'Note',
    badgeColor: '#6b7280',
    badgeBg: '#f3f4f6',
  },
  [BOOKING_HISTORY_ACTIONS.PAYMENT_RECEIVED]: {
    badge: 'Payment',
    badgeColor: '#047857',
    badgeBg: '#ecfdf5',
  },
  [BOOKING_HISTORY_ACTIONS.TERMS_SIGNED]: {
    badge: 'T&Cs signed',
    badgeColor: '#0369a1',
    badgeBg: '#f0f9ff',
  },
};

function formatActorDisplay(entry, userNames = {}) {
  const label = resolveHistoryActorLabel(entry, userNames);
  if (label === 'Staff user') return 'Staff';
  return label || 'System';
}

export function getDashboardMessageStyle(actionType) {
  return ACTION_STYLES[actionType] || DEFAULT_STYLE;
}

export function buildDashboardMessageFromHistoryEntry(
  entry,
  bookingContext,
  businessTimezone,
  userNames = {},
) {
  const style = getDashboardMessageStyle(entry.action_type);
  const changeLines = getHistoryChangeLines(entry);
  const title = entry.summary?.trim() || formatHistoryActionLabel(entry.action_type);
  const detail = changeLines.length === 0
    ? (entry.summary?.trim() || 'Booking was updated.')
    : null;

  const isCancel = entry.action_type === BOOKING_HISTORY_ACTIONS.CANCELLED;

  return {
    id: `history-${entry.id}`,
    type: entry.action_type,
    timestamp: entry.created_at,
    bookingId: entry.booking_id,
    customerId: bookingContext?.customerId || null,
    bookingRef: bookingContext?.bookingRef || '—',
    badge: style.badge,
    badgeColor: style.badgeColor,
    badgeBg: style.badgeBg,
    title,
    detail,
    changeLines,
    booker: bookingContext?.booker || 'Guest',
    activity: bookingContext?.activity || 'Activity',
    visitDate: bookingContext?.visitDate || '—',
    visitTime: bookingContext?.visitTime || '—',
    tickets: bookingContext?.tickets || '',
    savedInSystem: bookingContext?.savedInSystem || '—',
    updatedBy: formatActorDisplay(entry, userNames),
    isCancel,
  };
}

export function buildSyntheticCancelMessage(booking, businessTimezone, helpers) {
  const {
    bookerNameForDashboardMessage,
    formatVisitDatePart,
    formatVisitTimePart,
    ticketsLineForDashboardMessage,
    formatDateTimeForBusiness,
  } = helpers;

  const ref = booking.booking_number || booking.id?.slice(0, 8) || '—';
  const reason = String(booking.cancellation_reason || '').trim();
  const isAuto = /automatically cancelled/i.test(reason);

  return {
    id: `synthetic-cancel-${booking.id}`,
    type: BOOKING_HISTORY_ACTIONS.CANCELLED,
    timestamp: booking.cancelled_at || booking.updated_at,
    bookingId: booking.id,
    customerId: booking.customer_id || null,
    bookingRef: ref,
    badge: isAuto ? 'Auto-cancelled' : 'Cancelled',
    badgeColor: '#b91c1c',
    badgeBg: '#fef2f2',
    title: isAuto ? 'Booking auto-cancelled' : 'Booking cancelled',
    detail: reason || (isAuto
      ? 'Cancelled automatically because payment was not received by the deadline.'
      : 'This booking is no longer active.'),
    changeLines: reason ? [reason] : [],
    booker: bookerNameForDashboardMessage(booking),
    activity: booking.booking_activities?.activity_name || 'Activity',
    visitDate: formatVisitDatePart(booking, businessTimezone),
    visitTime: formatVisitTimePart(booking),
    tickets: ticketsLineForDashboardMessage(booking),
    savedInSystem: booking.created_at
      ? formatDateTimeForBusiness(booking.created_at, businessTimezone)
      : '—',
    updatedBy: isAuto ? 'System' : 'Staff',
    isCancel: true,
  };
}
