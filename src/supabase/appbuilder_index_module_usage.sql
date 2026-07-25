-- Step 23: Create index on business_module_usage for performance
-- Index for enabled modules only

CREATE INDEX IF NOT EXISTS idx_business_module_usage_enabled 
    ON business_module_usage(business_id, enabled) 
    WHERE enabled = true;

-- Additional index for module_key lookups
CREATE INDEX IF NOT EXISTS idx_business_module_usage_module_key_enabled 
    ON business_module_usage(module_key, enabled) 
    WHERE enabled = true;




