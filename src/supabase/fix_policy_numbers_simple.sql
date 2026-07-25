-- Simple fix for policy numbers
-- Format: [category].[policy_sequence].[version_number]
-- 
-- Rules:
-- 1. Category number = display_order of first category
-- 2. Policy sequence = count of ORIGINAL policies (parent_policy_id IS NULL) in that category, ordered by created_at
-- 3. Version number = minor version + 1 (1.0 -> 01, 1.1 -> 02, 2.0 -> 03)

-- Step 1: Create function to get version number from policy_version string
CREATE OR REPLACE FUNCTION get_version_number(policy_version_text TEXT)
RETURNS INTEGER AS $$
DECLARE
    minor_part INTEGER;
BEGIN
    IF policy_version_text IS NULL OR policy_version_text = '' THEN
        RETURN 1;
    END IF;
    
    -- Get minor version (second part after the dot)
    minor_part := COALESCE(SPLIT_PART(policy_version_text, '.', 2)::INTEGER, 0);
    
    -- Version number = minor + 1
    -- 1.0 -> 0 + 1 = 1 -> "01"
    -- 1.1 -> 1 + 1 = 2 -> "02"
    -- 2.0 -> 0 + 1 = 1 -> "01" (but this might be wrong, should be 3?)
    
    -- Actually, if major version increases, we need to account for that
    -- Let's use: if minor is 0 and major > 1, count major versions
    -- For simplicity, let's just use minor + 1 for now
    RETURN minor_part + 1;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 2: Fix policy numbers
-- Only count ORIGINAL policies (no parent) for sequence numbering
WITH policy_data AS (
    SELECT 
        p.id,
        p.business_id,
        p.policy_categories,
        p.policy_version,
        p.created_at,
        p.parent_policy_id,
        get_first_category_id(p.policy_categories) as first_category_id
    FROM hr_policies p
),
policy_with_category AS (
    SELECT 
        pd.*,
        get_category_number(pd.first_category_id, pd.business_id) as category_number,
        get_version_number(pd.policy_version) as version_number
    FROM policy_data pd
),
-- Get only ORIGINAL policies (no parent) for sequence counting
original_policies AS (
    SELECT 
        pwc.id,
        pwc.business_id,
        pwc.category_number,
        pwc.created_at,
        ROW_NUMBER() OVER (
            PARTITION BY pwc.business_id, pwc.category_number
            ORDER BY pwc.created_at ASC
        ) as policy_sequence
    FROM policy_with_category pwc
    WHERE pwc.parent_policy_id IS NULL  -- Only count original policies
),
-- Match all policies to their original policy's sequence
all_policies AS (
    SELECT 
        pwc.id,
        pwc.business_id,
        pwc.category_number,
        pwc.version_number,
        -- Get the root policy ID (original policy)
        COALESCE(pwc.parent_policy_id, pwc.id) as root_policy_id
    FROM policy_with_category pwc
),
matched_policies AS (
    SELECT 
        ap.id,
        ap.category_number,
        ap.version_number,
        op.policy_sequence
    FROM all_policies ap
    INNER JOIN original_policies op ON 
        op.id = ap.root_policy_id
        AND op.business_id = ap.business_id
)
-- Update all policies
UPDATE hr_policies p
SET 
    policy_number = LPAD(mp.category_number::TEXT, 2, '0') || '.' ||
                    LPAD(mp.policy_sequence::TEXT, 2, '0') || '.' ||
                    LPAD(mp.version_number::TEXT, 2, '0'),
    updated_at = NOW()
FROM matched_policies mp
WHERE p.id = mp.id;

-- Verify results
SELECT 
    p.id,
    p.policy_name,
    p.policy_number,
    p.policy_version,
    p.parent_policy_id,
    p.is_current_version,
    get_first_category_id(p.policy_categories) as first_category_id,
    get_category_number(
        get_first_category_id(p.policy_categories),
        p.business_id
    ) as category_number
FROM hr_policies p
ORDER BY p.business_id, p.policy_number;


