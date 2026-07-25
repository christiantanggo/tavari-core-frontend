-- ============================================================================
-- STEP 2 ONLY — turns File Storage ON in the app (app_modules + business_module_usage)
--
-- If you see: relation "file_storage_categories" does not exist
--            OR ensure_file_storage_defaults not in schema cache
-- you skipped STEP 1.
--
-- STEP 1 (required first): Supabase Dashboard → SQL Editor → New query
--   Open this file from your repo and run the ENTIRE contents (all ~450+ lines):
--     supabase/migrations/20260324120000_file_storage_module.sql
--   That creates tables, RLS, bucket policies, RPCs, and the app_modules row.
--
-- STEP 2 (this file): Run below to enable the module for every business (optional
--   if you already enabled via Tavari Modules UI).
-- ============================================================================

-- 1) Catalog row (safe if migration already ran)
INSERT INTO public.app_modules (module_key, module_name, description, icon, enabled_by_default, module_category)
VALUES (
  'file_storage',
  'File Storage',
  'Central document storage, categories, email intake, retention, and waiver uploads',
  'FiFolder',
  true,
  'Operations'
)
ON CONFLICT (module_key) DO UPDATE
SET
  module_name = EXCLUDED.module_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  module_category = EXCLUDED.module_category,
  enabled_by_default = true;

-- 2) Turn on for every business (adjust if you only want one business_id)
INSERT INTO public.business_module_usage (
  business_id,
  module_key,
  module_name,
  enabled,
  usage_count,
  created_at,
  updated_at
)
SELECT
  b.id,
  'file_storage',
  'File Storage',
  true,
  0,
  now(),
  now()
FROM public.businesses b
WHERE NOT EXISTS (
  SELECT 1
  FROM public.business_module_usage bmu
  WHERE bmu.business_id = b.id
    AND bmu.module_key = 'file_storage'
)
ON CONFLICT (business_id, module_key) DO UPDATE
SET
  enabled = true,
  module_name = EXCLUDED.module_name,
  updated_at = now();
