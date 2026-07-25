/**
 * Match vendor name / payee text against accounting_vendor_rules (substring, case-insensitive).
 * Higher priority wins; ties use longer pattern first.
 */

export function normalizeRulePattern(pattern) {
  return String(pattern || '').trim().toLowerCase();
}

export function matchVendorRule(text, rules) {
  const haystack = String(text || '').trim().toLowerCase();
  if (!haystack || !Array.isArray(rules) || rules.length === 0) return null;

  const sorted = [...rules].sort((a, b) => {
    const prio = (Number(b.priority) || 0) - (Number(a.priority) || 0);
    if (prio !== 0) return prio;
    return normalizeRulePattern(b.match_pattern).length - normalizeRulePattern(a.match_pattern).length;
  });

  for (const rule of sorted) {
    const needle = normalizeRulePattern(rule.match_pattern);
    if (needle && haystack.includes(needle)) return rule;
  }
  return null;
}

export function ruleToDraftDefaults(rule, vendors = [], categories = []) {
  if (!rule) return {};
  const out = {};
  if (rule.vendor_id) {
    out.vendor_id = rule.vendor_id;
    const vendor = vendors.find((v) => v.id === rule.vendor_id);
    if (vendor?.name) out.vendor_name_display = vendor.name;
  }
  if (rule.expense_category_id) out.expense_category_id = rule.expense_category_id;
  if (rule.gl_account_erpnext) out.gl_account_erpnext = rule.gl_account_erpnext;
  if (rule.hst_treatment) out.hst_treatment = rule.hst_treatment;
  if (rule.expense_category_id && !rule.gl_account_erpnext) {
    const cat = categories.find((c) => c.id === rule.expense_category_id);
    if (cat?.gl_account_erpnext) out.gl_account_erpnext = cat.gl_account_erpnext;
  }
  return out;
}
