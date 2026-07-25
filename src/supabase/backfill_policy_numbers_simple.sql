-- SIMPLE VERSION: Backfill policy numbers for existing policies
-- Run this directly in Supabase SQL editor

-- This will generate policy numbers for all policies that don't have them
-- Format: [type_number].[sequence] e.g., "1.01", "4.03"

WITH policies_to_update AS (
    SELECT 
        p.id,
        p.business_id,
        p.policy_type,
        p.created_at,
        pt.type_number,
        ROW_NUMBER() OVER (
            PARTITION BY p.business_id, p.policy_type 
            ORDER BY p.created_at ASC
        ) as sequence_num
    FROM hr_policies p
    INNER JOIN hr_policy_types pt 
        ON pt.display_name = p.policy_type 
        AND pt.business_id = p.business_id
    WHERE p.policy_number IS NULL
)
UPDATE hr_policies
SET 
    policy_number = type_number::TEXT || '.' || LPAD(sequence_num::TEXT, 2, '0'),
    updated_at = NOW()
FROM policies_to_update
WHERE hr_policies.id = policies_to_update.id;

-- Verify the update
SELECT 
    policy_type,
    COUNT(*) as total,
    COUNT(policy_number) as with_number,
    STRING_AGG(DISTINCT policy_number, ', ' ORDER BY policy_number) as policy_numbers
FROM hr_policies
GROUP BY policy_type
ORDER BY policy_type;


