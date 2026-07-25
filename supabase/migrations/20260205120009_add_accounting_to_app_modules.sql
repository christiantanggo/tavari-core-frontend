-- Add Tavari Accounting module to app_modules catalog (dashboard card + splash page)

INSERT INTO app_modules (module_key, module_name, description, icon, enabled_by_default, module_category)
VALUES (
  'accounting',
  'Tavari Accounting',
  'Sales batching, expense approval, P&L and HST reports, ERPNext integration',
  'FiDollarSign',
  false,
  'Operations'
)
ON CONFLICT (module_key) DO UPDATE
SET
  module_name = EXCLUDED.module_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  module_category = EXCLUDED.module_category;
