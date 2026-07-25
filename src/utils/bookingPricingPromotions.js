/**
 * Resolve configurable booking pricing promotions against visit date/time, purchase window,
 * activity scope, channel, promo codes, and ticket counts.
 */

import {
  buildMultiDayProratedPriceOverrides,
  mergeTicketPriceOverrides,
} from '../helpers/Bookings/bookingMultiDay';

const DAY_MS = 24 * 60 * 60 * 1000;

export const BOOKING_PROMOTION_CHANNELS = ['online', 'in_person', 'both'];
export const BOOKING_PROMOTION_ACTIVITY_MODES = ['all', 'categories', 'activities'];
export const BOOKING_PROMOTION_PRICE_MODES = [
  'override_prices',
  'percent_off',
  'fixed_off',
  'flat_package_price',
];

export const DEFAULT_BOOKING_PRICING_PROMOTION = {
  name: '',
  description: '',
  internal_notes: '',
  is_active: true,
  priority: 0,
  promo_code: '',
  channel: 'both',
  activity_scope: { mode: 'all', category_keys: [], activity_ids: [] },
  purchase_starts_at: null,
  purchase_ends_at: null,
  visit_start_date: null,
  visit_end_date: null,
  visit_days_of_week: [],
  visit_start_time: null,
  visit_end_time: null,
  visit_times: [],
  visit_blackout_dates: [],
  price_adjustments: { mode: 'override_prices', items: [] },
  min_tickets: null,
  max_total_redemptions: null,
  max_redemptions_per_customer: null,
  apply_conditional_free_rules: true,
};

export function normalizeBookingTimeValue(timeValue) {
  if (timeValue == null || timeValue === '') return null;
  const raw = String(timeValue).trim();
  if (!raw) return null;

  const ampmMatch = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hours = Number.parseInt(ampmMatch[1], 10);
    const minutes = ampmMatch[2];
    const seconds = ampmMatch[3] || '00';
    if (/PM/i.test(ampmMatch[4]) && hours < 12) hours += 12;
    if (/AM/i.test(ampmMatch[4]) && hours === 12) hours = 0;
    return `${String(hours).padStart(2, '0')}:${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  const hmsMatch = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hmsMatch) {
    return `${String(hmsMatch[1]).padStart(2, '0')}:${hmsMatch[2]}:${hmsMatch[3] || '00'}`;
  }

  return raw;
}

export function bookingTimeToMinutes(timeValue) {
  const normalized = normalizeBookingTimeValue(timeValue);
  if (!normalized) return null;
  const match = normalized.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
}

export function parseBookingDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}

function parseDateOnlyToUtcMs(dateOnly) {
  if (!dateOnly) return null;
  const match = String(dateOnly).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function dayOfWeekFromDateOnly(dateOnly) {
  const ms = parseDateOnlyToUtcMs(dateOnly);
  if (ms == null) return null;
  return new Date(ms).getUTCDay();
}

function normalizePromoCode(code) {
  if (code == null) return '';
  return String(code).trim().toUpperCase();
}

function normalizeActivityScope(scope) {
  const parsed = scope && typeof scope === 'object' ? scope : {};
  const mode = BOOKING_PROMOTION_ACTIVITY_MODES.includes(parsed.mode)
    ? parsed.mode
    : 'all';
  return {
    mode,
    category_keys: Array.isArray(parsed.category_keys)
      ? parsed.category_keys.map((key) => String(key).trim()).filter(Boolean)
      : [],
    activity_ids: Array.isArray(parsed.activity_ids)
      ? parsed.activity_ids.map((id) => String(id).trim()).filter(Boolean)
      : [],
  };
}

export function normalizePriceAdjustments(raw) {
  const parsed = raw && typeof raw === 'object' ? raw : {};
  const mode = BOOKING_PROMOTION_PRICE_MODES.includes(parsed.mode)
    ? parsed.mode
    : 'override_prices';
  const items = Array.isArray(parsed.items)
    ? parsed.items
      .map((row) => ({
        inventory_item_id: row?.inventory_item_id ? String(row.inventory_item_id) : '',
        price: row?.price != null ? Number(row.price) : null,
        percent: row?.percent != null ? Number(row.percent) : null,
        amount: row?.amount != null ? Number(row.amount) : null,
      }))
      .filter((row) => row.inventory_item_id)
    : [];
  return {
    mode,
    items,
    flat_price: parsed.flat_price != null ? Number(parsed.flat_price) : null,
  };
}

export function normalizeBookingPricingPromotion(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    ...row,
    id: row.id ? String(row.id) : null,
    business_id: row.business_id ? String(row.business_id) : null,
    is_active: row.is_active !== false,
    priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : 0,
    promo_code: row.promo_code ? String(row.promo_code).trim() : '',
    channel: BOOKING_PROMOTION_CHANNELS.includes(row.channel) ? row.channel : 'both',
    activity_scope: normalizeActivityScope(row.activity_scope),
    visit_days_of_week: Array.isArray(row.visit_days_of_week)
      ? row.visit_days_of_week.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6)
      : [],
    visit_times: Array.isArray(row.visit_times)
      ? row.visit_times.map((t) => normalizeBookingTimeValue(t)).filter(Boolean)
      : [],
    visit_blackout_dates: Array.isArray(row.visit_blackout_dates)
      ? row.visit_blackout_dates.map((d) => parseBookingDateOnly(d)).filter(Boolean)
      : [],
    price_adjustments: normalizePriceAdjustments(row.price_adjustments),
    min_tickets: row.min_tickets != null && row.min_tickets !== ''
      ? Math.max(0, Number.parseInt(String(row.min_tickets), 10) || 0)
      : null,
    max_total_redemptions: row.max_total_redemptions != null && row.max_total_redemptions !== ''
      ? Math.max(0, Number.parseInt(String(row.max_total_redemptions), 10) || 0)
      : null,
    max_redemptions_per_customer: row.max_redemptions_per_customer != null && row.max_redemptions_per_customer !== ''
      ? Math.max(0, Number.parseInt(String(row.max_redemptions_per_customer), 10) || 0)
      : null,
    apply_conditional_free_rules: row.apply_conditional_free_rules !== false,
    uses_count: Number(row.uses_count) || 0,
  };
}

function promotionMatchesChannel(promotion, channel) {
  const promoChannel = promotion.channel || 'both';
  if (promoChannel === 'both') return true;
  return promoChannel === channel;
}

function promotionMatchesActivityScope(promotion, { activityId, categoryKey }) {
  const scope = promotion.activity_scope || { mode: 'all' };
  if (scope.mode === 'all') return true;
  if (scope.mode === 'activities') {
    return scope.activity_ids.includes(String(activityId || ''));
  }
  if (scope.mode === 'categories') {
    return scope.category_keys.includes(String(categoryKey || ''));
  }
  return false;
}

function promotionMatchesPurchaseWindow(promotion, purchaseAt) {
  const at = purchaseAt instanceof Date ? purchaseAt : new Date(purchaseAt || Date.now());
  if (promotion.purchase_starts_at) {
    const start = new Date(promotion.purchase_starts_at);
    if (at < start) return false;
  }
  if (promotion.purchase_ends_at) {
    const end = new Date(promotion.purchase_ends_at);
    if (at > end) return false;
  }
  return true;
}

function promotionMatchesVisitDate(promotion, bookingDate) {
  const visitDate = parseBookingDateOnly(bookingDate);
  if (!visitDate) return false;

  if (Array.isArray(promotion.visit_blackout_dates) && promotion.visit_blackout_dates.includes(visitDate)) {
    return false;
  }

  if (promotion.visit_start_date) {
    const startMs = parseDateOnlyToUtcMs(parseBookingDateOnly(promotion.visit_start_date));
    const visitMs = parseDateOnlyToUtcMs(visitDate);
    if (startMs != null && visitMs != null && visitMs < startMs) return false;
  }
  if (promotion.visit_end_date) {
    const endMs = parseDateOnlyToUtcMs(parseBookingDateOnly(promotion.visit_end_date));
    const visitMs = parseDateOnlyToUtcMs(visitDate);
    if (endMs != null && visitMs != null && visitMs > endMs) return false;
  }

  if (Array.isArray(promotion.visit_days_of_week) && promotion.visit_days_of_week.length > 0) {
    const dow = dayOfWeekFromDateOnly(visitDate);
    if (dow == null || !promotion.visit_days_of_week.includes(dow)) return false;
  }

  return true;
}

function promotionMatchesVisitTime(promotion, bookingTime) {
  const specificTimes = Array.isArray(promotion.visit_times)
    ? promotion.visit_times.map((t) => normalizeBookingTimeValue(t)).filter(Boolean)
    : [];
  if (specificTimes.length > 0) {
    const normalizedTime = normalizeBookingTimeValue(bookingTime);
    if (!normalizedTime) return false;
    return specificTimes.includes(normalizedTime);
  }

  const normalizedTime = normalizeBookingTimeValue(bookingTime);
  if (!normalizedTime) return true;

  const startMinutes = promotion.visit_start_time
    ? bookingTimeToMinutes(promotion.visit_start_time)
    : null;
  const endMinutes = promotion.visit_end_time
    ? bookingTimeToMinutes(promotion.visit_end_time)
    : null;
  if (startMinutes == null && endMinutes == null) return true;

  const visitMinutes = bookingTimeToMinutes(normalizedTime);
  if (visitMinutes == null) return false;
  if (startMinutes != null && visitMinutes < startMinutes) return false;
  if (endMinutes != null && visitMinutes > endMinutes) return false;
  return true;
}

function promotionMatchesPromoCode(promotion, promoCode) {
  const required = normalizePromoCode(promotion.promo_code);
  if (!required) return true;
  return normalizePromoCode(promoCode) === required;
}

function promotionMatchesTicketCount(promotion, totalTickets) {
  if (promotion.min_tickets != null && promotion.min_tickets > 0) {
    return (totalTickets || 0) >= promotion.min_tickets;
  }
  return true;
}

function promotionHasRemainingUses(promotion) {
  if (promotion.max_total_redemptions == null || promotion.max_total_redemptions <= 0) return true;
  return (promotion.uses_count || 0) < promotion.max_total_redemptions;
}

export function promotionMatchesContext(promotion, context = {}) {
  const normalized = normalizeBookingPricingPromotion(promotion);
  if (!normalized || normalized.is_active === false) return false;

  const {
    activityId = null,
    categoryKey = null,
    bookingDate = null,
    bookingTime = null,
    purchaseAt = new Date(),
    promoCode = '',
    channel = 'online',
    totalTickets = 0,
  } = context;

  if (!promotionMatchesChannel(normalized, channel)) return false;
  if (!promotionMatchesActivityScope(normalized, { activityId, categoryKey })) return false;
  if (!promotionMatchesPurchaseWindow(normalized, purchaseAt)) return false;
  if (!promotionMatchesVisitDate(normalized, bookingDate)) return false;
  if (!promotionMatchesVisitTime(normalized, bookingTime)) return false;
  if (!promotionMatchesPromoCode(normalized, promoCode)) return false;
  if (!promotionMatchesTicketCount(normalized, totalTickets)) return false;
  if (!promotionHasRemainingUses(normalized)) return false;

  return true;
}

export function resolveApplicableBookingPromotion(promotions = [], context = {}) {
  const matches = (promotions || [])
    .map((row) => normalizeBookingPricingPromotion(row))
    .filter(Boolean)
    .filter((promotion) => promotionMatchesContext(promotion, context))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  return matches[0] || null;
}

/**
 * Effective ticket unit prices for checkout:
 * 1) Prorate inventory (full-week) price when this week has fewer days
 * 2) Apply booking promotion on the (already prorated) base; promo overrides win
 */
export function buildEffectiveTicketPriceOverrides({
  items = [],
  selectedTickets = {},
  promotion = null,
  weekDayCount = null,
  fullWeekDayCount = null,
  itemIds = null,
} = {}) {
  const prorated = buildMultiDayProratedPriceOverrides(items, {
    weekDayCount,
    fullWeekDayCount,
    itemIds,
  });

  const itemsForPromo = Object.keys(prorated).length > 0
    ? (items || []).map((item) => {
      const id = item?.id != null ? String(item.id) : '';
      if (id && prorated[id] != null) {
        return { ...item, price: prorated[id] };
      }
      return item;
    })
    : items;

  const promoOverrides = buildPriceOverridesFromPromotion(promotion, itemsForPromo, selectedTickets);
  return mergeTicketPriceOverrides(prorated, promoOverrides);
}

export function buildPriceOverridesFromPromotion(promotion, items = [], selectedTickets = {}) {
  const normalized = normalizeBookingPricingPromotion(promotion);
  if (!normalized) return {};

  const adjustments = normalized.price_adjustments || { mode: 'override_prices', items: [] };
  const itemById = new Map((items || []).map((item) => [String(item.id), item]));
  const selectedIds = Object.keys(selectedTickets || {}).filter((id) => (selectedTickets[id] || 0) > 0);
  const targetIds = selectedIds.length > 0
    ? selectedIds
    : (adjustments.items || []).map((row) => row.inventory_item_id);

  const overrides = {};

  if (adjustments.mode === 'flat_package_price') {
    const flatPrice = Number(adjustments.flat_price);
    if (!Number.isFinite(flatPrice)) return overrides;
    const packageIds = (adjustments.items || []).length > 0
      ? adjustments.items.map((row) => row.inventory_item_id)
      : targetIds;
    packageIds.forEach((itemId) => {
      if (itemById.has(itemId)) overrides[itemId] = flatPrice;
    });
    return overrides;
  }

  (adjustments.items || []).forEach((row) => {
    const itemId = row.inventory_item_id;
    const item = itemById.get(itemId);
    if (!item) return;
    const basePrice = Number.parseFloat(item.price ?? 0) || 0;

    if (adjustments.mode === 'override_prices') {
      if (Number.isFinite(row.price)) overrides[itemId] = Math.max(0, row.price);
      return;
    }
    if (adjustments.mode === 'percent_off') {
      const pct = Number(row.percent ?? adjustments.percent ?? 0);
      if (!Number.isFinite(pct)) return;
      overrides[itemId] = Math.max(0, basePrice * (1 - pct / 100));
      return;
    }
    if (adjustments.mode === 'fixed_off') {
      const amount = Number(row.amount ?? adjustments.amount ?? 0);
      if (!Number.isFinite(amount)) return;
      overrides[itemId] = Math.max(0, basePrice - amount);
    }
  });

  return overrides;
}

export function summarizePromotionForDisplay(promotion) {
  const normalized = normalizeBookingPricingPromotion(promotion);
  if (!normalized) return '';
  const parts = [normalized.name];
  if (normalized.promo_code) parts.push(`Code: ${normalized.promo_code}`);
  if (normalized.visit_times?.length) parts.push(`Times: ${normalized.visit_times.join(', ')}`);
  return parts.filter(Boolean).join(' · ');
}

export function serializeBookingPricingPromotionForSave(form) {
  const promoCode = form.promo_code ? String(form.promo_code).trim() : null;
  return {
    name: String(form.name || '').trim(),
    description: form.description ? String(form.description).trim() : null,
    internal_notes: form.internal_notes ? String(form.internal_notes).trim() : null,
    is_active: form.is_active !== false,
    priority: Number.isFinite(Number(form.priority)) ? Number(form.priority) : 0,
    promo_code: promoCode || null,
    channel: BOOKING_PROMOTION_CHANNELS.includes(form.channel) ? form.channel : 'both',
    activity_scope: normalizeActivityScope(form.activity_scope),
    purchase_starts_at: form.purchase_starts_at || null,
    purchase_ends_at: form.purchase_ends_at || null,
    visit_start_date: parseBookingDateOnly(form.visit_start_date) || null,
    visit_end_date: parseBookingDateOnly(form.visit_end_date) || null,
    visit_days_of_week: Array.isArray(form.visit_days_of_week) && form.visit_days_of_week.length > 0
      ? form.visit_days_of_week
      : null,
    visit_start_time: form.visit_start_time || null,
    visit_end_time: form.visit_end_time || null,
    visit_times: Array.isArray(form.visit_times) && form.visit_times.length > 0
      ? form.visit_times.map((t) => normalizeBookingTimeValue(t)).filter(Boolean)
      : null,
    visit_blackout_dates: Array.isArray(form.visit_blackout_dates) && form.visit_blackout_dates.length > 0
      ? form.visit_blackout_dates.map((d) => parseBookingDateOnly(d)).filter(Boolean)
      : null,
    price_adjustments: normalizePriceAdjustments(form.price_adjustments),
    min_tickets: form.min_tickets != null && form.min_tickets !== ''
      ? Math.max(0, Number.parseInt(String(form.min_tickets), 10) || 0)
      : null,
    max_total_redemptions: form.max_total_redemptions != null && form.max_total_redemptions !== ''
      ? Math.max(0, Number.parseInt(String(form.max_total_redemptions), 10) || 0)
      : null,
    max_redemptions_per_customer: form.max_redemptions_per_customer != null && form.max_redemptions_per_customer !== ''
      ? Math.max(0, Number.parseInt(String(form.max_redemptions_per_customer), 10) || 0)
      : null,
    apply_conditional_free_rules: form.apply_conditional_free_rules !== false,
  };
}
