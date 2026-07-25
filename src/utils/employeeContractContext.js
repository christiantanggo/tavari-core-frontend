import { supabase } from '../supabaseClient';

const SIGNED_STATUSES = new Set(['signed', 'active']);
const LIFECYCLE_STATUSES = new Set([
  'active',
  'probation',
  'terminated',
  'suspended',
  'on_leave',
  'pending',
]);

const parseDateOnly = (value) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const dateOnly = raw.includes('T') ? raw.split('T')[0] : raw.slice(0, 10);
    const parts = dateOnly.split('-').map(Number);
    if (parts.length === 3 && !parts.some((n) => Number.isNaN(n))) {
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
    const [month, day, year] = raw.split('/').map(Number);
    if (![month, day, year].some((n) => Number.isNaN(n))) {
      return new Date(year, month - 1, day);
    }
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }
  return null;
};

/** keyTerms may live under contract_data.keyTerms or flat on contract_data (legacy). */
export const getContractKeyTerms = (contract) => {
  const data = contract?.contract_data;
  if (!data || typeof data !== 'object') return {};
  if (data.keyTerms && typeof data.keyTerms === 'object') return data.keyTerms;
  return data;
};

export const getEmploymentStartDate = (contract, user = null) => {
  if (!contract && !user) return null;
  const keyTerms = contract ? getContractKeyTerms(contract) : {};
  return (
    parseDateOnly(contract?.start_date) ||
    parseDateOnly(keyTerms.contractStartDate) ||
    parseDateOnly(keyTerms.startDate) ||
    parseDateOnly(user?.hire_date) ||
    null
  );
};

/** @deprecated use getEmploymentStartDate */
const getContractStartDate = (contract) => getEmploymentStartDate(contract, null);

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const daysBetween = (from, to) => {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
};

const formatTenure = (totalDays) => {
  if (totalDays <= 0) return '0 days';
  if (totalDays < 30) {
    return `${totalDays} day${totalDays === 1 ? '' : 's'}`;
  }
  if (totalDays < 365) {
    const months = Math.floor(totalDays / 30);
    return `${months} month${months === 1 ? '' : 's'}`;
  }
  const years = Math.floor(totalDays / 365);
  const remainingMonths = Math.floor((totalDays % 365) / 30);
  return `${years} year${years === 1 ? '' : 's'}${
    remainingMonths > 0
      ? `, ${remainingMonths} month${remainingMonths === 1 ? '' : 's'}`
      : ''
  }`;
};

/** Probation end from contract row, key terms, or start + probationary period. */
export const getProbationEndDate = (contract, user = null) => {
  if (!contract) return null;

  const keyTerms = getContractKeyTerms(contract);

  const explicitEnd =
    parseDateOnly(contract.probation_end_date) ||
    parseDateOnly(keyTerms.probationEndDate) ||
    parseDateOnly(keyTerms.probation_end_date) ||
    parseDateOnly(keyTerms.probationEnd) ||
    null;

  if (explicitEnd) return explicitEnd;

  const start = getEmploymentStartDate(contract, user);
  const periodRaw =
    keyTerms.probationaryPeriod ??
    keyTerms.probation_period ??
    keyTerms.probationPeriod ??
    (keyTerms.probationMonths != null ? Number(keyTerms.probationMonths) * 30 : null);

  if (start && periodRaw != null && Number(periodRaw) > 0) {
    const end = new Date(start);
    end.setDate(end.getDate() + Number(periodRaw));
    return end;
  }

  // Contract on file with a start date — default 90-day probation (Ontario standard)
  if (start) {
    const end = new Date(start);
    end.setDate(end.getDate() + 90);
    return end;
  }

  return null;
};

/** True when employment has started and today is on or before probation end. */
export const isWithinProbationPeriod = (user, contract) => {
  if (!contract) return false;
  const today = startOfDay(new Date());
  const start = getEmploymentStartDate(contract, user);
  const end = getProbationEndDate(contract, user);
  if (!start || !end) return false;
  return today >= startOfDay(start) && today <= startOfDay(end);
};

export const getContractEndDate = (contract) => {
  if (!contract) return null;
  const keyTerms = getContractKeyTerms(contract);
  return (
    parseDateOnly(contract.end_date) ||
    parseDateOnly(contract.expiry_date) ||
    parseDateOnly(keyTerms.contractEndDate) ||
    null
  );
};

const getContractSignedAt = (contract) => {
  if (!contract) return null;
  const keyTerms = getContractKeyTerms(contract);
  const data = contract.contract_data && typeof contract.contract_data === 'object'
    ? contract.contract_data
    : {};
  return (
    parseDateOnly(contract.signed_at) ||
    parseDateOnly(data.authorized_representative_signed_at) ||
    parseDateOnly(data.employee_signed_at) ||
    parseDateOnly(keyTerms.authorizedRepSignedAt) ||
    parseDateOnly(keyTerms.employeeSignedAt) ||
    null
  );
};

const contractPriority = (status) => {
  const map = { signed: 5, active: 5, employee_signed: 3, sent: 2, draft: 1 };
  return map[(status || '').toLowerCase()] || 0;
};

/** Seasonal or fixed-term agreement (has an end date or explicit type). */
export const isSeasonalOrFixedTermContract = (contract) => {
  if (!contract) return false;
  const keyTerms = getContractKeyTerms(contract);
  const type = (contract.contract_type || keyTerms.employmentType || '')
    .toLowerCase()
    .replace(/_/g, '-');
  const end = getContractEndDate(contract);
  return (
    type === 'seasonal' ||
    type === 'temporary-contract' ||
    type === 'temporary' ||
    Boolean(end && type !== 'permanent')
  );
};

/** Employment term end date is before today. */
export const isContractEmploymentTermExpired = (contract) => {
  const end = getContractEndDate(contract);
  if (!end) return false;
  return startOfDay(new Date()) > startOfDay(end);
};

/**
 * Seasonal/fixed-term contract whose end date has passed.
 * When this is the only agreement on file, the employee is treated as a permanent active employee.
 */
export const isExpiredSeasonalContract = (contract) =>
  isSeasonalOrFixedTermContract(contract) && isContractEmploymentTermExpired(contract);

/** Prefer current/future agreements over expired seasonal ones; then status; then recency. */
const contractSelectionScore = (row) => {
  if (!row) return -Infinity;
  const statusP = contractPriority(row.status);
  const updatedBoost = new Date(row.updated_at || 0).getTime() / 1e12;
  if (isExpiredSeasonalContract(row)) {
    return statusP * 10 + updatedBoost;
  }
  return statusP * 1000 + 200 + updatedBoost;
};

const pickBetterContract = (candidate, incumbent) =>
  contractSelectionScore(candidate) >= contractSelectionScore(incumbent) ? candidate : incumbent;

/** Columns that exist on all hr_contracts deployments (JSONB carries the rest). */
const CONTRACT_SELECT_CORE = `id, business_id, employee_id, employee_email, employee_first_name, employee_last_name,
  status, contract_data, updated_at, signed_at, sent_at`;

const CONTRACT_SELECT_EXTENDED = `${CONTRACT_SELECT_CORE},
  contract_type, employment_status, start_date, end_date, expiry_date, probation_end_date`;

const fetchContractsForBusiness = async (businessId, selectColumns) =>
  supabase
    .from('hr_contracts')
    .select(selectColumns)
    .eq('business_id', businessId)
    .neq('status', 'draft')
    .order('updated_at', { ascending: false })
    .limit(1000);

/** Latest relevant contract per employee email / id for one business. */
export const loadContractsByBusiness = async (businessId) => {
  if (!businessId) return new Map();

  let data = null;
  let error = null;

  for (const selectColumns of [CONTRACT_SELECT_EXTENDED, CONTRACT_SELECT_CORE]) {
    ({ data, error } = await fetchContractsForBusiness(businessId, selectColumns));
    if (!error) break;
    console.warn('[employeeContractContext] loadContractsByBusiness retry:', error.message);
  }

  if (error) {
    console.warn('[employeeContractContext] loadContractsByBusiness:', error);
    return new Map();
  }

  const byKey = new Map();
  for (const row of data || []) {
    const keys = new Set();
    if (row.employee_id) keys.add(`id:${row.employee_id}`);
    if (row.employee_email) keys.add(`email:${row.employee_email.trim().toLowerCase()}`);

    for (const key of keys) {
      const existing = byKey.get(key);
      byKey.set(key, !existing ? row : pickBetterContract(row, existing));
    }
  }
  return byKey;
};

export const pickContractForEmployee = (contractsByKey, employee) => {
  if (!contractsByKey || !employee) return null;
  return (
    contractsByKey.get(`id:${employee.id}`) ||
    contractsByKey.get(`email:${(employee.email || '').trim().toLowerCase()}`) ||
    null
  );
};

/**
 * Lifecycle: probation while within contract probation window (start → end).
 * Pending until contract is sent and employment start is in the future, or no contract terms.
 * Active after probation ends or when fully employed past probation with signed contract.
 */
export const computeLifecycleStatus = (user, contract) => {
  const stored = (user?.employment_status || '').toLowerCase();
  if (stored === 'terminated' || user?.termination_date) return 'terminated';
  if (stored === 'suspended') return 'suspended';
  if (stored === 'on_leave') return 'on_leave';

  if (!contract) {
    if (stored === 'probation') return 'probation';
    if (['active', 'full-time', 'part-time', 'part_time'].includes(stored)) return 'active';
    return 'pending';
  }

  // Expired seasonal with no newer contract on file → ongoing permanent employment
  if (isExpiredSeasonalContract(contract)) {
    if (isWithinProbationPeriod(user, contract)) return 'probation';
    return 'active';
  }

  const today = startOfDay(new Date());
  const employmentStart = getEmploymentStartDate(contract, user);
  const probationEnd = getProbationEndDate(contract, user);
  const contractStatus = (contract.status || '').toLowerCase();
  const isFullySigned = SIGNED_STATUSES.has(contractStatus);

  if (employmentStart && probationEnd && today >= startOfDay(employmentStart) && today <= startOfDay(probationEnd)) {
    return 'probation';
  }

  if (!isFullySigned) {
    if (employmentStart && today < startOfDay(employmentStart)) {
      return 'pending';
    }
  }

  if (stored === 'probation' && probationEnd && today <= startOfDay(probationEnd)) {
    return 'probation';
  }

  if (isFullySigned) {
    return 'active';
  }

  return 'pending';
};

/** Tenure starts when contract is signed and employment start date is reached. */
export const computeTenureFromContract = (contract) => {
  if (!contract || !SIGNED_STATUSES.has(contract.status)) {
    return '0 days';
  }

  const today = startOfDay(new Date());
  const startDate = getEmploymentStartDate(contract, null);
  const signedAt = getContractSignedAt(contract);

  let tenureStart = startDate || signedAt;
  if (startDate && signedAt && signedAt > startDate) {
    tenureStart = signedAt;
  }

  if (!tenureStart || tenureStart > today) {
    return '0 days';
  }

  return formatTenure(daysBetween(tenureStart, today));
};

export const getWorkScheduleLabel = (contract) => {
  const schedule = (
    contract?.employment_status ||
    contract?.contract_data?.keyTerms?.employmentStatus ||
    ''
  ).toLowerCase();
  if (schedule === 'part-time' || schedule === 'part_time') return 'Part Time';
  if (schedule === 'full-time' || schedule === 'full_time') return 'Full Time';
  return null;
};

export const getSeasonalContractBadge = (contract) => {
  if (!contract || isExpiredSeasonalContract(contract)) return null;

  const keyTerms = getContractKeyTerms(contract);
  const type = (contract.contract_type || keyTerms.employmentType || '')
    .toLowerCase()
    .replace(/_/g, '-');
  const end = getContractEndDate(contract);
  const isSeasonal =
    type === 'seasonal' ||
    type === 'temporary-contract' ||
    type === 'temporary' ||
    Boolean(end && type !== 'permanent');

  if (!isSeasonal) return null;

  const endLabel = end
    ? end.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  return {
    label: type === 'seasonal' ? 'Seasonal' : 'Fixed Term',
    endDate: end,
    display: endLabel ? `${type === 'seasonal' ? 'Seasonal' : 'Fixed term'} · ends ${endLabel}` : 'Seasonal',
  };
};

const toDateString = (date) => {
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString().split('T')[0];
};

export const enrichEmployeeWithContractContext = (employee, contract) => {
  try {
  const rolledToPermanent = isExpiredSeasonalContract(contract);
  const lifecycle_status = computeLifecycleStatus(employee, contract);
  const work_schedule = getWorkScheduleLabel(contract);
  const seasonal_contract = getSeasonalContractBadge(contract);
  const probation_end_date = getProbationEndDate(contract, employee);
  const contract_end_date = rolledToPermanent ? null : getContractEndDate(contract);
  const contractTypeRaw =
    contract?.contract_type || getContractKeyTerms(contract).employmentType || null;

  return {
    ...employee,
    contract_id: contract?.id || null,
    contract_status: contract?.status || null,
    contract_type: rolledToPermanent ? 'permanent' : contractTypeRaw,
    lifecycle_status,
    work_schedule,
    seasonal_contract,
    employment_rolled_to_permanent: rolledToPermanent,
    probation_end_date: toDateString(probation_end_date),
    contract_end_date: toDateString(contract_end_date),
    employment_status: lifecycle_status,
    tenure: computeTenureFromContract(contract),
    has_signed_contract: contract ? SIGNED_STATUSES.has(contract.status) : false,
  };
  } catch (err) {
    console.warn('[employeeContractContext] enrichEmployeeWithContractContext:', err);
    return { ...employee, lifecycle_status: employee.employment_status || 'active' };
  }
};

/** After full sign: persist lifecycle on users row for filters/reports. */
export const syncEmployeeLifecycleFromSignedContract = async (contract, employeeId) => {
  if (!contract?.business_id || !employeeId || !SIGNED_STATUSES.has(contract.status)) {
    return { success: false };
  }

  const lifecycle = computeLifecycleStatus(
    { employment_status: 'active', termination_date: null },
    contract
  );
  const payload = {
    employment_status: LIFECYCLE_STATUSES.has(lifecycle) ? lifecycle : 'active',
    updated_at: new Date().toISOString(),
  };

  if (contract.start_date) {
    payload.hire_date = contract.start_date;
  }

  const { error } = await supabase.from('users').update(payload).eq('id', employeeId);
  if (error) {
    console.warn('[employeeContractContext] syncEmployeeLifecycleFromSignedContract:', error);
    return { success: false, error };
  }
  return { success: true, lifecycle };
};
