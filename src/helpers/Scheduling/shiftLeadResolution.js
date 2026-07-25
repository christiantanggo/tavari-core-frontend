/**
 * Position-based shift lead resolution for scheduling / payroll.
 * Order follows positions.display_order (lower = higher authority).
 */

/** Scheduled row is absent — must not count as on-site for key-holder / shift-lead chain. */
const SHIFT_LEAD_ABSENT_SCHEDULE_STATUSES = new Set(['sick', 'no_show', 'cancelled']);

/**
 * Whether this shift row counts as physical presence for shift-lead pooling.
 * Clock-derived hybrid rows omit `status` — those count as present.
 */
export function isShiftPresentForShiftLeadPooling(shift) {
  if (!shift || typeof shift !== 'object') return false;
  const st = shift.status;
  if (st == null || st === '') return true;
  return !SHIFT_LEAD_ABSENT_SCHEDULE_STATUSES.has(String(st).toLowerCase());
}

/**
 * Per employee, which calendar dates have at least one present vs absent scheduled shift.
 * @returns {{ presentDatesByEmployee: Record<string, Set<string>>, absentDatesByEmployee: Record<string, Set<string>> }}
 */
export function buildSchedulePresenceByEmployeeDate(shifts) {
  const presentDatesByEmployee = {};
  const absentDatesByEmployee = {};

  (shifts || []).forEach((shift) => {
    const empId = shift?.employee_id;
    const dateKey = shift?.shift_date ? String(shift.shift_date).slice(0, 10) : '';
    if (!empId || !dateKey) return;

    const bucket = isShiftPresentForShiftLeadPooling(shift)
      ? presentDatesByEmployee
      : absentDatesByEmployee;
    if (!bucket[empId]) bucket[empId] = new Set();
    bucket[empId].add(dateKey);
  });

  return { presentDatesByEmployee, absentDatesByEmployee };
}

/** Skip clock hours when the employee only has absent shifts (no_show, sick, cancelled) that day. */
export function shouldExcludeClockHoursForAbsentOnlyScheduleDay(employeeId, localDate, presence) {
  if (!employeeId || !localDate || !presence) return false;
  if (presence.presentDatesByEmployee[employeeId]?.has(localDate)) return false;
  return Boolean(presence.absentDatesByEmployee[employeeId]?.has(localDate));
}

export function normalizePositionName(name) {
  return String(name || '')
    .trim()
    .toLowerCase();
}

function parseTimeToMinutes(timeString) {
  if (!timeString) return null;
  const [hoursStr, minutesStr, secondsStr] = String(timeString).split(':');
  const hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr || '0', 10);
  const seconds = parseInt(secondsStr || '0', 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes + Math.floor(seconds / 60);
}

function timeStringToMinutes(timeString) {
  if (!timeString) return null;
  const parts = String(timeString).split(':').map(Number);
  const hours = parts[0];
  const minutes = parts[1] || 0;
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function getShiftMinutes(shift) {
  const start = parseTimeToMinutes(
    shift?.start_time?.length > 5 ? shift.start_time.substring(0, 5) : shift?.start_time
  );
  const endRaw = parseTimeToMinutes(
    shift?.end_time?.length > 5 ? shift.end_time.substring(0, 5) : shift?.end_time
  );
  if (start === null || endRaw === null) return null;
  let end = endRaw;
  if (end <= start) end += 24 * 60;
  return { start, end };
}

/** Intersect a shift interval with the shift-lead window (same calendar day). */
function intersectShiftWithWindow(shiftMinutes, window) {
  if (!shiftMinutes || !window) return null;
  const s = Math.max(shiftMinutes.start, window.startMinutes);
  const e = Math.min(shiftMinutes.end, window.endMinutes);
  if (s >= e) return null;
  return { start: s, end: e };
}

/**
 * Pool used for shift-lead eligibility: clip to window and, when after-hours rules are on,
 * only the portion at or before afterHoursStart counts (avoid dropping whole long shifts).
 */
function clipShiftToLeadPool(shiftMinutes, shiftLeadWindow, afterHoursEnabled, afterHoursStart) {
  let clipped = intersectShiftWithWindow(shiftMinutes, shiftLeadWindow);
  if (!clipped) return null;
  if (afterHoursEnabled && afterHoursStart != null) {
    clipped = { start: clipped.start, end: Math.min(clipped.end, afterHoursStart) };
  }
  if (clipped.start >= clipped.end) return null;
  return clipped;
}

function mergeIntervals(intervals) {
  if (!Array.isArray(intervals) || intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out = [];
  let cur = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n.start <= cur.end) {
      cur.end = Math.max(cur.end, n.end);
    } else {
      out.push(cur);
      cur = { ...n };
    }
  }
  out.push(cur);
  return out;
}

/** Minutes inside shiftLeadWindow not covered by merged management intervals. */
function gapsWithNoManagement(shiftLeadWindow, managementIntervals) {
  const ws = shiftLeadWindow.startMinutes;
  const we = shiftLeadWindow.endMinutes;
  const merged = mergeIntervals(
    (managementIntervals || [])
      .map((m) => ({
        start: Math.max(m.start, ws),
        end: Math.min(m.end, we)
      }))
      .filter((m) => m.start < m.end)
  );
  if (merged.length === 0) {
    return [{ start: ws, end: we }];
  }
  const gaps = [];
  let x = ws;
  for (const m of merged) {
    if (m.start > we) break;
    const segEnd = Math.min(m.start, we);
    if (x < segEnd) gaps.push({ start: x, end: segEnd });
    x = Math.max(x, m.end);
    if (x >= we) break;
  }
  if (x < we) gaps.push({ start: x, end: we });
  return gaps.filter((g) => g.start < g.end);
}

function intervalOverlapsAnyGap(interval, gaps) {
  if (!interval || !gaps?.length) return false;
  return gaps.some((g) => interval.start < g.end && interval.end > g.start);
}

/** Sum of lengths of intersections of work intervals with gap intervals (minutes). */
export function sumOverlapMinutes(workIntervals, gaps) {
  if (!workIntervals?.length || !gaps?.length) return 0;
  let sum = 0;
  for (const w of workIntervals) {
    if (!w || w.start >= w.end) continue;
    for (const g of gaps) {
      if (!g || g.start >= g.end) continue;
      const s = Math.max(w.start, g.start);
      const e = Math.min(w.end, g.end);
      if (e > s) sum += e - s;
    }
  }
  return sum;
}

/** Paid-work intervals intersected with no-management gaps (merged), for clock-range display. */
export function intersectWorkIntervalsWithGaps(workIntervals, gaps) {
  const pieces = [];
  for (const w of workIntervals || []) {
    if (!w || w.start >= w.end) continue;
    for (const g of gaps || []) {
      if (!g || g.start >= g.end) continue;
      const s = Math.max(w.start, g.start);
      const e = Math.min(w.end, g.end);
      if (e > s) pieces.push({ start: s, end: e });
    }
  }
  return mergeIntervals(pieces).filter((i) => i.end > i.start);
}

/**
 * Remove `cut` from each interval in `intervals` (for unpaid breaks).
 */
export function subtractIntervalFromIntervals(intervals, cut) {
  if (!cut || cut.start >= cut.end) return intervals || [];
  const out = [];
  for (const iv of intervals || []) {
    if (!iv || iv.start >= iv.end) continue;
    if (cut.end <= iv.start || cut.start >= iv.end) {
      out.push(iv);
      continue;
    }
    if (cut.start > iv.start) {
      out.push({ start: iv.start, end: Math.min(iv.end, cut.start) });
    }
    if (cut.end < iv.end) {
      out.push({ start: Math.max(iv.start, cut.end), end: iv.end });
    }
  }
  return out.filter((i) => i.end > i.start);
}

function getOperatingWindowForDay(day, businessHours) {
  const key = day.format('dddd').toLowerCase();
  const hours = businessHours?.[key];
  if (!hours || hours.closed) return null;
  const openMinutes = timeStringToMinutes(hours.open);
  const closeMinutes = timeStringToMinutes(hours.close);
  if (openMinutes === null || closeMinutes === null) return null;
  return { openMinutes, closeMinutes };
}

function computeShiftLeadWindow(day, mergedSchedulingSettings, businessHours) {
  if (!mergedSchedulingSettings?.shift_lead_enabled) return null;
  const hours = getOperatingWindowForDay(day, businessHours);
  if (!hours) return null;

  const mode = mergedSchedulingSettings.shift_lead_mode;
  if (mode === 'fixed' && mergedSchedulingSettings.shift_lead_fixed_start) {
    const start = timeStringToMinutes(mergedSchedulingSettings.shift_lead_fixed_start);
    if (start === null) return null;
    const end = Math.max(
      start,
      hours.closeMinutes + (mergedSchedulingSettings.shift_lead_grace_after_close || 0)
    );
    return { startMinutes: start, endMinutes: end };
  }

  const start = Math.max(0, hours.openMinutes - (mergedSchedulingSettings.shift_lead_grace_before_open || 0));
  const end = Math.max(start, hours.closeMinutes + (mergedSchedulingSettings.shift_lead_grace_after_close || 0));
  return { startMinutes: start, endMinutes: end };
}

function computeAfterHoursStart(day, mergedSchedulingSettings, businessHours) {
  if (!mergedSchedulingSettings?.after_hours_enabled) return null;
  const hours = getOperatingWindowForDay(day, businessHours);
  if (!hours) return 0;
  if (mergedSchedulingSettings.after_hours_mode === 'fixed' && mergedSchedulingSettings.after_hours_fixed_start) {
    const fixed = timeStringToMinutes(mergedSchedulingSettings.after_hours_fixed_start);
    return fixed === null ? null : fixed;
  }
  return hours.closeMinutes + (mergedSchedulingSettings.after_hours_grace_after_close || 0);
}

function workingRoleForShift(shift, employee) {
  const manual = shift?.position && String(shift.position).trim();
  if (manual) return manual;
  return employee?.position && String(employee.position).trim() ? String(employee.position).trim() : '';
}

function sortPositionsByDisplayOrder(rows) {
  if (!Array.isArray(rows)) return [];
  return [...rows].sort((a, b) => {
    const hasA = a.display_order != null && a.display_order !== '';
    const hasB = b.display_order != null && b.display_order !== '';
    const na = hasA ? Number(a.display_order) : null;
    const nb = hasB ? Number(b.display_order) : null;
    if (na != null && !Number.isNaN(na) && nb != null && !Number.isNaN(nb) && na !== nb) return na - nb;
    if (na != null && !Number.isNaN(na) && (nb == null || Number.isNaN(nb))) return -1;
    if ((na == null || Number.isNaN(na)) && nb != null && !Number.isNaN(nb)) return 1;
    return (a.position_name || '').localeCompare(b.position_name || '', undefined, { sensitivity: 'base' });
  });
}

function mergeSchedulingSettings(schedulingSettings) {
  const defaultSettings = {
    shift_lead_enabled: true,
    shift_lead_position: 'Shift Lead',
    shift_lead_mode: 'relative',
    shift_lead_fixed_start: null,
    shift_lead_grace_before_open: 0,
    shift_lead_grace_after_close: 0,
    shift_lead_excluded_positions: ['President / CEO', 'Manager'],
    after_hours_enabled: true,
    after_hours_position: 'After Hours',
    after_hours_mode: 'relative',
    after_hours_fixed_start: null,
    after_hours_grace_after_close: 0
  };

  const merged = { ...defaultSettings, ...(schedulingSettings || {}) };
  merged.shift_lead_excluded_positions =
    schedulingSettings?.shift_lead_excluded_positions?.length > 0
      ? schedulingSettings.shift_lead_excluded_positions
      : defaultSettings.shift_lead_excluded_positions;
  return merged;
}

/**
 * Which positions row supplies shift_premium_id for payroll when this employee is shift-lead winner.
 * Mirrors TimesheetsTab wage matching.
 */
export function findShiftLeadPremiumPositionRow(winner, clockedPositionName, positions, mergedSchedulingSettings) {
  if (!winner || !positions?.length) return null;
  const keyChainActive = positions.some((p) => p.shift_lead_eligible === true);
  const pn = normalizePositionName(clockedPositionName);
  if (normalizePositionName(winner.positionName) === pn) {
    return positions.find((p) => normalizePositionName(p.position_name) === pn) || null;
  }
  if (
    !keyChainActive &&
    mergedSchedulingSettings?.shift_lead_position &&
    normalizePositionName(winner.positionName) ===
      normalizePositionName(mergedSchedulingSettings.shift_lead_position)
  ) {
    return (
      positions.find(
        (p) =>
          normalizePositionName(p.position_name) ===
          normalizePositionName(mergedSchedulingSettings.shift_lead_position)
      ) || null
    );
  }
  return null;
}

/**
 * @returns context needed for winner + premium overlap, or null if shift lead off / no window.
 */
export function computeShiftLeadContext({
  day,
  shifts,
  employeeById,
  positions,
  schedulingSettings,
  businessHours
}) {
  const merged = mergeSchedulingSettings(schedulingSettings);

  if (!merged.shift_lead_enabled) return null;

  const shiftLeadWindow = computeShiftLeadWindow(day, merged, businessHours);
  const afterHoursStart = computeAfterHoursStart(day, merged, businessHours);

  if (!shiftLeadWindow) return null;

  const presentShifts = (shifts || []).filter(isShiftPresentForShiftLeadPooling);

  const sortedPositions = sortPositionsByDisplayOrder(positions || []);
  const nameToPosition = new Map();
  sortedPositions.forEach((p) => {
    nameToPosition.set(normalizePositionName(p.position_name), p);
  });

  const legacyExcluded = (merged.shift_lead_excluded_positions || []).map((s) =>
    normalizePositionName(s)
  );

  const clippedEntries = presentShifts
    .map((shift) => {
      const raw = getShiftMinutes(shift);
      if (!raw) return null;
      const clipped = clipShiftToLeadPool(raw, shiftLeadWindow, merged.after_hours_enabled, afterHoursStart);
      if (!clipped) return null;
      return { shift, clipped };
    })
    .filter(Boolean);

  const managementIntervals = [];
  for (const { shift, clipped } of clippedEntries) {
    const role = workingRoleForShift(shift, employeeById.get(shift.employee_id));
    if (!role) continue;
    const row = nameToPosition.get(normalizePositionName(role));
    const isMgmt =
      row?.is_management === true || legacyExcluded.includes(normalizePositionName(role));
    if (isMgmt) managementIntervals.push(clipped);
  }

  const gaps = gapsWithNoManagement(shiftLeadWindow, managementIntervals);

  const anyEligibleFlags = sortedPositions.some((p) => p.shift_lead_eligible === true);

  return {
    merged,
    shiftLeadWindow,
    afterHoursStart,
    sortedPositions,
    nameToPosition,
    legacyExcluded,
    clippedEntries,
    gaps,
    anyEligibleFlags
  };
}

/**
 * Among shift_lead_eligible key holders whose clipped shift overlaps gaps, pick the one with
 * highest authority (lowest display_order index in keyPositions) at the midpoint of the first gap.
 * Used for schedule badge / "designated shift lead" hint — premium dollars use time-sliced attribution.
 */
function pickShiftLeadPrimaryForDisplay(ctx, employeeById) {
  const keyPositions = ctx.sortedPositions.filter((p) => p.shift_lead_eligible === true);
  if (keyPositions.length === 0 || !ctx.gaps?.length) return null;

  const eligibleClipped = ctx.clippedEntries.filter(({ shift, clipped }) => {
    const role = workingRoleForShift(shift, employeeById.get(shift.employee_id));
    if (!role) return false;
    return keyPositions.some(
      (kp) => normalizePositionName(kp.position_name) === normalizePositionName(role)
    );
  });
  if (eligibleClipped.length === 0) return null;

  function rankForRole(roleName) {
    const idx = keyPositions.findIndex(
      (kp) => normalizePositionName(kp.position_name) === normalizePositionName(roleName)
    );
    return idx === -1 ? 9999 : idx;
  }

  const gapsChrono = [...ctx.gaps].sort((a, b) => a.start - b.start);
  for (const g of gapsChrono) {
    const mid = (g.start + g.end) / 2;
    const present = eligibleClipped.filter(
      ({ clipped }) => mid >= clipped.start && mid <= clipped.end
    );
    if (present.length === 0) continue;
    present.sort((a, b) => {
      const ra = rankForRole(workingRoleForShift(a.shift, employeeById.get(a.shift.employee_id)));
      const rb = rankForRole(workingRoleForShift(b.shift, employeeById.get(b.shift.employee_id)));
      if (ra !== rb) return ra - rb;
      return String(a.shift.employee_id).localeCompare(String(b.shift.employee_id));
    });
    const win = present[0];
    const role = workingRoleForShift(win.shift, employeeById.get(win.shift.employee_id));
    return { employeeId: win.shift.employee_id, positionName: role || keyPositions[0]?.position_name };
  }
  return null;
}

/** Legacy (non–key-chain) single winner by tenure when shift_lead_eligible is unused. */
function pickShiftLeadWinner(ctx, employeeById) {
  const { merged, clippedEntries, gaps } = ctx;

  const eligible = clippedEntries.filter(({ shift, clipped }) => {
    if (shift.position && String(shift.position).trim().length > 0) return false;
    if (!intervalOverlapsAnyGap(clipped, gaps)) return false;
    const emp = employeeById.get(shift.employee_id);
    if (!emp) return false;
    const role = workingRoleForShift(shift, emp);
    if (ctx.legacyExcluded.includes(normalizePositionName(role))) return false;
    return true;
  });

  if (eligible.length === 0) return null;

  const compareTenure = (empA, empB) => {
    const dateA = empA?.hireDate ? new Date(empA.hireDate).getTime() : Number.POSITIVE_INFINITY;
    const dateB = empB?.hireDate ? new Date(empB.hireDate).getTime() : Number.POSITIVE_INFINITY;
    if (dateA !== dateB) return dateA - dateB;
    const nameA = empA?.full_name || '';
    const nameB = empB?.full_name || '';
    return nameA.localeCompare(nameB);
  };

  const winner = eligible.reduce((bestId, { shift }) => {
    const currentEmp = employeeById.get(shift.employee_id);
    const bestEmp = employeeById.get(bestId);
    if (!bestId) return shift.employee_id;
    return compareTenure(currentEmp, bestEmp) < 0 ? shift.employee_id : bestId;
  }, null);

  return winner
    ? { employeeId: winner, positionName: merged.shift_lead_position || 'Shift Lead' }
    : null;
}

/**
 * Key-chain mode: slice the day at clock boundaries; in each slice inside a no-management gap,
 * the highest-ranking eligible key holder who is clocked in earns premium minutes (∩ their paid work).
 */
function computeKeyChainShiftLeadPremiumMinutes({
  ctx,
  employeeById,
  employeeId,
  clockedPositionName,
  paidWorkIntervalsMinutes,
  positions
}) {
  const keyPositions = ctx.sortedPositions.filter((p) => p.shift_lead_eligible === true);
  if (keyPositions.length === 0) return 0;

  const eligibleClipped = ctx.clippedEntries.filter(({ shift, clipped }) => {
    const role = workingRoleForShift(shift, employeeById.get(shift.employee_id));
    if (!role) return false;
    return keyPositions.some(
      (kp) => normalizePositionName(kp.position_name) === normalizePositionName(role)
    );
  });
  if (eligibleClipped.length === 0) return 0;

  const employeeHasKeyRole = eligibleClipped.some(({ shift }) => shift.employee_id === employeeId);
  if (!employeeHasKeyRole) return 0;

  function rankForRole(roleName) {
    const idx = keyPositions.findIndex(
      (kp) => normalizePositionName(kp.position_name) === normalizePositionName(roleName)
    );
    return idx === -1 ? 9999 : idx;
  }

  const boundaries = new Set();
  for (const g of ctx.gaps) {
    boundaries.add(g.start);
    boundaries.add(g.end);
  }
  for (const { clipped } of eligibleClipped) {
    boundaries.add(clipped.start);
    boundaries.add(clipped.end);
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  if (sorted.length < 2) return 0;

  function midpointInsideGap(mid, gaps) {
    return gaps.some((g) => mid >= g.start && mid <= g.end);
  }

  let total = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const t1 = sorted[i];
    const t2 = sorted[i + 1];
    if (t2 <= t1) continue;
    const mid = (t1 + t2) / 2;
    if (!midpointInsideGap(mid, ctx.gaps)) continue;

    const present = eligibleClipped.filter(
      ({ clipped }) => mid >= clipped.start && mid <= clipped.end
    );
    if (present.length === 0) continue;

    present.sort((a, b) => {
      const ra = rankForRole(workingRoleForShift(a.shift, employeeById.get(a.shift.employee_id)));
      const rb = rankForRole(workingRoleForShift(b.shift, employeeById.get(b.shift.employee_id)));
      if (ra !== rb) return ra - rb;
      return String(a.shift.employee_id).localeCompare(String(b.shift.employee_id));
    });

    const sliceWinner = present[0];
    if (sliceWinner.shift.employee_id !== employeeId) continue;

    total += sumOverlapMinutes([{ start: t1, end: t2 }], paidWorkIntervalsMinutes || []);
  }

  return total;
}

/**
 * Minute intervals where this employee earns shift-lead premium (key-chain: time-sliced;
 * legacy: paid work ∩ gaps when they are the sole winner).
 */
export function getShiftLeadPremiumEarnedIntervalsMinutes({
  day,
  shifts,
  employeeById,
  positions,
  schedulingSettings,
  businessHours,
  employeeId,
  clockedPositionName,
  paidWorkIntervalsMinutes
}) {
  const ctx = computeShiftLeadContext({
    day,
    shifts,
    employeeById,
    positions,
    schedulingSettings,
    businessHours
  });
  if (!ctx) return [];

  if (!ctx.anyEligibleFlags) {
    const winner = pickShiftLeadWinner(ctx, employeeById);
    if (!winner || winner.employeeId !== employeeId) return [];
    const row = findShiftLeadPremiumPositionRow(winner, clockedPositionName, positions, ctx.merged);
    if (!row?.shift_premium_id) return [];
    return intersectWorkIntervalsWithGaps(paidWorkIntervalsMinutes || [], ctx.gaps);
  }

  const keyPositions = ctx.sortedPositions.filter((p) => p.shift_lead_eligible === true);
  if (keyPositions.length === 0) return [];

  const eligibleClipped = ctx.clippedEntries.filter(({ shift, clipped }) => {
    const role = workingRoleForShift(shift, employeeById.get(shift.employee_id));
    if (!role) return false;
    return keyPositions.some(
      (kp) => normalizePositionName(kp.position_name) === normalizePositionName(role)
    );
  });
  if (eligibleClipped.length === 0) return [];

  const employeeHasKeyRole = eligibleClipped.some(({ shift }) => shift.employee_id === employeeId);
  if (!employeeHasKeyRole) return [];

  function rankForRole(roleName) {
    const idx = keyPositions.findIndex(
      (kp) => normalizePositionName(kp.position_name) === normalizePositionName(roleName)
    );
    return idx === -1 ? 9999 : idx;
  }

  const boundaries = new Set();
  for (const g of ctx.gaps) {
    boundaries.add(g.start);
    boundaries.add(g.end);
  }
  for (const { clipped } of eligibleClipped) {
    boundaries.add(clipped.start);
    boundaries.add(clipped.end);
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  if (sorted.length < 2) return [];

  function midpointInsideGap(mid, gaps) {
    return gaps.some((g) => mid >= g.start && mid <= g.end);
  }

  const pieces = [];
  const paid = paidWorkIntervalsMinutes || [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const t1 = sorted[i];
    const t2 = sorted[i + 1];
    if (t2 <= t1) continue;
    const mid = (t1 + t2) / 2;
    if (!midpointInsideGap(mid, ctx.gaps)) continue;

    const present = eligibleClipped.filter(
      ({ clipped }) => mid >= clipped.start && mid <= clipped.end
    );
    if (present.length === 0) continue;

    present.sort((a, b) => {
      const ra = rankForRole(workingRoleForShift(a.shift, employeeById.get(a.shift.employee_id)));
      const rb = rankForRole(workingRoleForShift(b.shift, employeeById.get(b.shift.employee_id)));
      if (ra !== rb) return ra - rb;
      return String(a.shift.employee_id).localeCompare(String(b.shift.employee_id));
    });

    const sliceWinner = present[0];
    if (sliceWinner.shift.employee_id !== employeeId) continue;

    for (const w of paid) {
      if (!w || w.start >= w.end) continue;
      const s = Math.max(t1, w.start);
      const e = Math.min(t2, w.end);
      if (e > s) pieces.push({ start: s, end: e });
    }
  }

  return mergeIntervals(pieces).filter((iv) => iv.end > iv.start);
}

/** Premium row for key-chain payout lines (matches employee's clocked key role). */
export function getShiftLeadPremiumRateRowForClocked(clockedPositionName, positions) {
  const row = positions.find(
    (p) => normalizePositionName(p.position_name) === normalizePositionName(clockedPositionName)
  );
  if (!row?.shift_premium_id || row.shift_lead_eligible !== true) return null;
  return row;
}

/** Highest-ranking key role this employee worked that day (for split-shift days). */
export function getShiftLeadPremiumRateRowForKeyChainEmployee({
  employeeId,
  dayShifts,
  employeeById,
  positions
}) {
  const keyPositions = sortPositionsByDisplayOrder(
    (positions || []).filter((p) => p.shift_lead_eligible === true && p.shift_premium_id)
  );
  if (keyPositions.length === 0) return null;

  let best = null;
  let bestRank = 9999;
  for (const shift of dayShifts || []) {
    if (shift.employee_id !== employeeId) continue;
    const role = workingRoleForShift(shift, employeeById.get(employeeId));
    const idx = keyPositions.findIndex(
      (kp) => normalizePositionName(kp.position_name) === normalizePositionName(role)
    );
    if (idx !== -1 && idx < bestRank) {
      bestRank = idx;
      best = keyPositions[idx];
    }
  }
  return best;
}

/**
 * Paid minutes that qualify for shift-lead premium (work time ∩ periods with no management on site ∩ shift-lead window).
 * @param {Array<{start:number,end:number}>} paidWorkIntervalsMinutes — minutes from midnight; unpaid breaks excluded
 */
export function getShiftLeadPremiumPayableMinutes({
  day,
  shifts,
  employeeById,
  positions,
  schedulingSettings,
  businessHours,
  employeeId,
  clockedPositionName,
  paidWorkIntervalsMinutes
}) {
  const ctx = computeShiftLeadContext({
    day,
    shifts,
    employeeById,
    positions,
    schedulingSettings,
    businessHours
  });
  if (!ctx) return 0;

  if (ctx.anyEligibleFlags) {
    return computeKeyChainShiftLeadPremiumMinutes({
      ctx,
      employeeById,
      employeeId,
      clockedPositionName,
      paidWorkIntervalsMinutes,
      positions
    });
  }

  const winner = pickShiftLeadWinner(ctx, employeeById);
  if (!winner || winner.employeeId !== employeeId) return 0;

  const row = findShiftLeadPremiumPositionRow(winner, clockedPositionName, positions, ctx.merged);
  if (!row?.shift_premium_id) return 0;

  return sumOverlapMinutes(paidWorkIntervalsMinutes || [], ctx.gaps);
}

/**
 * @returns {{ employeeId: string, positionName: string } | null}
 */
export function resolveShiftLeadForDay({
  day,
  shifts,
  employeeById,
  positions,
  schedulingSettings,
  businessHours
}) {
  const ctx = computeShiftLeadContext({
    day,
    shifts,
    employeeById,
    positions,
    schedulingSettings,
    businessHours
  });
  if (!ctx) return null;
  if (ctx.anyEligibleFlags) {
    return pickShiftLeadPrimaryForDisplay(ctx, employeeById);
  }
  return pickShiftLeadWinner(ctx, employeeById);
}
