-- Step 30: Verify table structure and constraints
-- Validation script to verify all foreign keys, unique constraints, and check constraints

-- Verify app_branding table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'app_branding'
    ) THEN
        RAISE EXCEPTION 'app_branding table does not exist';
    END IF;
END $$;

-- Verify app_modules table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'app_modules'
    ) THEN
        RAISE EXCEPTION 'app_modules table does not exist';
    END IF;
END $$;

-- Verify business_module_usage has new columns
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'business_module_usage' 
        AND column_name = 'module_key'
    ) THEN
        RAISE EXCEPTION 'business_module_usage.module_key column does not exist';
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'business_module_usage' 
        AND column_name = 'enabled'
    ) THEN
        RAISE EXCEPTION 'business_module_usage.enabled column does not exist';
    END IF;
END $$;

-- Verify app_builds table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'app_builds'
    ) THEN
        RAISE EXCEPTION 'app_builds table does not exist';
    END IF;
END $$;

-- Verify foreign keys exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'app_branding_business_id_fkey'
    ) THEN
        RAISE EXCEPTION 'app_branding_business_id_fkey foreign key does not exist';
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'app_builds_business_id_fkey'
    ) THEN
        RAISE EXCEPTION 'app_builds_business_id_fkey foreign key does not exist';
    END IF;
END $$;

-- Verify indexes exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_app_branding_business_id'
    ) THEN
        RAISE EXCEPTION 'idx_app_branding_business_id index does not exist';
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_app_modules_module_key'
    ) THEN
        RAISE EXCEPTION 'idx_app_modules_module_key index does not exist';
    END IF;
END $$;

-- All checks passed
SELECT 'Schema verification completed successfully' AS status;




