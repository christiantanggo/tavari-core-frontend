-- Tavari APIs — public read-only endpoints for external websites (module catalog entry only)

INSERT INTO public.app_modules (module_key, module_name, description, icon, enabled_by_default, module_category)
VALUES (
  'tavari_apis',
  'Tavari APIs',
  'Publish read-only business data to external websites and apps',
  'FiGlobe',
  false,
  'Integrations'
)
ON CONFLICT (module_key) DO UPDATE SET
  module_name = EXCLUDED.module_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  module_category = EXCLUDED.module_category;
