-- Remove System Settings and Reports from business_module_usage
-- These are fixed items in the sidebar, not modules that should be tracked

-- First, check what exists
SELECT 
    business_id,
    module_key,
    module_name,
    enabled
FROM business_module_usage
WHERE module_key IN ('settings', 'system_settings', 'system-settings', 'reports', 'system')
   OR LOWER(module_name) LIKE '%system settings%'
   OR (LOWER(module_name) LIKE '%settings%' AND LOWER(module_name) NOT LIKE '%module%' AND LOWER(module_name) NOT LIKE '%app%');

-- Delete the records
DELETE FROM business_module_usage
WHERE module_key IN ('settings', 'system_settings', 'system-settings', 'reports', 'system')
   OR LOWER(module_name) LIKE '%system settings%'
   OR (LOWER(module_name) LIKE '%settings%' AND LOWER(module_name) NOT LIKE '%module%' AND LOWER(module_name) NOT LIKE '%app%');

-- Verify removal
SELECT 
    COUNT(*) as remaining_settings_records
FROM business_module_usage
WHERE module_key IN ('settings', 'system_settings', 'system-settings', 'reports', 'system')
   OR LOWER(module_name) LIKE '%system settings%'
   OR (LOWER(module_name) LIKE '%settings%' AND LOWER(module_name) NOT LIKE '%module%' AND LOWER(module_name) NOT LIKE '%app%');



