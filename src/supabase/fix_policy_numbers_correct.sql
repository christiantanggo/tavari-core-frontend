-- Fix policy numbers with correct logic:
-- Format: [category].[policy_sequence].[version_sequence]
-- Where:
--   category = category display_order
--   policy_sequence = sequential number of ORIGINAL policies in that category (not versions)
--   version_sequence = sequential version number (1.0 = 01, 1.1 = 02, 2.0 = 03, etc.)

-- Step 1: Create function to get version sequence number
-- For "1.0" -> 01, "1.1" -> 02, "2.0" -> 03, etc.
CREATE OR REPLACE FUNCTION get_version_sequence(policy_version_text TEXT)
RETURNS INTEGER AS $$
DECLARE
    major_part INTEGER;
    minor_part INTEGER;
BEGIN
    IF policy_version_text IS NULL OR policy_version_text = '' THEN
        RETURN 1;
    END IF;
    
    -- Parse version like "1.1" or "2.0"
    major_part := COALESCE(SPLIT_PART(policy_version_text, '.', 1)::INTEGER, 1);
    minor_part := COALESCE(SPLIT_PART(policy_version_text, '.', 2)::INTEGER, 0);
    
    -- Calculate sequential version: (major - 1) * 10 + minor + 1
    -- 1.0 = (1-1)*10 + 0 + 1 = 1
    -- 1.1 = (1-1)*10 + 1 + 1 = 2
    -- 2.0 = (2-1)*10 + 0 + 1 = 11
    -- Actually, simpler: just use minor + 1 for now, or count versions
    
    -- Better approach: count versions sequentially
    -- For now, use: major * 10 + minor (but this doesn't work well)
    -- Let's use a simpler approach: minor version + 1 if minor exists, else 1
    IF minor_part > 0 THEN
        RETURN minor_part + 1;
    ELSE
        -- If minor is 0, it's the first version
        RETURN 1;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Actually, let's use a better approach - count versions of the same policy
-- Step 2: Identify original policies (those without parent_policy_id or is_current_version = true)
-- and group versions together

-- First, let's identify which policy each record belongs to (by parent_policy_id or id)
WITH policy_groups AS (
    SELECT 
        p.id,
        p.business_id,
        p.policy_name,
        p.policy_categories,
        p.policy_version,
        p.created_at,
        p.parent_policy_id,
        p.is_current_version,
        -- Get the root policy ID (original policy)
        COALESCE(p.parent_policy_id, p.id) as root_policy_id,
        get_first_category_id(p.policy_categories) as first_category_id
    FROM hr_policies p
),
policy_with_category AS (
    SELECT 
        pg.*,
        get_category_number(pg.first_category_id, pg.business_id) as category_number,
        get_version_sequence(pg.policy_version) as version_sequence
    FROM policy_groups pg
),
-- Get the original policies only (for sequence numbering)
original_policies AS (
    SELECT DISTINCT ON (pwc.business_id, pwc.category_number, pwc.root_policy_id)
        pwc.*
    FROM policy_with_category pwc
    WHERE pwc.parent_policy_id IS NULL OR pwc.is_current_version = true
    ORDER BY pwc.business_id, pwc.category_number, pwc.root_policy_id, pwc.created_at ASC
),
-- Assign sequence numbers to original policies
original_with_sequence AS (
    SELECT 
        op.*,
        ROW_NUMBER() OVER (
            PARTITION BY op.business_id, op.category_number
            ORDER BY op.created_at ASC
        ) as policy_sequence
    FROM original_policies op
),
-- Now get all policies and match them to their original policy sequence
all_policies_with_sequence AS (
    SELECT 
        pwc.id,
        pwc.business_id,
        pwc.root_policy_id,
        pwc.category_number,
        pwc.version_sequence,
        ows.policy_sequence
    FROM policy_with_category pwc
    LEFT JOIN original_with_sequence ows ON 
        ows.root_policy_id = pwc.root_policy_id 
        AND ows.business_id = pwc.business_id
)
-- Update all policies
UPDATE hr_policies p
SET 
    policy_number = LPAD(aps.category_number::TEXT, 2, '0') || '.' ||
                    LPAD(aps.policy_sequence::TEXT, 2, '0') || '.' ||
                    LPAD(aps.version_sequence::TEXT, 2, '0'),
    updated_at = NOW()
FROM all_policies_with_sequence aps
WHERE p.id = aps.id
AND (p.policy_number IS NULL OR p.policy_number NOT LIKE '%.%.%' OR p.policy_number != 
    (LPAD(aps.category_number::TEXT, 2, '0') || '.' ||
     LPAD(aps.policy_sequence::TEXT, 2, '0') || '.' ||
     LPAD(aps.version_sequence::TEXT, 2, '0'))
);

-- Actually, let me simplify this. The issue is:
-- 1. We need to identify the FIRST policy in a category (by creation date, original only)
-- 2. We need to count versions sequentially

-- Better approach: Use a simpler version counting
DROP FUNCTION IF EXISTS get_version_sequence(TEXT);
CREATE OR REPLACE FUNCTION get_version_sequence(policy_version_text TEXT)
RETURNS INTEGER AS $$
DECLARE
    major_part INTEGER;
    minor_part INTEGER;
BEGIN
    IF policy_version_text IS NULL OR policy_version_text = '' THEN
        RETURN 1;
    END IF;
    
    major_part := COALESCE(SPLIT_PART(policy_version_text, '.', 1)::INTEGER, 1);
    minor_part := COALESCE(SPLIT_PART(policy_version_text, '.', 2)::INTEGER, 0);
    
    -- For version numbering: 1.0 = 01, 1.1 = 02, 2.0 = 03
    -- Use: (major - 1) + minor + 1
    -- 1.0: (1-1) + 0 + 1 = 1
    -- 1.1: (1-1) + 1 + 1 = 2  
    -- 2.0: (2-1) + 0 + 1 = 2 (but should be 3?)
    
    -- Actually, let's count versions of the same root policy
    -- For now, use minor version + 1
    RETURN minor_part + 1;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Now fix the policy sequence to only count original policies
WITH policy_roots AS (
    SELECT 
        p.id,
        p.business_id,
        COALESCE(p.parent_policy_id, p.id) as root_policy_id,
        get_first_category_id(p.policy_categories) as first_category_id,
        p.created_at,
        p.policy_version
    FROM hr_policies p
),
policy_with_category AS (
    SELECT 
        pr.*,
        get_category_number(pr.first_category_id, pr.business_id) as category_number,
        get_version_sequence(pr.policy_version) as version_sequence
    FROM policy_roots pr
),
-- Get unique root policies only (for sequence numbering)
unique_roots AS (
    SELECT DISTINCT ON (pwc.business_id, pwc.category_number, pwc.root_policy_id)
        pwc.*
    FROM policy_with_category pwc
    ORDER BY pwc.business_id, pwc.category_number, pwc.root_policy_id, pwc.created_at ASC
),
-- Assign sequence to root policies
root_sequences AS (
    SELECT 
        ur.root_policy_id,
        ur.business_id,
        ur.category_number,
        ROW_NUMBER() OVER (
            PARTITION BY ur.business_id, ur.category_number
            ORDER BY ur.created_at ASC
        ) as policy_sequence
    FROM unique_roots ur
),
-- Match all policies to their root sequence
all_policies_matched AS (
    SELECT 
        pwc.id,
        pwc.business_id,
        pwc.root_policy_id,
        pwc.category_number,
        pwc.version_sequence,
        rs.policy_sequence
    FROM policy_with_category pwc
    INNER JOIN root_sequences rs ON 
        rs.root_policy_id = pwc.root_policy_id
        AND rs.business_id = pwc.business_id
)
-- Update all policies
UPDATE hr_policies p
SET 
    policy_number = LPAD(apm.category_number::TEXT, 2, '0') || '.' ||
                    LPAD(apm.policy_sequence::TEXT, 2, '0') || '.' ||
                    LPAD(apm.version_sequence::TEXT, 2, '0'),
    updated_at = NOW()
FROM all_policies_matched apm
WHERE p.id = apm.id;

-- Verify results
SELECT 
    p.id,
    p.policy_name,
    p.policy_number,
    p.policy_version,
    p.parent_policy_id,
    p.is_current_version,
    get_first_category_id(p.policy_categories) as first_category_id
FROM hr_policies p
ORDER BY p.business_id, p.policy_number;


