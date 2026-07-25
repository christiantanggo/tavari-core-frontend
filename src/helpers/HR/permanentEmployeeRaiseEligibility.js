/**
 * Eligibility for bulk "permanent employee" wage increases.
 *
 * Eligible when:
 * - Not terminated
 * - Past 3-month probation (probation_end_date, else hire_date + 90 days)
 * - Not currently on an active seasonal / temporary / contract term
 *   (contract end date still in the future, or no end date on seasonal/temp)
 *
 * Employees whose seasonal/contract end date has passed remain eligible
 * if they are still employed and past probation.
 */

const CONTRACT_EMPLOYMENT_TYPES = new Set([
  'seasonal',
  'temporary',
  'temporary-contract',
  'temp',
  'contract',
  'fixed-term',
  'fixed_term',
]);

const PROBATION_DAYS = 90;

function parseDateOnly(value) {
  if (!value) return null;
  const raw = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfLocalDay(date) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isContractStyleEmployment(contractType, employmentType) {
  const values = [contractType, employmentType]
    .map((v) => String(v || '').toLowerCase().trim())
    .filter(Boolean);
  return values.some(
    (v) => CONTRACT_EMPLOYMENT_TYPES.has(v) || v.includes('seasonal') || v.includes('temp')
  );
}

export function getProbationEndDate(employee) {
  const explicit = parseDateOnly(employee?.probation_end_date);
  if (explicit) return explicit;

  const hire = parseDateOnly(employee?.hire_date);
  if (!hire) return null;

  const end = new Date(hire.getTime());
  end.setDate(end.getDate() + PROBATION_DAYS);
  return end;
}

export function isPastProbation(employee, asOfDate = new Date()) {
  const probationEnd = getProbationEndDate(employee);
  if (!probationEnd) return false;
  return startOfLocalDay(asOfDate).getTime() >= startOfLocalDay(probationEnd).getTime();
}

export function resolveContractEndDate(contract) {
  const fromColumn = parseDateOnly(contract?.end_date);
  if (fromColumn) return fromColumn;

  const keyTerms = contract?.contract_data?.keyTerms || contract?.keyTerms || {};
  return parseDateOnly(keyTerms.contractEndDate || keyTerms.contract_end_date || null);
}

function isContractActiveOn(contract, asOfDate) {
  const endDate = resolveContractEndDate(contract);
  if (!endDate) return true; // seasonal/temp with no end date → treat as still active
  return startOfLocalDay(endDate).getTime() >= startOfLocalDay(asOfDate).getTime();
}

/**
 * Build a lookup of employeeId -> latest active seasonal/temp contract.
 * Matches hr_contracts by employee_id, email, or first+last name.
 */
export function buildActiveContractEndByEmployeeId(employees = [], contracts = [], asOfDate = new Date()) {
  const byEmployeeId = new Map();

  const employeeIndexes = employees.map((emp) => {
    const first = emp.first_name || String(emp.full_name || '').split(' ')[0] || '';
    const last =
      emp.last_name ||
      String(emp.full_name || '')
        .split(' ')
        .slice(1)
        .join(' ') ||
      '';
    return {
      id: emp.id,
      email: normalizeEmail(emp.email),
      full: normalizeName(emp.full_name || `${first} ${last}`),
      firstLast: normalizeName(`${first} ${last}`),
    };
  });

  const matchEmployee = (contract) => {
    if (contract.employee_id) {
      return employees.find((e) => e.id === contract.employee_id) || null;
    }
    const keyTerms = contract?.contract_data?.keyTerms || {};
    const email = normalizeEmail(keyTerms.employeeEmail || keyTerms.email);
    const full = normalizeName(`${keyTerms.firstName || ''} ${keyTerms.lastName || ''}`);

    if (email) {
      const byEmail = employeeIndexes.find((e) => e.email && e.email === email);
      if (byEmail) return employees.find((e) => e.id === byEmail.id) || null;
    }
    if (full) {
      const byName = employeeIndexes.find((e) => e.full === full || e.firstLast === full);
      if (byName) return employees.find((e) => e.id === byName.id) || null;
    }
    return null;
  };

  for (const contract of contracts) {
    if (!contract || String(contract.status || '').toLowerCase() !== 'signed') continue;

    const keyTerms = contract?.contract_data?.keyTerms || {};
    const employmentType = keyTerms.employmentType || keyTerms.employment_type;
    if (!isContractStyleEmployment(contract.contract_type, employmentType)) continue;
    if (!isContractActiveOn(contract, asOfDate)) continue;

    const employee = matchEmployee(contract);
    if (!employee?.id) continue;

    const endDate = resolveContractEndDate(contract);
    const endMs = endDate ? endDate.getTime() : Number.POSITIVE_INFINITY;
    const existing = byEmployeeId.get(employee.id);
    if (!existing || endMs >= existing.endMs) {
      byEmployeeId.set(employee.id, {
        endDate: endDate ? endDate.toISOString().slice(0, 10) : null,
        endMs,
        contractId: contract.id,
      });
    }
  }

  return byEmployeeId;
}

export function isOnActiveSeasonalOrContract(employeeId, activeContractEndByEmployeeId) {
  return activeContractEndByEmployeeId?.has(employeeId) === true;
}

/**
 * @returns {{ eligible: boolean, reason?: string }}
 */
export function evaluatePermanentRaiseEligibility(employee, activeContractEndByEmployeeId, asOfDate = new Date()) {
  const userStatus = String(employee?.employment_status || '').toLowerCase();
  const buRaw = employee?.business_users;
  const buStatus = String(
    employee?.business_employment_status ||
      (Array.isArray(buRaw) ? buRaw[0]?.employment_status : buRaw?.employment_status) ||
      ''
  ).toLowerCase();

  if (userStatus === 'terminated' || buStatus === 'terminated') {
    return { eligible: false, reason: 'terminated' };
  }

  if (!(parseFloat(employee?.wage) > 0)) {
    return { eligible: false, reason: 'no_wage' };
  }

  if (!isPastProbation(employee, asOfDate)) {
    return { eligible: false, reason: 'on_probation' };
  }

  if (isOnActiveSeasonalOrContract(employee.id, activeContractEndByEmployeeId)) {
    return { eligible: false, reason: 'active_contract' };
  }

  return { eligible: true };
}

export function filterEmployeesForPermanentRaise(employees = [], contracts = [], asOfDate = new Date()) {
  const activeEnds = buildActiveContractEndByEmployeeId(employees, contracts, asOfDate);
  return employees.filter((emp) => evaluatePermanentRaiseEligibility(emp, activeEnds, asOfDate).eligible);
}
