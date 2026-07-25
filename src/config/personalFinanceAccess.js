/**
 * Personal Dividend Income module — only for the dedicated Christian Fournier business.
 * Client companies never get this module enabled in the marketplace path.
 */

export const PERSONAL_FINANCE_BUSINESS_NAME = 'Christian Fournier';
export const PERSONAL_FINANCE_OWNER_EMAIL = '5@tanggo.ca';
export const DIVIDEND_INCOME_MODULE_KEY = 'dividend_income';

/** Seeded personal business id (override with VITE_PERSONAL_FINANCE_BUSINESS_ID if recreated). */
export const PERSONAL_FINANCE_BUSINESS_ID = 'c21fd667-0381-4a77-a4ce-2afb80725c90';

export function getPersonalFinanceBusinessId() {
  const raw = (import.meta.env.VITE_PERSONAL_FINANCE_BUSINESS_ID || '').trim();
  return raw || PERSONAL_FINANCE_BUSINESS_ID;
}

export function isPersonalFinanceBusiness(businessOrName, businessId = null) {
  const allowedId = getPersonalFinanceBusinessId();
  if (allowedId && businessId && String(businessId) === allowedId) return true;

  const name =
    typeof businessOrName === 'string'
      ? businessOrName
      : businessOrName?.name || businessOrName?.business_name || '';

  return String(name).trim().toLowerCase() === PERSONAL_FINANCE_BUSINESS_NAME.toLowerCase();
}
