import { supabase } from '../supabaseClient';

/** Normalize email for comparisons and lookups. */
export const normalizeContractEmail = (email) => (email || '').trim().toLowerCase();

/**
 * Find an employee profile only when linked to the given business.
 * Never returns users who exist globally but belong to another business only.
 */
export const findEmployeeForBusinessByEmail = async (businessId, email) => {
  const normalized = normalizeContractEmail(email);
  if (!businessId || !normalized) return null;

  const { data, error } = await supabase
    .from('users')
    .select(
      `id, email, first_name, last_name, full_name, address_line1, position, phone, manager_id,
       hire_date, employment_status, wage, vacation_percent,
       business_users!inner(business_id)`
    )
    .eq('email', normalized)
    .eq('business_users.business_id', businessId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.warn('[contractPersistence] findEmployeeForBusinessByEmail:', error);
    return null;
  }

  return data || null;
};

/**
 * Resolve which hr_contracts row to update on send.
 * Ignores preferredId when it belongs to a different employee email (stale flow state).
 */
export const resolveExistingContractId = async (businessId, employeeEmail, preferredId) => {
  const normalized = normalizeContractEmail(employeeEmail);
  if (!businessId || !normalized) return null;

  if (preferredId) {
    const { data } = await supabase
      .from('hr_contracts')
      .select('id, employee_email, contract_data, status, updated_at')
      .eq('id', preferredId)
      .eq('business_id', businessId)
      .maybeSingle();

    if (data?.id && normalizeContractEmail(data.employee_email) === normalized) {
      return data;
    }
  }

  const { data: existing } = await supabase
    .from('hr_contracts')
    .select('id, contract_data, status, updated_at, employee_email')
    .eq('business_id', businessId)
    .eq('employee_email', normalized)
    .in('status', ['draft', 'sent', 'pending', 'employee_signed'])
    .order('updated_at', { ascending: false });

  if (!existing?.length) return null;

  const withTerms = existing.find(
    (row) => Array.isArray(row.contract_data?.selectedTerms) && row.contract_data.selectedTerms.length > 0
  );
  return withTerms || existing[0];
};

/**
 * Display name for a contract — always prefers names stored on the contract row,
 * not the linked users profile (which may be a different person at another business).
 */
export const getContractEmployeeDisplay = (contract) => {
  if (!contract) {
    return { firstName: '', lastName: '', fullName: '', email: '' };
  }

  const stored = contract.contract_data?.keyTerms || {};
  const firstName =
    (contract.employee_first_name || stored.firstName || '').trim();
  const lastName =
    (contract.employee_last_name || stored.lastName || '').trim();
  const email =
    (contract.employee_email || stored.employeeEmail || contract.employee?.email || '').trim();

  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    email,
  };
};

/** Attach contract.employee for UI using contract-stored names (not global users join). */
export const enrichContractRowWithDisplayEmployee = (contract) => {
  if (!contract) return contract;
  const display = getContractEmployeeDisplay(contract);
  return {
    ...contract,
    employee: {
      id: contract.employee_id || contract.employee_email,
      first_name: display.firstName,
      last_name: display.lastName,
      full_name: display.fullName,
      email: display.email || contract.employee_email,
      position: contract.position_title || contract.employee?.position,
      department: contract.employee?.department,
      employment_status: contract.employment_status || contract.employee?.employment_status,
      hire_date: contract.start_date || contract.employee?.hire_date,
      wage: contract.employee?.wage,
    },
  };
};

/** Only link employee_id when already on this business roster (never cross-business). */
export const resolveContractEmployeeId = async (businessId, keyTerms) => {
  if (!businessId || !keyTerms?.employeeEmail) return null;
  const roster = await findEmployeeForBusinessByEmail(businessId, keyTerms.employeeEmail);
  return roster?.id || null;
};

/** Map a business-scoped users row to contract key-terms fields (for optional autofill). */
export const mapBusinessEmployeeToKeyTerms = (user) => {
  if (!user) return {};
  return {
    firstName: user.first_name || '',
    lastName: user.last_name || '',
    employeeAddress: user.address_line1 || '',
    positionTitle: user.position || '',
    employeePhone: user.phone || '',
    managerId: user.manager_id || '',
    contractStartDate: user.hire_date || '',
    employmentStatus: user.employment_status || 'full-time',
    baseHourlyWage: user.wage != null ? String(user.wage) : '',
    vacationPayRate:
      user.vacation_percent != null ? String(user.vacation_percent * 100) : '',
  };
};

/** First non-empty string from candidates. */
export const pickBusinessDisplayName = (...candidates) => {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
};

/**
 * Resolve display name for contract emails.
 * businesses table uses `name` (not business_name).
 */
export const resolveBusinessDisplayName = async ({
  businessId,
  contractData,
  businessData,
} = {}) => {
  const fromSources = pickBusinessDisplayName(
    businessData?.name,
    businessData?.business_name,
    contractData?.businessDisplayName,
    contractData?.businessData?.name,
    contractData?.businessData?.business_name
  );

  if (fromSources) return fromSources;

  if (businessId) {
    const { data, error } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', businessId)
      .maybeSingle();

    if (!error && data?.name?.trim()) {
      return data.name.trim();
    }
  }

  return 'Your Employer';
};

/** Standard HR contract email From display name. */
export const formatContractHrFromName = (businessName) =>
  `${pickBusinessDisplayName(businessName) || 'Your Employer'} - HR`;

/** Parse hourly wage from key terms (form uses baseHourlyWage). */
export const parseContractWageAmount = (keyTerms) => {
  if (!keyTerms) return null;
  const raw = keyTerms.baseHourlyWage ?? keyTerms.wage ?? keyTerms.wage_amount;
  if (raw === '' || raw === null || raw === undefined) return null;
  const parsed = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

/** Strip non-JSON fields and normalize key terms before saving contract_data. */
export const buildSerializableContractData = (contractData, extras = {}) => {
  const {
    generateContractPDF,
    contractRecord,
    businessData,
    acceptByDate,
    ...rest
  } = contractData || {};

  const keyTerms = {
    ...(rest.keyTerms || {}),
    baseHourlyWage:
      rest.keyTerms?.baseHourlyWage ??
      rest.keyTerms?.wage ??
      (rest.keyTerms?.wage_amount != null ? String(rest.keyTerms.wage_amount) : ''),
  };

  const displayName = pickBusinessDisplayName(
    businessData?.name,
    businessData?.business_name
  );

  return {
    keyTerms,
    selectedTerms: Array.isArray(rest.selectedTerms) ? rest.selectedTerms : [],
    specialConsiderations: rest.specialConsiderations || {},
    contractPreamble: rest.contractPreamble || '',
    ...(displayName
      ? {
          businessDisplayName: displayName,
          businessData: { name: displayName, business_name: displayName },
        }
      : {}),
    ...extras,
  };
};

/** Merge incoming contract_data with existing row so empty resends do not wipe sections. */
export const mergeContractDataForSave = (incoming, existingRow) => {
  const incomingSerializable = buildSerializableContractData(incoming);
  const existingData = existingRow?.contract_data || {};

  const existingEmail = normalizeContractEmail(
    existingData?.keyTerms?.employeeEmail || existingRow?.employee_email
  );
  const incomingEmail = normalizeContractEmail(incomingSerializable?.keyTerms?.employeeEmail);
  if (existingEmail && incomingEmail && existingEmail !== incomingEmail) {
    return incomingSerializable;
  }

  const merged = {
    ...existingData,
    ...incomingSerializable,
    keyTerms: {
      ...(existingData.keyTerms || {}),
      ...(incomingSerializable.keyTerms || {}),
    },
    specialConsiderations: {
      ...(existingData.specialConsiderations || {}),
      ...(incomingSerializable.specialConsiderations || {}),
    },
  };

  if (
    (!incomingSerializable.selectedTerms || incomingSerializable.selectedTerms.length === 0) &&
    Array.isArray(existingData.selectedTerms) &&
    existingData.selectedTerms.length > 0
  ) {
    merged.selectedTerms = existingData.selectedTerms;
  }

  if (!merged.keyTerms.baseHourlyWage && existingData.keyTerms?.baseHourlyWage) {
    merged.keyTerms.baseHourlyWage = existingData.keyTerms.baseHourlyWage;
  }

  return merged;
};

/** Persist contract sections to contract_sections table. */
export const saveContractSections = async (contractId, selectedTerms) => {
  if (!contractId || !selectedTerms?.length) return { error: null };

  const { error: deleteError } = await supabase
    .from('contract_sections')
    .delete()
    .eq('contract_id', contractId);

  if (deleteError) {
    console.warn('[contractPersistence] Error deleting existing sections:', deleteError);
  }

  const sectionsToInsert = selectedTerms.map((term, index) => ({
    contract_id: contractId,
    title: term.title || '',
    content: term.content || '',
    section_order: term.section_order ?? index + 1,
    is_required: term.is_required ?? false,
    section_type: term.section_type || 'standard',
  }));

  const { error } = await supabase.from('contract_sections').insert(sectionsToInsert);
  if (error) {
    console.warn('[contractPersistence] Error saving contract sections:', error);
  }
  return { error };
};

/** Rebuild flow state from an hr_contracts row. */
export const loadContractFlowDataFromRow = (contract, businessData) => {
  const stored = contract.contract_data || {};
  const storedKt = stored.keyTerms || {};
  const keyTermsFromRow = {
    employmentType: contract.contract_type || storedKt.employmentType || 'permanent',
    employmentStatus: contract.employment_status || storedKt.employmentStatus || 'full-time',
    contractStartDate: contract.start_date || storedKt.contractStartDate || '',
    contractEndDate: contract.end_date || storedKt.contractEndDate || '',
    baseHourlyWage:
      storedKt.baseHourlyWage ||
      (contract.wage_amount != null ? String(contract.wage_amount) : ''),
    ...storedKt,
    firstName: storedKt.firstName || contract.employee_first_name || '',
    lastName: storedKt.lastName || contract.employee_last_name || '',
    positionTitle: storedKt.positionTitle || contract.position_title || '',
    employeeAddress: storedKt.employeeAddress || contract.employee_address || '',
    employeePhone: storedKt.employeePhone || '',
    managerId: storedKt.managerId || '',
    managerName: storedKt.managerName || '',
    employeeEmail: storedKt.employeeEmail || contract.employee_email || '',
  };

  return {
    finalContract: { id: contract.id, status: contract.status },
    keyTerms: keyTermsFromRow,
    selectedTerms: stored.selectedTerms || [],
    specialConsiderations: stored.specialConsiderations || {
      notApplicable: false,
      profitSharing: { enabled: false, title: 'Profit Sharing', sections: [] },
      shiftPremium: { enabled: false, title: 'Shift Premium', sections: [] },
      signingBonus: { enabled: false, title: 'Signing Bonus', sections: [] },
      other: { enabled: false, title: 'Other Considerations', sections: [] },
    },
    contractPreamble: stored.contractPreamble || '',
    businessData,
  };
};
