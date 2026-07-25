/**
 * Schedule resource requirement shapes:
 *
 * Fixed (legacy array / single id — all required):
 *   { "party-rooms": ["red-room", "yellow-room"] }
 *
 * Pool (any N from list):
 *   { "party-rooms": { "mode": "pool", "count": 1, "pool": ["red-room", "yellow-room", "teal-room"] } }
 *
 * Pool with allowed combinations (e.g. adjacent rooms only):
 *   {
 *     "party-rooms": {
 *       "mode": "pool",
 *       "count": 2,
 *       "pool": ["red-room", "yellow-room", "teal-room"],
 *       "allowed_combinations": [
 *         ["red-room", "yellow-room"],
 *         ["yellow-room", "teal-room"]
 *       ]
 *     }
 *   }
 *
 * Facility lock (blocks every resource in every category for overlapping times):
 *   { "__facility__": { "mode": "facility_lock" } }
 */

export const SCHEDULE_RESOURCE_MODES = {
  FIXED: 'fixed',
  POOL: 'pool',
  FACILITY_LOCK: 'facility_lock',
};

export const FACILITY_LOCK_CATEGORY_ID = '__facility__';

export function normalizeResourceIdList(ids = []) {
  return [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
}

/** Sorted unique ids so combination equality is order-independent. */
export function normalizeCombinationKey(ids = []) {
  return normalizeResourceIdList(ids).slice().sort().join('|');
}

export function combinationsEqual(a = [], b = []) {
  return normalizeCombinationKey(a) === normalizeCombinationKey(b);
}

/** All unordered combinations of size k from items. */
export function listCombinationsOfSize(items = [], size = 1) {
  const pool = normalizeResourceIdList(items);
  const k = Math.max(1, Math.min(pool.length || 1, Number.parseInt(size, 10) || 1));
  if (k === 1) return pool.map((id) => [id]);
  if (k >= pool.length) return pool.length ? [pool.slice()] : [];

  const out = [];
  const walk = (start, chosen) => {
    if (chosen.length === k) {
      out.push(chosen.slice());
      return;
    }
    for (let i = start; i < pool.length; i += 1) {
      chosen.push(pool[i]);
      walk(i + 1, chosen);
      chosen.pop();
    }
  };
  walk(0, []);
  return out;
}

export function parseAllowedCombinations(raw, pool = [], count = 1) {
  if (!Array.isArray(raw) || !raw.length) return [];
  const poolSet = new Set(normalizeResourceIdList(pool));
  const seen = new Set();
  const out = [];
  raw.forEach((entry) => {
    const combo = normalizeResourceIdList(entry);
    if (combo.length !== count) return;
    if (combo.some((id) => !poolSet.has(id))) return;
    const key = normalizeCombinationKey(combo);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(combo.slice().sort());
  });
  return out;
}

/**
 * Combinations the scheduler may auto-assign.
 * If allowed_combinations is set, only those; otherwise any N from the pool.
 */
export function listValidPoolCombinations(requirement) {
  if (!requirement || requirement.mode !== SCHEDULE_RESOURCE_MODES.POOL) return [];
  const pool = normalizeResourceIdList(requirement.pool);
  const count = Math.max(1, Math.min(pool.length || 1, Number.parseInt(requirement.count, 10) || 1));
  const allowed = parseAllowedCombinations(requirement.allowedCombinations || requirement.allowed_combinations, pool, count);
  if (allowed.length) return allowed;
  return listCombinationsOfSize(pool, count);
}

export function parseScheduleCategoryAssignment(value) {
  if (value == null) {
    return {
      mode: SCHEDULE_RESOURCE_MODES.FIXED,
      count: 0,
      resourceIds: [],
      pool: [],
      allowedCombinations: [],
    };
  }

  if (Array.isArray(value)) {
    const resourceIds = normalizeResourceIdList(value);
    return {
      mode: SCHEDULE_RESOURCE_MODES.FIXED,
      count: resourceIds.length,
      resourceIds,
      pool: resourceIds,
      allowedCombinations: [],
    };
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const id = String(value).trim();
    const resourceIds = id ? [id] : [];
    return {
      mode: SCHEDULE_RESOURCE_MODES.FIXED,
      count: resourceIds.length,
      resourceIds,
      pool: resourceIds,
      allowedCombinations: [],
    };
  }

  if (typeof value === 'object') {
    if (value.mode === SCHEDULE_RESOURCE_MODES.FACILITY_LOCK) {
      return {
        mode: SCHEDULE_RESOURCE_MODES.FACILITY_LOCK,
        count: 1,
        resourceIds: [],
        pool: [],
        allowedCombinations: [],
      };
    }

    const mode =
      value.mode === SCHEDULE_RESOURCE_MODES.POOL
        ? SCHEDULE_RESOURCE_MODES.POOL
        : SCHEDULE_RESOURCE_MODES.FIXED;

    if (mode === SCHEDULE_RESOURCE_MODES.POOL) {
      const poolSource = Array.isArray(value.pool)
        ? value.pool
        : Array.isArray(value.resourceIds)
          ? value.resourceIds
          : [];
      const pool = normalizeResourceIdList(poolSource);
      const count = Math.max(1, Math.min(pool.length || 1, Number.parseInt(value.count, 10) || 1));
      const allowedCombinations = parseAllowedCombinations(
        value.allowed_combinations || value.allowedCombinations,
        pool,
        count,
      );
      return {
        mode: SCHEDULE_RESOURCE_MODES.POOL,
        count,
        resourceIds: [],
        pool,
        allowedCombinations,
      };
    }

    const fixedSource = Array.isArray(value.resourceIds)
      ? value.resourceIds
      : Array.isArray(value.pool)
        ? value.pool
        : [];
    const resourceIds = normalizeResourceIdList(fixedSource);
    return {
      mode: SCHEDULE_RESOURCE_MODES.FIXED,
      count: resourceIds.length,
      resourceIds,
      pool: resourceIds,
      allowedCombinations: [],
    };
  }

  return {
    mode: SCHEDULE_RESOURCE_MODES.FIXED,
    count: 0,
    resourceIds: [],
    pool: [],
    allowedCombinations: [],
  };
}

export function serializeScheduleCategoryAssignment(parsed) {
  if (!parsed) return null;

  if (parsed.mode === SCHEDULE_RESOURCE_MODES.FACILITY_LOCK) {
    return { mode: SCHEDULE_RESOURCE_MODES.FACILITY_LOCK };
  }

  if (parsed.count <= 0 && parsed.mode !== SCHEDULE_RESOURCE_MODES.FACILITY_LOCK) return null;

  if (parsed.mode === SCHEDULE_RESOURCE_MODES.POOL) {
    const pool = normalizeResourceIdList(parsed.pool);
    if (!pool.length) return null;
    const count = Math.max(1, Math.min(pool.length, Number.parseInt(parsed.count, 10) || 1));
    const allowedCombinations = parseAllowedCombinations(
      parsed.allowedCombinations || parsed.allowed_combinations,
      pool,
      count,
    );
    const out = {
      mode: SCHEDULE_RESOURCE_MODES.POOL,
      count,
      pool,
    };
    if (allowedCombinations.length) {
      out.allowed_combinations = allowedCombinations;
    }
    return out;
  }

  const resourceIds = normalizeResourceIdList(parsed.resourceIds || parsed.pool);
  return resourceIds.length ? resourceIds : null;
}

/** Normalize a full resource_assignments map for save/load. */
export function normalizeScheduleResourceAssignmentsMap(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  Object.entries(raw).forEach(([categoryId, value]) => {
    const parsed = parseScheduleCategoryAssignment(value);
    const serialized = serializeScheduleCategoryAssignment(parsed);
    if (serialized != null) out[categoryId] = serialized;
  });
  return out;
}

export function scheduleHasFacilityLock(resourceAssignments) {
  if (!resourceAssignments || typeof resourceAssignments !== 'object') return false;
  return Object.values(resourceAssignments).some((value) => {
    const parsed = parseScheduleCategoryAssignment(value);
    return parsed.mode === SCHEDULE_RESOURCE_MODES.FACILITY_LOCK;
  });
}

export function listScheduleResourceRequirements(resourceAssignments) {
  if (!resourceAssignments || typeof resourceAssignments !== 'object') return [];
  return Object.entries(resourceAssignments)
    .map(([categoryId, value]) => ({
      categoryId,
      ...parseScheduleCategoryAssignment(value),
    }))
    .filter((row) => {
      if (row.mode === SCHEDULE_RESOURCE_MODES.FACILITY_LOCK) return true;
      return row.count > 0 && (row.pool.length > 0 || row.resourceIds.length > 0);
    });
}

/** Fixed IDs only (pool returns []). Used when expanding concrete schedule copies. */
export function getFixedResourceIdsFromCategoryValue(value) {
  const parsed = parseScheduleCategoryAssignment(value);
  return parsed.mode === SCHEDULE_RESOURCE_MODES.FIXED ? parsed.resourceIds : [];
}

export function scheduleHasPoolRequirement(resourceAssignments) {
  return listScheduleResourceRequirements(resourceAssignments).some(
    (row) => row.mode === SCHEDULE_RESOURCE_MODES.POOL,
  );
}

/**
 * Build facility-lock resource_assignments from loaded resource categories.
 * Claims every active resource so overlapping activities cannot run.
 */
export function buildFacilityLockResourceAssignments(resourceCategories = []) {
  const out = {
    [FACILITY_LOCK_CATEGORY_ID]: { mode: SCHEDULE_RESOURCE_MODES.FACILITY_LOCK },
  };
  (resourceCategories || []).forEach((category) => {
    const categoryId = category.categoryId || category.id;
    if (!categoryId) return;
    const ids = (category.resources || [])
      .map((resource) => resource.id)
      .filter(Boolean);
    if (ids.length) out[categoryId] = ids;
  });
  return out;
}
