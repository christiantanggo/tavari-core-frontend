-- Store logical GL account names without company suffix (suffix is appended at post time).

UPDATE accounting_expense_categories c
SET gl_account_erpnext = regexp_replace(c.gl_account_erpnext, ' - ' || cfg.erpnext_company_abbr || '$', ''),
    updated_at = now()
FROM accounting_business_config cfg
WHERE c.business_id = cfg.business_id
  AND coalesce(cfg.erpnext_company_abbr, '') <> ''
  AND c.gl_account_erpnext ~ (' - ' || regexp_replace(cfg.erpnext_company_abbr, '([\\.*+?^${}()|[\\]\\\\])', '\\\\\\1', 'g') || '$');

UPDATE accounting_draft_expenses d
SET gl_account_erpnext = regexp_replace(d.gl_account_erpnext, ' - ' || cfg.erpnext_company_abbr || '$', ''),
    updated_at = now()
FROM accounting_business_config cfg
WHERE d.business_id = cfg.business_id
  AND coalesce(cfg.erpnext_company_abbr, '') <> ''
  AND d.gl_account_erpnext IS NOT NULL
  AND d.gl_account_erpnext ~ (' - ' || regexp_replace(cfg.erpnext_company_abbr, '([\\.*+?^${}()|[\\]\\\\])', '\\\\\\1', 'g') || '$');

UPDATE accounting_draft_expense_lines l
SET gl_account_erpnext = regexp_replace(l.gl_account_erpnext, ' - ' || cfg.erpnext_company_abbr || '$', '')
FROM accounting_draft_expenses d
JOIN accounting_business_config cfg ON cfg.business_id = d.business_id
WHERE l.draft_expense_id = d.id
  AND coalesce(cfg.erpnext_company_abbr, '') <> ''
  AND l.gl_account_erpnext IS NOT NULL
  AND l.gl_account_erpnext ~ (' - ' || regexp_replace(cfg.erpnext_company_abbr, '([\\.*+?^${}()|[\\]\\\\])', '\\\\\\1', 'g') || '$');

UPDATE accounting_vendors v
SET default_gl_account_erpnext = regexp_replace(v.default_gl_account_erpnext, ' - ' || cfg.erpnext_company_abbr || '$', ''),
    updated_at = now()
FROM accounting_business_config cfg
WHERE v.business_id = cfg.business_id
  AND coalesce(cfg.erpnext_company_abbr, '') <> ''
  AND v.default_gl_account_erpnext IS NOT NULL
  AND v.default_gl_account_erpnext ~ (' - ' || regexp_replace(cfg.erpnext_company_abbr, '([\\.*+?^${}()|[\\]\\\\])', '\\\\\\1', 'g') || '$');

UPDATE accounting_vendor_rules r
SET gl_account_erpnext = regexp_replace(r.gl_account_erpnext, ' - ' || cfg.erpnext_company_abbr || '$', ''),
    updated_at = now()
FROM accounting_business_config cfg
WHERE r.business_id = cfg.business_id
  AND coalesce(cfg.erpnext_company_abbr, '') <> ''
  AND r.gl_account_erpnext IS NOT NULL
  AND r.gl_account_erpnext ~ (' - ' || regexp_replace(cfg.erpnext_company_abbr, '([\\.*+?^${}()|[\\]\\\\])', '\\\\\\1', 'g') || '$');
