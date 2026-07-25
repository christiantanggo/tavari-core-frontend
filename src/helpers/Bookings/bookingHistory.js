import { formatDateTimeForBusiness } from '../../utils/businessDateFormat';
import { getBookingBookerDisplayName } from './bookingProvenance';
import { getParticipantDisplayName } from './participantIdentity';

export const BOOKING_HISTORY_ACTIONS = {
  CREATED: 'booking.created',
  REQUEST_SUBMITTED: 'booking.request_submitted',
  SCHEDULE_UPDATED: 'booking.schedule_updated',
  CANCELLED: 'booking.cancelled',
  APPROVED: 'booking.approved',
  APPROVAL_REVOKED: 'booking.approval_revoked',
  STATUS_CHANGED: 'booking.status_changed',
  CHECK_IN: 'booking.check_in',
  CHECK_IN_CLEARED: 'booking.check_in_cleared',
  RESOURCE_UPDATED: 'booking.resource_updated',
  OPTIONS_UPDATED: 'booking.options_updated',
  MANUAL_ITEM_ADDED: 'booking.manual_item_added',
  MANUAL_ITEM_REMOVED: 'booking.manual_item_removed',
  NOTE_ADDED: 'booking.note_added',
  NOTE_UPDATED: 'booking.note_updated',
  NOTE_DELETED: 'booking.note_deleted',
  EXTENDED: 'booking.extended',
  PRICING_UPDATED: 'booking.pricing_updated',
  PARTICIPANTS_UPDATED: 'booking.participants_updated',
  RESTORED: 'booking.restored',
  PAYMENT_RECEIVED: 'booking.payment_received',
  TERMS_SIGNED: 'booking.terms_signed',
};

const ACTION_LABELS = {
  [BOOKING_HISTORY_ACTIONS.CREATED]: 'Booking created',
  [BOOKING_HISTORY_ACTIONS.REQUEST_SUBMITTED]: 'Booking request submitted',
  [BOOKING_HISTORY_ACTIONS.SCHEDULE_UPDATED]: 'Schedule updated',
  [BOOKING_HISTORY_ACTIONS.CANCELLED]: 'Booking cancelled',
  [BOOKING_HISTORY_ACTIONS.APPROVED]: 'Booking approved',
  [BOOKING_HISTORY_ACTIONS.APPROVAL_REVOKED]: 'Approval removed',
  [BOOKING_HISTORY_ACTIONS.STATUS_CHANGED]: 'Status changed',
  [BOOKING_HISTORY_ACTIONS.CHECK_IN]: 'Checked in',
  [BOOKING_HISTORY_ACTIONS.CHECK_IN_CLEARED]: 'Check-in cleared',
  [BOOKING_HISTORY_ACTIONS.RESOURCE_UPDATED]: 'Room / resource updated',
  [BOOKING_HISTORY_ACTIONS.OPTIONS_UPDATED]: 'Activity options updated',
  [BOOKING_HISTORY_ACTIONS.MANUAL_ITEM_ADDED]: 'Additional item added',
  [BOOKING_HISTORY_ACTIONS.MANUAL_ITEM_REMOVED]: 'Additional item removed',
  [BOOKING_HISTORY_ACTIONS.NOTE_ADDED]: 'Note added',
  [BOOKING_HISTORY_ACTIONS.NOTE_UPDATED]: 'Note updated',
  [BOOKING_HISTORY_ACTIONS.NOTE_DELETED]: 'Note deleted',
  [BOOKING_HISTORY_ACTIONS.EXTENDED]: 'Booking time extended',
  [BOOKING_HISTORY_ACTIONS.PRICING_UPDATED]: 'Pricing updated',
  [BOOKING_HISTORY_ACTIONS.PARTICIPANTS_UPDATED]: 'Participants updated',
  [BOOKING_HISTORY_ACTIONS.RESTORED]: 'Booking restored',
  [BOOKING_HISTORY_ACTIONS.PAYMENT_RECEIVED]: 'Payment received',
  [BOOKING_HISTORY_ACTIONS.TERMS_SIGNED]: 'Terms & Conditions signed',
};

const SCHEDULE_FIELDS = [
  { key: 'activity_id', label: 'Activity', resolve: (v, ctx) => ctx.activityNames?.[v] || v },
  { key: 'booking_date', label: 'Date' },
  { key: 'booking_time', label: 'Time' },
  { key: 'duration_minutes', label: 'Duration (minutes)' },
];

const STATUS_FIELDS = [
  { key: 'status', label: 'Status' },
  { key: 'payment_status', label: 'Payment status' },
];

function normalizeValue(value) {
  if (value == null || value === '') return null;
  return String(value);
}

function valuesEqual(a, b) {
  return normalizeValue(a) === normalizeValue(b);
}

export function buildFieldChanges(before, after, fieldDefs, context = {}) {
  const changes = [];
  for (const def of fieldDefs) {
    const fromRaw = before?.[def.key];
    const toRaw = after?.[def.key];
    if (valuesEqual(fromRaw, toRaw)) continue;
    const resolve = def.resolve || ((v) => v);
    changes.push({
      field: def.label,
      from: resolve(fromRaw, context) ?? '—',
      to: resolve(toRaw, context) ?? '—',
    });
  }
  return changes;
}

export function describeScheduleChanges(before, after, context = {}) {
  return buildFieldChanges(before, after, SCHEDULE_FIELDS, context);
}

export function describeStatusChanges(before, after) {
  return buildFieldChanges(before, after, STATUS_FIELDS);
}

export function formatHistoryActionLabel(actionType) {
  return ACTION_LABELS[actionType] || actionType?.replace(/^booking\./, '').replace(/_/g, ' ') || 'Change';
}

export function getHistoryChangeLines(entry) {
  const details = entry?.details || {};
  if (Array.isArray(details.changes) && details.changes.length > 0) {
    return details.changes.map((change) => {
      if (change.text) return change.text;
      if (change.field && (change.from != null || change.to != null)) {
        return `${change.field}: ${change.from ?? '—'} → ${change.to ?? '—'}`;
      }
      return String(change);
    });
  }
  if (Array.isArray(details.items) && details.items.length > 0) {
    return details.items.map((item) => {
      if (typeof item === 'string') return item;
      if (item.text) return item.text;
      const qty = item.quantity != null ? ` × ${item.quantity}` : '';
      const price = item.unit_price != null ? ` @ $${Number(item.unit_price).toFixed(2)}` : '';
      return `${item.name || 'Item'}${qty}${price}`;
    });
  }
  if (details.reason) {
    return [`Reason: ${details.reason}`];
  }
  if (details.note_excerpt) {
    return [details.note_excerpt];
  }
  if (entry?.summary) {
    return [entry.summary];
  }
  return [];
}

export function buildSyntheticCreatedHistoryEntry(booking) {
  if (!booking?.id) return null;

  const booker = getBookingBookerDisplayName(booking);
  const changes = [];
  if (booking.booking_number) {
    changes.push({ field: 'Booking number', from: null, to: booking.booking_number });
  }
  if (booker) {
    changes.push({ field: 'Booker', from: null, to: booker });
  }
  if (booking.booking_date) {
    changes.push({ field: 'Date', from: null, to: booking.booking_date });
  }
  if (booking.booking_time) {
    changes.push({ field: 'Time', from: null, to: booking.booking_time });
  }
  if (booking.source) {
    changes.push({ field: 'Source', from: null, to: booking.source });
  }

  return {
    id: `synthetic-created-${booking.id}`,
    booking_id: booking.id,
    action_type: BOOKING_HISTORY_ACTIONS.CREATED,
    summary: 'Booking created',
    details: { changes, synthetic: true },
    changed_by: booking.created_by || null,
    changed_ip: booking.created_ip || null,
    created_at: booking.created_at || booking.updated_at,
    _synthetic: true,
  };
}

export function mergeHistoryWithSyntheticCreated(rows, booking) {
  const list = Array.isArray(rows) ? [...rows] : [];
  const hasCreated = list.some((row) => row.action_type === BOOKING_HISTORY_ACTIONS.CREATED);
  if (!hasCreated && booking) {
    const synthetic = buildSyntheticCreatedHistoryEntry(booking);
    if (synthetic) list.push(synthetic);
  }
  return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export function resolveHistoryActorLabel(entry, userNames = {}) {
  if (entry?.changed_by) {
    return userNames[entry.changed_by] || 'Staff user';
  }
  if (entry?.details?.actor_label) {
    return entry.details.actor_label;
  }
  if (entry?.action_type === BOOKING_HISTORY_ACTIONS.CREATED && entry?.details?.synthetic) {
    if (entry.changed_by) return userNames[entry.changed_by] || 'Staff user';
    return 'Customer';
  }
  return 'System';
}

export function formatHistoryTimestamp(iso, businessTimezone) {
  if (!iso) return '—';
  return formatDateTimeForBusiness(iso, businessTimezone);
}

export function summarizePortalOptionChanges(beforeItems, afterItems, bookingId) {
  const beforeMap = new Map();
  for (const item of beforeItems || []) {
    const key = item?.booking_addons?.addon_name || item?.name;
    if (key) beforeMap.set(key, item);
  }
  const afterMap = new Map();
  for (const item of afterItems || []) {
    const key = item?.booking_addons?.addon_name || item?.name;
    if (key) afterMap.set(key, item);
  }

  const changes = [];
  for (const [name, after] of afterMap) {
    const before = beforeMap.get(name);
    const qty = after.quantity ?? 1;
    const price = after.unit_price ?? after.booking_addons?.price ?? 0;
    if (!before) {
      changes.push({ text: `Added ${name} × ${qty} @ $${Number(price).toFixed(2)}` });
      continue;
    }
    const beforeQty = before.quantity ?? 1;
    const beforePrice = before.unit_price ?? before.booking_addons?.price ?? 0;
    if (beforeQty !== qty || Number(beforePrice) !== Number(price)) {
      changes.push({
        text: `Updated ${name}: ${beforeQty} @ $${Number(beforePrice).toFixed(2)} → ${qty} @ $${Number(price).toFixed(2)}`,
      });
    }
    beforeMap.delete(name);
  }
  for (const [name, before] of beforeMap) {
    const qty = before.quantity ?? 1;
    changes.push({ text: `Removed ${name} × ${qty}` });
  }
  if (changes.length === 0 && afterMap.size === 0 && beforeMap.size === 0) {
    return [{ text: 'Options saved (no portal option lines)' }];
  }
  return changes;
}

export function participantLabelFromBooking(booking, participantId) {
  const participants = booking?.booking_participants || [];
  const idx = participants.findIndex((p) => p.id === participantId);
  if (idx < 0) return 'Participant';
  return getParticipantDisplayName(participants[idx], idx);
}
