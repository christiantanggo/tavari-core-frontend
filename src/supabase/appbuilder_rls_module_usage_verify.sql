-- Step 36: Verify RLS is enabled on business_module_usage table
-- RLS already enabled - verify it's enabled

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = 'business_module_usage' 
        AND schemaname = 'public'
        AND rowsecurity = true
    ) THEN
        ALTER TABLE business_module_usage ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- Note: RLS policies already exist (see Step 37)




