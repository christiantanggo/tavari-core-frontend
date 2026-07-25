// ERPNext API client for Edge Functions (build plan §7A). Never call from frontend.

export async function callErpNext(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const url = baseUrl.replace(/\/$/, '') + path;
  const token = apiKey + ':' + apiSecret;
  const parseJsonSafely = (text: string): unknown => {
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  };
  try {
    const res = await fetch(url, {
      method,
      headers: { Authorization: 'token ' + token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: text || res.statusText };
    return { ok: true, data: parseJsonSafely(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchErpNextDoc(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  doctype: string,
  name: string
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const res = await callErpNext(
    baseUrl,
    apiKey,
    apiSecret,
    'GET',
    `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`
  );
  if (!res.ok) return { ok: false, error: res.error || `Failed to fetch ${doctype}` };
  const data = (res.data as { data?: Record<string, unknown> })?.data;
  if (!data) return { ok: false, error: `${doctype} response was empty` };
  return { ok: true, data };
}

export async function createErpNextDoc(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  doctype: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; data?: Record<string, unknown>; name?: string; error?: string }> {
  const res = await callErpNext(baseUrl, apiKey, apiSecret, 'POST', `/api/resource/${encodeURIComponent(doctype)}`, payload);
  if (!res.ok) return { ok: false, error: res.error || `Failed to create ${doctype}` };
  const data = (res.data as { data?: Record<string, unknown> })?.data;
  const name = typeof data?.name === 'string' ? data.name.trim() : '';
  return { ok: true, data, name: name || undefined };
}

export async function submitErpNextDoc(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  doc: Record<string, unknown>
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return await callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/method/frappe.client.submit', { doc });
}

export async function findJournalEntryByUserRemark(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  userRemark: string
): Promise<string | null> {
  const filters = encodeURIComponent(JSON.stringify([['user_remark', '=', userRemark]]));
  const fields = encodeURIComponent(JSON.stringify(['name', 'modified']));
  const orderBy = encodeURIComponent('modified desc');
  const res = await callErpNext(
    baseUrl,
    apiKey,
    apiSecret,
    'GET',
    `/api/resource/Journal Entry?filters=${filters}&fields=${fields}&order_by=${orderBy}&limit_page_length=1`
  );
  if (!res.ok) return null;
  const rows = (res.data as { data?: Array<{ name?: string }> })?.data;
  const name = rows?.[0]?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/** Parse abbreviation from an ERPNext account name: "Accounts Payable - TOS" -> "TOS". */
function parseAbbrFromAccountName(accountName: string): string | null {
  if (!accountName || typeof accountName !== 'string') return null;
  const lastDash = accountName.lastIndexOf(' - ');
  if (lastDash === -1) return null;
  const suffix = accountName.slice(lastDash + 3).trim();
  return suffix.length > 0 ? suffix : null;
}

/** ERPNext Company doctype uses field "abbr" (not "abbreviation"). Read both. */
function companyAbbr(data: Record<string, unknown>): string {
  const v = (data?.abbr ?? data?.abbreviation) as string | undefined;
  return (v && typeof v === 'string' && v.trim()) ? v.trim() : '';
}

/** Fetch company abbreviation from ERPNext. Tries Company.abbr / Company.abbreviation first, then derives from any Account name (e.g. "Accounts Payable - TOS" -> TOS). */
export async function fetchCompanyAbbreviation(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  companyName?: string
): Promise<{ ok: boolean; abbreviation?: string; companyName?: string; error?: string }> {
  const getCompanyDoc = async (name: string): Promise<{ name: string; abbr: string } | null> => {
    const nameEnc = encodeURIComponent(name.trim());
    const res = await callErpNext(baseUrl, apiKey, apiSecret, 'GET', `/api/resource/Company/${nameEnc}`);
    if (!res.ok) return null;
    const data = (res.data as { data?: Record<string, unknown> })?.data;
    if (!data) return null;
    const abbr = companyAbbr(data as Record<string, unknown>);
    return { name: (data.name as string) || name, abbr };
  };

  const getAbbrFromAccounts = async (company: string): Promise<string | null> => {
    const filter = encodeURIComponent(JSON.stringify([['company', '=', company]]));
    const res = await callErpNext(baseUrl, apiKey, apiSecret, 'GET', `/api/resource/Account?filters=${filter}&limit_page_length=5&fields=${encodeURIComponent(JSON.stringify(['name']))}`);
    if (!res.ok) return null;
    const list = (res.data as { data?: { name?: string }[] })?.data;
    if (!Array.isArray(list)) return null;
    for (const row of list) {
      const abbr = parseAbbrFromAccountName(row.name || '');
      if (abbr) return abbr;
    }
    return null;
  };

  let company = companyName?.trim() || '';

  if (company) {
    const doc = await getCompanyDoc(company);
    if (doc?.abbr) return { ok: true, abbreviation: doc.abbr, companyName: doc.name };
    const abbrFromAccounts = await getAbbrFromAccounts(doc?.name || company);
    if (abbrFromAccounts) return { ok: true, abbreviation: abbrFromAccounts, companyName: doc?.name || company };
    return { ok: false, error: 'Could not get company abbreviation. Set it in ERPNext (Company) or ensure Chart of Accounts has accounts like "Accounts Payable - TOS".' };
  }

  const listRes = await callErpNext(baseUrl, apiKey, apiSecret, 'GET', '/api/resource/Company?limit_page_length=1&fields=' + encodeURIComponent(JSON.stringify(['name', 'abbr', 'abbreviation'])));
  if (!listRes.ok) return { ok: false, error: listRes.error || 'Could not list companies' };
  const list = (listRes.data as { data?: Record<string, unknown>[] })?.data;
  const first = Array.isArray(list) ? list[0] : undefined;
  company = (first?.name as string)?.trim() || '';
  if (!company) return { ok: false, error: 'No company found in ERPNext' };
  const abbr = (first ? companyAbbr(first) : '') || await getAbbrFromAccounts(company);
  if (!abbr) return { ok: false, error: 'Company has no abbreviation and no accounts with suffix (e.g. " - TOS"). Set abbreviation in ERPNext Company or add accounts.' };
  return { ok: true, abbreviation: abbr, companyName: company };
}

export type AccountInfo = {
  name: string;
  account_name?: string;
  parent_account?: string;
  is_group?: number | boolean;
  root_type?: string;
  report_type?: string;
  account_type?: string;
};

/** Fetch all Accounts for a company from ERPNext. Group accounts cannot be used in JEs. */
export async function fetchAccountNamesForCompany(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  company: string
): Promise<{ ok: boolean; names?: string[]; accounts?: AccountInfo[]; error?: string }> {
  const filter = encodeURIComponent(JSON.stringify([['company', '=', company]]));
  const fields = encodeURIComponent(JSON.stringify(['name', 'account_name', 'parent_account', 'is_group', 'root_type', 'report_type', 'account_type']));
  const accounts: AccountInfo[] = [];
  let start = 0;
  const pageLen = 500;
  for (;;) {
    const res = await callErpNext(
      baseUrl,
      apiKey,
      apiSecret,
      'GET',
      `/api/resource/Account?filters=${filter}&fields=${fields}&limit_start=${start}&limit_page_length=${pageLen}`
    );
    if (!res.ok) return { ok: false, error: res.error || 'Failed to fetch accounts' };
    const list = (res.data as { data?: AccountInfo[] })?.data;
    if (!Array.isArray(list) || list.length === 0) break;
    for (const row of list) {
      if (row.name) {
        accounts.push({
          name: row.name,
          account_name: row.account_name,
          parent_account: row.parent_account,
          is_group: row.is_group,
          root_type: row.root_type,
          report_type: row.report_type,
          account_type: row.account_type
        });
      }
    }
    if (list.length < pageLen) break;
    start += pageLen;
  }
  return { ok: true, names: accounts.map((a) => a.name), accounts };
}

/**
 * Resolve a logical account name to the exact Account document name. Prefers ledger accounts (is_group=0);
 * group accounts cannot be used in transactions. Tries fallbackLogicalNames if the main match is a group.
 */
export function resolveAccountName(accountNames: string[], logicalName: string): string | null {
  if (!logicalName || !Array.isArray(accountNames)) return null;
  const trimmed = logicalName.trim();
  if (!trimmed) return null;
  const exact = accountNames.find((n) => n === trimmed);
  if (exact) return exact;
  const suffix = ' - ' + trimmed;
  const withPrefix = accountNames.find((n) => n.endsWith(suffix));
  return withPrefix ?? null;
}

/** Resolve to a ledger account only (is_group=0). Tries logicalName then each fallback; skips group accounts. */
export function resolveLedgerAccount(
  accounts: AccountInfo[],
  logicalName: string,
  fallbackLogicalNames?: string[]
): string | null {
  if (!accounts?.length || !logicalName?.trim()) return null;
  const tryResolve = (logical: string): string | null => {
    const trimmed = logical.trim();
    const exact = accounts.find((a) => !a.is_group && a.name === trimmed);
    if (exact) return exact.name;
    const suffix = ' - ' + trimmed;
    const withPrefix = accounts.find((a) => !a.is_group && a.name.endsWith(suffix));
    return withPrefix ? withPrefix.name : null;
  };
  const main = tryResolve(logicalName);
  if (main) return main;
  if (fallbackLogicalNames) {
    for (const fb of fallbackLogicalNames) {
      const r = tryResolve(fb);
      if (r) return r;
    }
  }
  return null;
}

/** Legacy Tavari category labels → ERPNext standard leaf account names (Canadian chart). */
export const LEGACY_EXPENSE_GL_ALIASES: Record<string, string[]> = {
  'Other Operating Expenses': ['Miscellaneous Expenses'],
  'Utilities': ['Utility Expenses'],
  'Rent': ['Office Rent'],
  'Wages and Salaries': ['Salary'],
  'Insurance': ['Miscellaneous Expenses'],
  'Office Supplies': ['Print and Stationery'],
  'Professional Fees': ['Legal Expenses'],
};

export function expenseGlResolveFallbacks(logicalBase: string): string[] {
  const key = (logicalBase || '').trim();
  return LEGACY_EXPENSE_GL_ALIASES[key] ?? ['Miscellaneous Expenses'];
}

/** Suffix string for ERPNext account names, e.g. " - OTWK". */
export function companySuffix(abbr: string): string {
  const a = (abbr || '').trim();
  if (!a) return '';
  return a.startsWith(' - ') ? a : ` - ${a}`;
}

/** Remove trailing company suffix(es) so stored values stay logical base names. */
export function stripCompanySuffix(accountName: string, abbr: string): string {
  let base = (accountName || '').trim();
  if (!base) return base;
  const suf = companySuffix(abbr);
  while (suf && base.endsWith(suf)) {
    base = base.slice(0, -suf.length).trimEnd();
  }
  return base;
}

/** Append company suffix once (strips any existing suffix first). */
export function appendCompanySuffix(logicalName: string, abbr: string): string {
  const base = stripCompanySuffix(logicalName, abbr);
  const suf = companySuffix(abbr);
  return base ? `${base}${suf}` : '';
}

/** Parse logical account name from a full ERPNext account (drops trailing " - ABBR"). */
export function logicalAccountFromErpNextName(fullName: string): string {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return '';
  const lastDash = trimmed.lastIndexOf(' - ');
  if (lastDash === -1) return trimmed;
  const suffix = trimmed.slice(lastDash + 3).trim();
  const base = trimmed.slice(0, lastDash).trim();
  // Only strip when suffix looks like a company abbreviation (short, no spaces).
  if (suffix && suffix.length <= 12 && !/\s/.test(suffix)) {
    return base || trimmed;
  }
  return trimmed;
}

export function resolveExpenseLedgerAccount(
  accounts: AccountInfo[],
  logicalBase: string,
  suffix: string,
): string | null {
  const abbr = suffix.startsWith(' - ') ? suffix.slice(3) : suffix;
  const base = stripCompanySuffix(logicalBase || 'Miscellaneous Expenses', abbr) || 'Miscellaneous Expenses';
  const fullName = appendCompanySuffix(base, abbr);
  const fallbacks = expenseGlResolveFallbacks(base)
    .map((fb) => appendCompanySuffix(stripCompanySuffix(fb, abbr), abbr));
  return resolveLedgerAccount(accounts, fullName, fallbacks);
}

/**
 * Ensure a Supplier exists in ERPNext (create if not). Returns the Supplier document name to use as party in JEs.
 * Supplier doc name may be supplier_name or a naming series like SUPP-00001.
 */
export async function ensureSupplierInErpNext(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  supplierName: string
): Promise<{ ok: boolean; partyName?: string; error?: string }> {
  const name = (supplierName || '').trim();
  if (!name) return { ok: false, error: 'Supplier name is required' };

  const filter = encodeURIComponent(JSON.stringify([['supplier_name', '=', name]]));
  const listRes = await callErpNext(
    baseUrl,
    apiKey,
    apiSecret,
    'GET',
    `/api/resource/Supplier?filters=${filter}&limit_page_length=1&fields=${encodeURIComponent(JSON.stringify(['name']))}`
  );
  if (listRes.ok) {
    const list = (listRes.data as { data?: { name?: string }[] })?.data;
    if (Array.isArray(list) && list.length > 0 && list[0].name) {
      return { ok: true, partyName: list[0].name };
    }
  }

  const createRes = await callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/resource/Supplier', {
    supplier_name: name,
    supplier_group: 'All Supplier Groups'
  });
  if (!createRes.ok) return { ok: false, error: createRes.error || 'Failed to create Supplier in ERPNext' };
  const created = (createRes.data as { data?: { name?: string } })?.data;
  const partyName = created?.name ?? name;
  return { ok: true, partyName };
}

export async function ensureCustomerInErpNext(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  customerName: string
): Promise<{ ok: boolean; partyName?: string; error?: string }> {
  const name = (customerName || '').trim();
  if (!name) return { ok: false, error: 'Customer name is required' };

  const filter = encodeURIComponent(JSON.stringify([['customer_name', '=', name]]));
  const listRes = await callErpNext(
    baseUrl,
    apiKey,
    apiSecret,
    'GET',
    `/api/resource/Customer?filters=${filter}&limit_page_length=1&fields=${encodeURIComponent(JSON.stringify(['name']))}`
  );
  if (listRes.ok) {
    const list = (listRes.data as { data?: { name?: string }[] })?.data;
    if (Array.isArray(list) && list.length > 0 && list[0].name) {
      return { ok: true, partyName: list[0].name };
    }
  }

  const createRes = await callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/resource/Customer', {
    customer_name: name,
    customer_group: 'All Customer Groups',
    territory: 'All Territories'
  });
  if (!createRes.ok) return { ok: false, error: createRes.error || 'Failed to create Customer in ERPNext' };
  const created = (createRes.data as { data?: { name?: string } })?.data;
  const partyName = created?.name ?? name;
  return { ok: true, partyName };
}

/** ERPNext Fiscal Year name covering a calendar date (e.g. "2025-2026"). */
export async function resolveErpNextFiscalYearName(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  dateStr: string,
  company?: string,
): Promise<{ ok: boolean; name?: string; error?: string }> {
  const filters: unknown[][] = [
    ['year_start_date', '<=', dateStr],
    ['year_end_date', '>=', dateStr],
  ];
  const filtersEnc = encodeURIComponent(JSON.stringify(filters));
  const fieldsEnc = encodeURIComponent(JSON.stringify(['name', 'year_start_date', 'year_end_date']));
  const res = await callErpNext(
    baseUrl,
    apiKey,
    apiSecret,
    'GET',
    `/api/resource/Fiscal Year?filters=${filtersEnc}&fields=${fieldsEnc}&order_by=year_start_date desc&limit_page_length=1`,
  );
  if (!res.ok) return { ok: false, error: res.error || 'Failed to load Fiscal Year' };
  const rows = (res.data as { data?: Array<{ name?: string }> })?.data;
  const name = rows?.[0]?.name?.trim();
  if (!name) return { ok: false, error: `No ERPNext Fiscal Year covers ${dateStr}` };
  return { ok: true, name };
}

/** Sum net debits (debit − credit) on one GL account for a posting-date range. */
export async function sumGlEntryNetDebitsForAccount(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  company: string,
  accountFullName: string,
  fromDate: string,
  toDate: string,
): Promise<{ ok: boolean; netDebits: number; entryCount: number; error?: string }> {
  const filters: unknown[][] = [
    ['account', '=', accountFullName],
    ['posting_date', '>=', fromDate],
    ['posting_date', '<=', toDate],
    ['company', '=', company],
    ['is_cancelled', '=', 0],
  ];
  const fields = ['debit_in_account_currency', 'credit_in_account_currency'];
  const fieldsEnc = encodeURIComponent(JSON.stringify(fields));
  const glResource = encodeURIComponent('GL Entry');
  let offset = 0;
  const pageSize = 500;
  let netDebits = 0;
  let entryCount = 0;

  while (true) {
    const filtersEnc = encodeURIComponent(JSON.stringify(filters));
    const res = await callErpNext(
      baseUrl,
      apiKey,
      apiSecret,
      'GET',
      `/api/resource/${glResource}?filters=${filtersEnc}&fields=${fieldsEnc}&limit_page_length=${pageSize}&limit_start=${offset}&order_by=posting_date asc`,
    );
    if (!res.ok) return { ok: false, netDebits: 0, entryCount: 0, error: res.error || 'GL Entry query failed' };
    const rows = (res.data as { data?: Array<Record<string, unknown>> })?.data || [];
    for (const row of rows) {
      const debit = Number(row.debit_in_account_currency || 0) || 0;
      const credit = Number(row.credit_in_account_currency || 0) || 0;
      netDebits += debit - credit;
      entryCount += 1;
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return { ok: true, netDebits: Math.round(netDebits * 100) / 100, entryCount };
}
