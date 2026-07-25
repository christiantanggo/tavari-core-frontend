/**
 * Default expense categories aligned with ERPNext Chart of Accounts (Canadian baseline).
 * Every business gets these on first load; they can add more via the Categories screen.
 * GL account names must match ERPNext (suffix like " - TOS" is added when posting).
 */
const DEFAULT_HST = 'recoverable';
const DEFAULT_HST_EXEMPT = 'exempt';

export const BASELINE_EXPENSE_CATEGORIES = [
  // Direct Expenses
  { name: 'Cost of Goods Sold', gl_account_erpnext: 'Cost of Goods Sold', default_hst_treatment: DEFAULT_HST, sort_order: 10 },
  { name: 'Stock Expenses', gl_account_erpnext: 'Stock Expenses', default_hst_treatment: DEFAULT_HST, sort_order: 12 },
  { name: 'Expenses Included In Asset Valuation', gl_account_erpnext: 'Expenses Included In Asset Valuation', default_hst_treatment: DEFAULT_HST, sort_order: 14 },
  { name: 'Expenses Included In Valuation', gl_account_erpnext: 'Expenses Included In Valuation', default_hst_treatment: DEFAULT_HST, sort_order: 16 },
  { name: 'Stock Adjustment', gl_account_erpnext: 'Stock Adjustment', default_hst_treatment: DEFAULT_HST, sort_order: 18 },
  // Indirect Expenses
  { name: 'Administrative Expenses', gl_account_erpnext: 'Administrative Expenses', default_hst_treatment: DEFAULT_HST, sort_order: 20 },
  { name: 'Commission on Sales', gl_account_erpnext: 'Commission on Sales', default_hst_treatment: DEFAULT_HST, sort_order: 22 },
  { name: 'Depreciation', gl_account_erpnext: 'Depreciation', default_hst_treatment: DEFAULT_HST, sort_order: 24 },
  { name: 'Entertainment Expenses', gl_account_erpnext: 'Entertainment Expenses', default_hst_treatment: DEFAULT_HST, sort_order: 26 },
  { name: 'Exchange Gain/Loss', gl_account_erpnext: 'Exchange Gain/Loss', default_hst_treatment: DEFAULT_HST, sort_order: 28 },
  { name: 'Freight and Forwarding Charges', gl_account_erpnext: 'Freight and Forwarding Charges', default_hst_treatment: DEFAULT_HST, sort_order: 30 },
  { name: 'Gain/Loss on Asset Disposal', gl_account_erpnext: 'Gain/Loss on Asset Disposal', default_hst_treatment: DEFAULT_HST, sort_order: 32 },
  { name: 'Impairment', gl_account_erpnext: 'Impairment', default_hst_treatment: DEFAULT_HST, sort_order: 34 },
  { name: 'Legal Expenses', gl_account_erpnext: 'Legal Expenses', default_hst_treatment: DEFAULT_HST, sort_order: 36 },
  { name: 'Marketing Expenses', gl_account_erpnext: 'Marketing Expenses', default_hst_treatment: DEFAULT_HST, sort_order: 38 },
  { name: 'Miscellaneous Expenses', gl_account_erpnext: 'Miscellaneous Expenses', default_hst_treatment: DEFAULT_HST, sort_order: 40 },
  { name: 'Office Maintenance Expenses', gl_account_erpnext: 'Office Maintenance Expenses', default_hst_treatment: DEFAULT_HST, sort_order: 42 },
  { name: 'Office Rent', gl_account_erpnext: 'Office Rent', default_hst_treatment: DEFAULT_HST, sort_order: 44 },
  { name: 'Postal Expenses', gl_account_erpnext: 'Postal Expenses', default_hst_treatment: DEFAULT_HST, sort_order: 46 },
  { name: 'Print and Stationery', gl_account_erpnext: 'Print and Stationery', default_hst_treatment: DEFAULT_HST, sort_order: 48 },
  { name: 'Round Off', gl_account_erpnext: 'Round Off', default_hst_treatment: DEFAULT_HST, sort_order: 50 },
  { name: 'Salary', gl_account_erpnext: 'Salary', default_hst_treatment: DEFAULT_HST_EXEMPT, sort_order: 52 },
  { name: 'Sales Expenses', gl_account_erpnext: 'Sales Expenses', default_hst_treatment: DEFAULT_HST, sort_order: 54 },
  { name: 'Telephone Expenses', gl_account_erpnext: 'Telephone Expenses', default_hst_treatment: DEFAULT_HST, sort_order: 56 },
  { name: 'Travel Expenses', gl_account_erpnext: 'Travel Expenses', default_hst_treatment: DEFAULT_HST, sort_order: 58 },
  { name: 'Utility Expenses', gl_account_erpnext: 'Utility Expenses', default_hst_treatment: DEFAULT_HST, sort_order: 60 },
  { name: 'Write Off', gl_account_erpnext: 'Write Off', default_hst_treatment: DEFAULT_HST, sort_order: 62 },
  // Legacy / common aliases (map to ERPNext chart names for existing setups that may still reference these)
  { name: 'Insurance', gl_account_erpnext: 'Miscellaneous Expenses', default_hst_treatment: DEFAULT_HST, sort_order: 64 },
  { name: 'Office Supplies', gl_account_erpnext: 'Print and Stationery', default_hst_treatment: DEFAULT_HST, sort_order: 66 },
  { name: 'Professional Fees', gl_account_erpnext: 'Legal Expenses', default_hst_treatment: DEFAULT_HST, sort_order: 68 },
  { name: 'Rent', gl_account_erpnext: 'Office Rent', default_hst_treatment: DEFAULT_HST, sort_order: 70 },
  { name: 'Wages and Salaries', gl_account_erpnext: 'Salary', default_hst_treatment: DEFAULT_HST_EXEMPT, sort_order: 72 },
  { name: 'Other Operating Expenses', gl_account_erpnext: 'Miscellaneous Expenses', default_hst_treatment: DEFAULT_HST, sort_order: 99 }
];

/**
 * All expense GL account names from the ERPNext Chart of Accounts (base names; company suffix added when posting).
 * Use this in the UI for dropdowns so users can pick any chart account when assigning a category.
 */
export const ERPNEXT_EXPENSE_GL_ACCOUNTS = [
  'Cost of Goods Sold',
  'Stock Expenses',
  'Expenses Included In Asset Valuation',
  'Expenses Included In Valuation',
  'Stock Adjustment',
  'Administrative Expenses',
  'Commission on Sales',
  'Depreciation',
  'Entertainment Expenses',
  'Exchange Gain/Loss',
  'Freight and Forwarding Charges',
  'Gain/Loss on Asset Disposal',
  'Impairment',
  'Legal Expenses',
  'Marketing Expenses',
  'Miscellaneous Expenses',
  'Office Maintenance Expenses',
  'Office Rent',
  'Postal Expenses',
  'Print and Stationery',
  'Round Off',
  'Salary',
  'Sales Expenses',
  'Telephone Expenses',
  'Travel Expenses',
  'Utility Expenses',
  'Write Off'
].sort((a, b) => a.localeCompare(b));

/** Default capital asset GL when capitalizing a purchase (logical name; company suffix added at post). */
export const DEFAULT_CAPITAL_ASSET_GL = 'Electronic Equipments';

/** Fallback asset GL options when ERPNext chart is not loaded. */
export const CAPITAL_ASSET_GL_OPTIONS = [
  'Electronic Equipments',
  'Office Equipments',
  'Capital Equipments',
  'Furnitures and Fixtures',
  'Plants and Machineries',
  'Buildings',
  'Softwares',
];

/**
 * If the business has no expense categories, insert the baseline set.
 * Call this when loading categories so every business always has defaults.
 * @param {object} supabase - Supabase client
 * @param {string} businessId - UUID of the business
 * @returns {Promise<boolean>} true if baseline was inserted, false if already had categories
 */

// Module-level locks prevent the race condition where multiple components mount simultaneously,
// each see zero categories, and each independently insert the baseline set (causing duplicates).
const _ensureInFlight = {};
const _ensureDone = {};

export async function ensureBaselineExpenseCategories(supabase, businessId) {
  if (!businessId) return false;

  // Already confirmed seeded this session — skip immediately
  if (_ensureDone[businessId]) return false;

  // Another call is already in flight for this business — wait for it
  if (_ensureInFlight[businessId]) {
    await _ensureInFlight[businessId];
    return false;
  }

  let resolveLock;
  _ensureInFlight[businessId] = new Promise((r) => { resolveLock = r; });

  try {
    const { data: existing, error: fetchError } = await supabase
      .from('accounting_expense_categories')
      .select('id')
      .eq('business_id', businessId)
      .limit(1);
    if (fetchError) throw fetchError;
    if (existing?.length > 0) {
      _ensureDone[businessId] = true;
      return false;
    }
    const toInsert = BASELINE_EXPENSE_CATEGORIES.map((c) => ({
      business_id: businessId,
      ...c,
      is_baseline: true
    }));
    const { error: insertError } = await supabase.from('accounting_expense_categories').insert(toInsert);
    if (insertError) throw insertError;
    if (!insertError) {
      _ensureDone[businessId] = true;
    }
    return !insertError;
  } finally {
    delete _ensureInFlight[businessId];
    resolveLock();
  }
}
