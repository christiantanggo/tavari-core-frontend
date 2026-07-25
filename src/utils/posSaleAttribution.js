const normalizeString = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

export const formatPosUserName = (...candidates) => {
  for (const candidate of candidates) {
    if (!candidate) continue;

    if (typeof candidate === 'string') {
      const normalized = normalizeString(candidate);
      if (normalized) return normalized;
      continue;
    }

    const fullName = normalizeString(candidate.full_name);
    if (fullName) return fullName;

    const firstName = normalizeString(candidate.first_name);
    const lastName = normalizeString(candidate.last_name);
    const combinedName = `${firstName} ${lastName}`.trim();
    if (combinedName) return combinedName;

    const explicitName = normalizeString(candidate.name);
    if (explicitName) return explicitName;

    const email = normalizeString(candidate.email);
    if (email) return email;
  }

  return 'Unknown';
};

export const getStoredPosUser = (storageKey, businessId = null) => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (businessId && parsed?.business_id && parsed.business_id !== businessId) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

export const resolveCurrentPosAttribution = ({ authUser, activePOSUser, businessId }) => {
  const loginUser = getStoredPosUser('posLoginUser', businessId);
  const operatorUser = (activePOSUser && (!businessId || activePOSUser.business_id === businessId))
    ? activePOSUser
    : getStoredPosUser('posActiveUser', businessId);

  const loginUserId = loginUser?.id || authUser?.id || null;
  const operatorUserId = operatorUser?.id || loginUserId || authUser?.id || null;
  const loginUserName = formatPosUserName(loginUser, authUser?.user_metadata, authUser);
  const operatorUserName = formatPosUserName(operatorUser, loginUser, authUser?.user_metadata, authUser);

  return {
    loginUserId,
    loginUserName,
    operatorUserId,
    operatorUserName,
  };
};

export const buildSaleAttributionDisplay = (record = {}, usersById = {}) => {
  const operatorUserId = record.operator_user_id || record.user_id || record.processed_by || null;
  const loginUserId = record.login_user_id || null;
  const loginUserRecord = usersById[loginUserId];
  const operatorUserRecord = usersById[operatorUserId];

  const operatorUserName = formatPosUserName(
    record.operator_user_name,
    record.employee_name,
    operatorUserRecord
  );

  const loginUserNameRaw = formatPosUserName(record.login_user_name, loginUserRecord);

  const hasDistinctLogin = !!loginUserId && loginUserId !== operatorUserId;
  const hasVisibleLoginName = !!(
    normalizeString(record.login_user_name) ||
    normalizeString(loginUserRecord?.full_name) ||
    normalizeString(loginUserRecord?.email)
  );
  const loginUserName = hasDistinctLogin && hasVisibleLoginName ? loginUserNameRaw : null;

  return {
    operatorUserId,
    operatorUserName,
    loginUserId,
    loginUserName,
    displayName: operatorUserName,
    showBoth: !!loginUserName,
    displayWithContext: loginUserName
      ? `${operatorUserName} (logged in as ${loginUserName})`
      : operatorUserName,
  };
};
