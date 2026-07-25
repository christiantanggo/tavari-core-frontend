-- Backfill policy numbers for existing policies
-- This script generates policy numbers for policies that don't have them
-- Format: [type_number].[sequence] e.g., "1.01", "4.03"

-- First, let's see what we're working with
SELECT 
    p.id,
    p.policy_name,
    p.policy_type,
    p.policy_number,
    p.business_id,
    pt.type_number,
    pt.display_name
FROM hr_policies p
LEFT JOIN hr_policy_types pt ON pt.display_name = p.policy_type AND pt.business_id = p.business_id
WHERE p.policy_number IS NULL
ORDER BY p.business_id, p.policy_type, p.created_at;

-- Function to backfill policy numbers for a specific business
CREATE OR REPLACE FUNCTION backfill_policy_numbers(p_business_id UUID)
RETURNS TABLE(
    policy_id UUID,
    policy_name TEXT,
    old_policy_number TEXT,
    new_policy_number TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    policy_record RECORD;
    type_record RECORD;
    next_sequence INTEGER;
    generated_number TEXT;
BEGIN
    -- Loop through all policies without policy numbers, grouped by type
    FOR type_record IN 
        SELECT DISTINCT pt.type_number, pt.display_name, pt.business_id
        FROM hr_policy_types pt
        INNER JOIN hr_policies p ON p.policy_type = pt.display_name AND p.business_id = pt.business_id
        WHERE pt.business_id = p_business_id
        AND p.policy_number IS NULL
        ORDER BY pt.type_number, pt.display_name
    LOOP
        -- Get all policies of this type without policy numbers, ordered by creation date
        next_sequence := 1;
        
        FOR policy_record IN
            SELECT p.id, p.policy_name, p.policy_type, p.created_at
            FROM hr_policies p
            WHERE p.business_id = p_business_id
            AND p.policy_type = type_record.display_name
            AND p.policy_number IS NULL
            ORDER BY p.created_at ASC
        LOOP
            -- Generate policy number: type_number.sequence (padded to 2 digits)
            generated_number := type_record.type_number::TEXT || '.' || LPAD(next_sequence::TEXT, 2, '0');
            
            -- Update the policy
            UPDATE hr_policies
            SET policy_number = generated_number,
                updated_at = NOW()
            WHERE id = policy_record.id;
            
            -- Return the result
            policy_id := policy_record.id;
            policy_name := policy_record.policy_name;
            old_policy_number := NULL;
            new_policy_number := generated_number;
            RETURN NEXT;
            
            -- Increment sequence for next policy of this type
            next_sequence := next_sequence + 1;
        END LOOP;
    END LOOP;
    
    RETURN;
END;
$$;

-- Run the backfill for all businesses (or specify a business_id)
-- Option 1: Backfill for a specific business
-- SELECT * FROM backfill_policy_numbers('YOUR_BUSINESS_ID_HERE');

-- Option 2: Backfill for all businesses
DO $$
DECLARE
    business_record RECORD;
BEGIN
    FOR business_record IN 
        SELECT DISTINCT business_id 
        FROM hr_policies 
        WHERE policy_number IS NULL
    LOOP
        PERFORM backfill_policy_numbers(business_record.business_id);
        RAISE NOTICE 'Backfilled policy numbers for business: %', business_record.business_id;
    END LOOP;
END $$;

-- Verify the results
SELECT 
    p.id,
    p.policy_name,
    p.policy_type,
    p.policy_number,
    pt.type_number,
    p.created_at
FROM hr_policies p
LEFT JOIN hr_policy_types pt ON pt.display_name = p.policy_type AND pt.business_id = p.business_id
WHERE p.business_id IN (SELECT DISTINCT business_id FROM hr_policies WHERE policy_number IS NOT NULL)
ORDER BY p.business_id, p.policy_type, p.policy_number;

-- Summary by type
SELECT 
    p.business_id,
    p.policy_type,
    pt.type_number,
    COUNT(*) as total_policies,
    COUNT(p.policy_number) as with_number,
    STRING_AGG(p.policy_number, ', ' ORDER BY p.policy_number) as policy_numbers
FROM hr_policies p
LEFT JOIN hr_policy_types pt ON pt.display_name = p.policy_type AND pt.business_id = p.business_id
GROUP BY p.business_id, p.policy_type, pt.type_number
ORDER BY p.business_id, pt.type_number;


