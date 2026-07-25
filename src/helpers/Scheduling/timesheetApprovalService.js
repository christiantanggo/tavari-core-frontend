import { supabase } from '../../supabaseClient';
import { aggregateTimesheetHoursForPayPeriod } from '../Payroll/aggregateTimesheetHoursForPayPeriod';
import {
  aggregateShiftLeadPremiumHoursForPayPeriod,
  mapShiftLeadAggToEmployeePremiumHours
} from '../Payroll/aggregateShiftLeadPremiumHoursForPayPeriod';
import { aggregateConfigurablePremiumHoursForPayPeriod } from '../Payroll/aggregateConfigurablePremiumHoursForPayPeriod';

function round2(n) {
  return Math.round(parseFloat(n) * 100) / 100;
}

/**
 * Linked DB has not applied the timesheet approvals migration, or the REST route is missing.
 * PostgREST returns 404 / PGRST205 when the table is absent from the schema cache.
 */
export function isTimesheetApprovalsUnavailable(error) {
  if (!error) return false;
  const code = error.code;
  const msg = String(error.message || '').toLowerCase();
  const details = String(error.details || '').toLowerCase();
  if (code === 'PGRST205' || code === '42P01') return true;
  if (error.status === 404 || error.statusCode === 404) return true;
  if (msg.includes('could not find the table') || msg.includes('schema cache')) return true;
  if (details.includes('could not find the table')) return true;
  if (msg.includes('does not exist') && msg.includes('relation')) return true;
  return false;
}

/**
 * Build payroll-ready lines for each employee in the period (clocks + shift-lead engine +
 * all_hours premiums assigned to the employee). Mirrors what payroll expects in premium_hours.
 */
export async function buildTimesheetApprovalSnapshot({ businessId, periodStart, periodEnd }) {
  if (!businessId || !periodStart || !periodEnd) {
    return { lines: [] };
  }

  const [{ byEmployeeId }, shiftLeadAgg, configurablePremiumHours] = await Promise.all([
    aggregateTimesheetHoursForPayPeriod({
      businessId,
      periodStart,
      periodEnd
    }),
    aggregateShiftLeadPremiumHoursForPayPeriod({
      businessId,
      periodStart,
      periodEnd
    }),
    aggregateConfigurablePremiumHoursForPayPeriod({
      businessId,
      periodStart,
      periodEnd
    })
  ]);

  const { data: premiumsRows } = await supabase
    .from('hr_shift_premiums')
    .select('id, name, applies_to')
    .eq('business_id', businessId);

  const premiums = premiumsRows || [];

  const empSet = new Set([
    ...Object.keys(byEmployeeId || {}),
    ...Object.keys(shiftLeadAgg?.byEmployeePremiumId || {})
  ]);

  const employeeIds = [...empSet];
  if (employeeIds.length === 0) {
    return { lines: [] };
  }

  let assignments = [];
  if (employeeIds.length > 0) {
    const { data } = await supabase
      .from('hrpayroll_employee_premiums')
      .select('user_id, premium_name')
      .eq('business_id', businessId)
      .in('user_id', employeeIds)
      .eq('is_active', true);
    assignments = data || [];
  }

  const enabledNamesByUser = {};
  assignments.forEach((a) => {
    if (!a?.user_id || !a.premium_name) return;
    if (!enabledNamesByUser[a.user_id]) enabledNamesByUser[a.user_id] = new Set();
    enabledNamesByUser[a.user_id].add(a.premium_name);
  });

  const lines = [];
  for (const empId of employeeIds) {
    const total = parseFloat(byEmployeeId[empId]) || 0;
    const premium_hours = {};

    const shiftLeadHours = mapShiftLeadAggToEmployeePremiumHours(shiftLeadAgg, empId, premiums);
    Object.assign(premium_hours, shiftLeadHours);

    const enabled = enabledNamesByUser[empId];
    const cfgHours = configurablePremiumHours[empId] || {};

    premiums.forEach((p) => {
      if (p.applies_to !== 'all_hours') return;
      if (!enabled?.has(p.name)) return;
      if (Object.prototype.hasOwnProperty.call(cfgHours, p.name)) {
        premium_hours[p.name] = round2(cfgHours[p.name]);
      } else {
        premium_hours[p.name] = round2(total);
      }
    });

    lines.push({
      user_id: empId,
      total_hours: round2(total),
      overtime_hours: 0,
      premium_hours
    });
  }

  return { lines };
}

/**
 * Replace any existing approval for the same business + period, then insert snapshot rows.
 */
export async function saveTimesheetApproval({
  businessId,
  periodStart,
  periodEnd,
  approvedByUserId,
  notes = null
}) {
  const { lines } = await buildTimesheetApprovalSnapshot({
    businessId,
    periodStart,
    periodEnd
  });

  const { data: existing } = await supabase
    .from('scheduling_timesheet_approvals')
    .select('id')
    .eq('business_id', businessId)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .maybeSingle();

  if (existing?.id) {
    await supabase.from('scheduling_timesheet_approval_lines').delete().eq('approval_id', existing.id);
    await supabase.from('scheduling_timesheet_approvals').delete().eq('id', existing.id);
  }

  const { data: approval, error } = await supabase
    .from('scheduling_timesheet_approvals')
    .insert({
      business_id: businessId,
      period_start: periodStart,
      period_end: periodEnd,
      status: 'approved',
      approved_by: approvedByUserId || null,
      notes: notes || null
    })
    .select()
    .single();

  if (error) throw error;

  if (lines.length > 0) {
    const rows = lines.map((l) => ({
      approval_id: approval.id,
      user_id: l.user_id,
      total_hours: l.total_hours,
      overtime_hours: l.overtime_hours,
      premium_hours: l.premium_hours
    }));
    const { error: lineErr } = await supabase.from('scheduling_timesheet_approval_lines').insert(rows);
    if (lineErr) throw lineErr;
  }

  return approval;
}

/**
 * Load approved snapshot for payroll / modal hydration.
 * @returns {Promise<{ approval: object, byEmployeeId: Record<string, { total_hours: number, overtime_hours: number, premium_hours: object }> } | null>}
 */
/** Approval header only (for Timesheets badge). */
export async function fetchTimesheetApprovalRecord(businessId, periodStart, periodEnd) {
  if (!businessId || !periodStart || !periodEnd) return null;
  const { data, error } = await supabase
    .from('scheduling_timesheet_approvals')
    .select('id, approved_at, approved_by')
    .eq('business_id', businessId)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .eq('status', 'approved')
    .maybeSingle();
  if (error && isTimesheetApprovalsUnavailable(error)) return null;
  if (error) return null;
  return data || null;
}

export async function fetchApprovedTimesheetSnapshot(businessId, periodStart, periodEnd) {
  if (!businessId || !periodStart || !periodEnd) return null;

  const { data: approval, error } = await supabase
    .from('scheduling_timesheet_approvals')
    .select('id, approved_at, approved_by, period_start, period_end')
    .eq('business_id', businessId)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .eq('status', 'approved')
    .maybeSingle();

  if (error && isTimesheetApprovalsUnavailable(error)) return null;
  if (error || !approval?.id) return null;

  const { data: lineRows, error: linesError } = await supabase
    .from('scheduling_timesheet_approval_lines')
    .select('user_id, total_hours, overtime_hours, premium_hours')
    .eq('approval_id', approval.id);

  if (linesError && isTimesheetApprovalsUnavailable(linesError)) return null;
  if (linesError) return null;

  const byEmployeeId = {};
  (lineRows || []).forEach((row) => {
    byEmployeeId[row.user_id] = {
      total_hours: parseFloat(row.total_hours) || 0,
      overtime_hours: parseFloat(row.overtime_hours) || 0,
      premium_hours:
        row.premium_hours && typeof row.premium_hours === 'object' ? row.premium_hours : {}
    };
  });

  return { approval, byEmployeeId };
}
