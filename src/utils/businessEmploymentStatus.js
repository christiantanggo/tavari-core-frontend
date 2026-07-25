/**
 * Per-business employment lifecycle (business_users), not global users.employment_status.
 */

const PRIVILEGED_ROLES = new Set(['owner', 'admin', 'manager']);

export function isPrivilegedMembershipRole(role) {
  return PRIVILEGED_ROLES.has(String(role || '').toLowerCase());
}

export function resolveEmploymentFields({ membership, user } = {}) {
  const employment_status =
    membership?.employment_status ??
    user?.employment_status ??
    'active';
  const termination_date =
    membership?.termination_date ??
    user?.termination_date ??
    null;

  return { employment_status, termination_date };
}

export function isTerminatedEmployment({ employment_status } = {}) {
  return String(employment_status || '').toLowerCase() === 'terminated';
}

export function isTerminatedAtBusiness({ membership, user, role } = {}) {
  if (isPrivilegedMembershipRole(role ?? membership?.role)) return false;
  return isTerminatedEmployment(resolveEmploymentFields({ membership, user }));
}

/** Active employees only — terminated staff never appear on the schedule grid. */
export function isSchedulingVisibleForWeek({ membership, user, role } = {}) {
  if (isPrivilegedMembershipRole(role ?? membership?.role)) return true;
  if (isTerminatedAtBusiness({ membership, user, role })) return false;
  if (isTerminatedEmployment({ employment_status: user?.employment_status })) return false;
  return true;
}

export async function fetchBusinessMembership(supabase, userId, businessId) {
  if (!supabase || !userId || !businessId) return null;

  const { data, error } = await supabase
    .from('business_users')
    .select('user_id, business_id, role, employment_status, termination_date')
    .eq('user_id', userId)
    .eq('business_id', businessId)
    .maybeSingle();

  if (error) {
    console.warn('[businessEmploymentStatus] fetchBusinessMembership failed:', error.message);
    return null;
  }

  return data;
}

export async function updateBusinessEmploymentStatus(
  supabase,
  { userId, businessId, employment_status, termination_date },
) {
  if (!supabase || !userId || !businessId) {
    return { data: null, error: new Error('userId and businessId are required') };
  }

  const patch = { employment_status };
  if (termination_date !== undefined) {
    patch.termination_date = termination_date;
  }

  const { data, error } = await supabase
    .from('business_users')
    .update(patch)
    .eq('user_id', userId)
    .eq('business_id', businessId)
    .select('user_id, business_id, employment_status, termination_date')
    .maybeSingle();

  return { data, error };
}

export async function mergeBusinessEmploymentOntoEmployees(supabase, businessId, employees) {
  if (!employees?.length || !businessId) return employees || [];

  const ids = [...new Set(employees.map((e) => e.id).filter(Boolean))];
  if (!ids.length) return employees;

  const { data: rows, error } = await supabase
    .from('business_users')
    .select('user_id, employment_status, termination_date')
    .eq('business_id', businessId)
    .in('user_id', ids);

  if (error) {
    console.warn('[businessEmploymentStatus] mergeBusinessEmploymentOntoEmployees failed:', error.message);
    return employees;
  }

  const byUserId = new Map((rows || []).map((row) => [row.user_id, row]));

  return employees.map((employee) => {
    const membership = byUserId.get(employee.id);
    if (!membership) return employee;

    const resolved = resolveEmploymentFields({ membership, user: employee });
    return {
      ...employee,
      employment_status: resolved.employment_status,
      termination_date: resolved.termination_date,
      business_employment_status: membership.employment_status,
      business_termination_date: membership.termination_date,
    };
  });
}
