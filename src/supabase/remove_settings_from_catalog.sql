-- Remove System Settings and Reports from app_modules catalog
-- These are fixed items in the sidebar, not modules

DELETE FROM app_modules 
WHERE module_key IN ('settings', 'system_settings', 'system-settings', 'reports', 'system')
   OR LOWER(module_name) LIKE '%system settings%'
   OR (LOWER(module_name) LIKE '%settings%' AND LOWER(module_name) NOT LIKE '%module%' AND LOWER(module_name) NOT LIKE '%app%');

-- Verify removal
SELECT module_key, module_name, module_category 
FROM app_modules 
ORDER BY module_name;



