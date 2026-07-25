import { SHIFT_BUSINESS_ID_KEY } from './staffSessionContext';

export function persistShiftBusinessId(businessId) {
  if (!businessId) return false;
  try {
    localStorage.setItem(SHIFT_BUSINESS_ID_KEY, businessId);
    localStorage.setItem('currentBusinessId', businessId);
    localStorage.setItem('selectedBusinessId', businessId);
    return true;
  } catch {
    return false;
  }
}

export function resolveShiftBusinessId() {
  try {
    const pinned = localStorage.getItem(SHIFT_BUSINESS_ID_KEY);
    if (pinned) return pinned;

    const fromCurrent =
      localStorage.getItem('currentBusinessId') ||
      localStorage.getItem('selectedBusinessId') ||
      localStorage.getItem('tavariPinnedBusinessId');
    if (fromCurrent) return fromCurrent;

    const raw = localStorage.getItem('posLoginUser');
    if (raw) {
      const loginUser = JSON.parse(raw);
      if (loginUser?.business_id) return loginUser.business_id;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function clearShiftBusinessId() {
  try {
    localStorage.removeItem(SHIFT_BUSINESS_ID_KEY);
  } catch {
    /* ignore */
  }
}
