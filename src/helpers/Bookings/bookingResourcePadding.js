import { getBookingTimeRangeMinutes } from '../../utils/bookingTimeRange';

export function parsePaddingMinutes(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function resolveResourcePadding(resource, category) {
  const categoryBefore = parsePaddingMinutes(category?.defaultPaddingBeforeMinutes, 0);
  const categoryAfter = parsePaddingMinutes(category?.defaultPaddingAfterMinutes, 0);

  const beforeMinutes = resource?.paddingBeforeMinutes != null
    ? parsePaddingMinutes(resource.paddingBeforeMinutes, categoryBefore)
    : categoryBefore;

  const afterMinutes = resource?.paddingAfterMinutes != null
    ? parsePaddingMinutes(resource.paddingAfterMinutes, categoryAfter)
    : categoryAfter;

  const cumulativePadding = resource?.cumulativePadding != null
    ? !!resource.cumulativePadding
    : !!category?.cumulativePadding;

  return { beforeMinutes, afterMinutes, cumulativePadding };
}

export function buildResourcePaddingLookup(categories = []) {
  const lookup = new Map();

  (categories || []).forEach((category) => {
    (category?.resources || []).forEach((resource) => {
      if (!resource?.id) return;
      lookup.set(resource.id, resolveResourcePadding(resource, category));
    });
  });

  return lookup;
}

export function getResourceBlockedRangeMinutes(booking, padding = {}, options = {}) {
  const range = getBookingTimeRangeMinutes(booking, options);
  if (!range) return null;

  const beforeMinutes = parsePaddingMinutes(padding.beforeMinutes, 0);
  const afterMinutes = parsePaddingMinutes(padding.afterMinutes, 0);

  return {
    startMinutes: range.startMinutes - beforeMinutes,
    endMinutes: range.endMinutes + afterMinutes,
  };
}

/**
 * When cumulativePadding is true, setup-before and cleanup-after both apply between
 * back-to-back bookings (e.g. 15 + 30 = 45 min gap).
 *
 * When false, only the larger of cleanup-after / setup-before is required between
 * bookings (e.g. max(15, 30) = 30 min gap). Setup-before still applies before the
 * first booking of the day; cleanup-after still applies after the last.
 */
export function doResourceBookingsConflict(
  bookingA,
  paddingA,
  bookingB,
  paddingB,
  options = {},
) {
  const coreA = getBookingTimeRangeMinutes(bookingA, options);
  const coreB = getBookingTimeRangeMinutes(bookingB, options);
  if (!coreA || !coreB) return false;

  const beforeA = parsePaddingMinutes(paddingA?.beforeMinutes, 0);
  const afterA = parsePaddingMinutes(paddingA?.afterMinutes, 0);
  const beforeB = parsePaddingMinutes(paddingB?.beforeMinutes, 0);
  const afterB = parsePaddingMinutes(paddingB?.afterMinutes, 0);
  const cumulativePadding = !!(paddingA?.cumulativePadding ?? paddingB?.cumulativePadding);

  if (coreA.startMinutes < coreB.endMinutes && coreB.startMinutes < coreA.endMinutes) {
    return true;
  }

  if (cumulativePadding) {
    const rangeA = {
      startMinutes: coreA.startMinutes - beforeA,
      endMinutes: coreA.endMinutes + afterA,
    };
    const rangeB = {
      startMinutes: coreB.startMinutes - beforeB,
      endMinutes: coreB.endMinutes + afterB,
    };
    return rangeA.startMinutes < rangeB.endMinutes && rangeB.startMinutes < rangeA.endMinutes;
  }

  if (coreA.endMinutes <= coreB.startMinutes) {
    const gapMinutes = coreB.startMinutes - coreA.endMinutes;
    const requiredGap = Math.max(afterA, beforeB);
    if (gapMinutes < requiredGap) return true;
  } else if (coreB.endMinutes <= coreA.startMinutes) {
    const gapMinutes = coreA.startMinutes - coreB.endMinutes;
    const requiredGap = Math.max(afterB, beforeA);
    if (gapMinutes < requiredGap) return true;
  }

  return false;
}

/** @deprecated Use doResourceBookingsConflict */
export function doResourceBlockedRangesOverlap(
  bookingA,
  paddingA,
  bookingB,
  paddingB,
  options = {},
) {
  return doResourceBookingsConflict(bookingA, paddingA, bookingB, paddingB, options);
}

export function formatResourcePaddingSummary(padding, { compact = false } = {}) {
  const beforeMinutes = parsePaddingMinutes(padding?.beforeMinutes, 0);
  const afterMinutes = parsePaddingMinutes(padding?.afterMinutes, 0);
  const cumulativePadding = !!padding?.cumulativePadding;

  if (!beforeMinutes && !afterMinutes) {
    return compact ? 'No turnover padding' : 'No turnover padding configured';
  }

  const parts = [];
  if (beforeMinutes) {
    parts.push(compact ? `${beforeMinutes}m before` : `${beforeMinutes} min setup before`);
  }
  if (afterMinutes) {
    parts.push(compact ? `${afterMinutes}m after` : `${afterMinutes} min cleanup after`);
  }

  const gapRule = cumulativePadding
    ? (compact ? 'cumulative gap' : 'between bookings: setup + cleanup')
    : (compact ? 'max gap' : 'between bookings: longer of setup or cleanup');

  return `${parts.join(compact ? ' · ' : ' · ')} (${gapRule})`;
}
