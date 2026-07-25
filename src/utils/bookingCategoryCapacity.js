/**
 * Category-level shared capacity (booking_types.session_rules.shared_capacity).
 * Applies across all activities in the category — optional daily or per-time-slot pool.
 */

export const CATEGORY_CAPACITY_MODES = {
  DAILY: 'daily',
  TIME_SLOT: 'time_slot',
};

export const defaultCategorySharedCapacityRules = () => ({
  enabled: false,
  mode: CATEGORY_CAPACITY_MODES.DAILY,
  max: null,
});

export const parseCategorySharedCapacityRules = (sessionRules) => {
  const raw =
    sessionRules && typeof sessionRules === 'object' ? sessionRules : {};
  const sc = raw.shared_capacity && typeof raw.shared_capacity === 'object'
    ? raw.shared_capacity
    : raw.sharedCapacity && typeof raw.sharedCapacity === 'object'
      ? raw.sharedCapacity
      : {};

  const modeRaw = String(sc.mode || sc.capacity_mode || CATEGORY_CAPACITY_MODES.DAILY).trim().toLowerCase();
  const mode = modeRaw === CATEGORY_CAPACITY_MODES.TIME_SLOT
    ? CATEGORY_CAPACITY_MODES.TIME_SLOT
    : CATEGORY_CAPACITY_MODES.DAILY;

  const maxRaw = sc.max ?? sc.max_capacity ?? sc.maxCapacity;
  const maxParsed = Number.parseInt(maxRaw, 10);
  const max = Number.isFinite(maxParsed) && maxParsed > 0 ? maxParsed : null;

  return {
    enabled: sc.enabled === true || sc.enable === true,
    mode,
    max: max && max > 0 ? max : null,
  };
};

export const serializeCategorySharedCapacityRules = ({
  enabled = false,
  mode = CATEGORY_CAPACITY_MODES.DAILY,
  max = null,
} = {}) => {
  const maxParsed = Number.parseInt(max, 10);
  const safeMax = Number.isFinite(maxParsed) && maxParsed > 0 ? maxParsed : null;
  const safeMode = mode === CATEGORY_CAPACITY_MODES.TIME_SLOT
    ? CATEGORY_CAPACITY_MODES.TIME_SLOT
    : CATEGORY_CAPACITY_MODES.DAILY;

  if (!enabled || !safeMax) {
    return { enabled: false, mode: safeMode, max: null };
  }

  return {
    enabled: true,
    mode: safeMode,
    max: safeMax,
  };
};

/** Merge shared capacity into existing session_rules without dropping other keys. */
export const mergeCategorySessionRulesWithSharedCapacity = (sessionRules, sharedCapacity) => ({
  ...(sessionRules && typeof sessionRules === 'object' ? sessionRules : {}),
  shared_capacity: serializeCategorySharedCapacityRules(sharedCapacity),
});

export const categoryCapacityModeLabel = (mode) =>
  mode === CATEGORY_CAPACITY_MODES.TIME_SLOT ? 'Per time slot' : 'Per calendar day';
