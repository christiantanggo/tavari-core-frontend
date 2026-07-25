-- Check if policy_number column exists and has data
-- Run this in your Supabase SQL editor to diagnose policy number issues

-- 1. Check if column exists
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'hr_policies' 
AND column_name = 'policy_number';

-- 2. Check how many policies have policy_number set
SELECT 
    COUNT(*) as total_policies,
    COUNT(policy_number) as policies_with_number,
    COUNT(*) - COUNT(policy_number) as policies_without_number
FROM hr_policies;

-- 3. Show sample policies with and without policy_number
SELECT 
    id,
    policy_name,
    policy_number,
    policy_type,
    status,
    is_current_version,
    created_at
FROM hr_policies
ORDER BY created_at DESC
LIMIT 20;

-- 4. Check policy numbers by type
SELECT 
    policy_type,
    COUNT(*) as total,
    COUNT(policy_number) as with_number,
    STRING_AGG(DISTINCT policy_number, ', ') as sample_numbers
FROM hr_policies
GROUP BY policy_type
ORDER BY policy_type;

-- 5. If policy_number column doesn't exist, run this:
-- ALTER TABLE hr_policies ADD COLUMN IF NOT EXISTS policy_number TEXT;

-- 6. To backfill policy numbers for existing policies, run:
-- See backfill_policy_numbers.sql for the complete backfill script

