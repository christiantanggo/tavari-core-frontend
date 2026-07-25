/**
 * ERPNext stores accounts as "Account Name - ABBR". Tavari stores logical base names
 * (without suffix) on categories/vendors/drafts and adds the company suffix when posting.
 */

export function logicalAccountFromErpNextName(fullName) {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return '';
  const lastDash = trimmed.lastIndexOf(' - ');
  if (lastDash === -1) return trimmed;
  const suffix = trimmed.slice(lastDash + 3).trim();
  const base = trimmed.slice(0, lastDash).trim();
  if (suffix && suffix.length <= 12 && !/\s/.test(suffix)) {
    return base || trimmed;
  }
  return trimmed;
}

export function stripCompanySuffix(accountName, abbr) {
  let base = (accountName || '').trim();
  if (!base || !abbr) return base;
  const suf = abbr.startsWith(' - ') ? abbr : ` - ${abbr.trim()}`;
  while (suf && base.endsWith(suf)) {
    base = base.slice(0, -suf.length).trimEnd();
  }
  return base;
}

export function toStoredGlAccount(value, companyAbbr) {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  if (companyAbbr) {
    return stripCompanySuffix(logicalAccountFromErpNextName(trimmed), companyAbbr);
  }
  return logicalAccountFromErpNextName(trimmed);
}
