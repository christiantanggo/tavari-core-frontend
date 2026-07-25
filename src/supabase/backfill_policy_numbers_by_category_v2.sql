-- Backfill policy numbers using the correct format: [category_number].[policy_number].[version]
-- Format: 01.01.01 where:
--   First number (01) = category number (from first category's display_order)
--   Second number (01) = policy number within that category (sequential)
--   Third number (01) = version number (from policy_version field)

-- Step 1: Create a helper function to get the first category ID from policy_categories JSONB
CREATE OR REPLACE FUNCTION get_first_category_id(policy_categories_jsonb JSONB)
RETURNS TEXT AS $$
BEGIN
    IF policy_categories_jsonb IS NULL OR jsonb_array_length(policy_categories_jsonb) = 0 THEN
        RETURN NULL;
    END IF;
    
    RETURN policy_categories_jsonb->0->>'categoryId';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 2: Create a function to get category number from display_order
CREATE OR REPLACE FUNCTION get_category_number(category_id_text TEXT, business_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
    cat_number INTEGER;
BEGIN
    SELECT COALESCE(display_order, 1)
    INTO cat_number
    FROM hr_policy_categories
    WHERE id::TEXT = category_id_text
    AND business_id = business_uuid
    AND is_active = true;
    
    RETURN COALESCE(cat_number, 1);
END;
$$ LANGUAGE plpgsql STABLE;

-- Step 3: Backfill policy numbers
-- First, create a temporary table with policy data and category numbers
WITH policy_data AS (
    SELECT 
        p.id,
        p.business_id,
        p.policy_name,
        p.policy_categories,
        p.policy_version,
        p.created_at,
        get_first_category_id(p.policy_categories) as first_category_id,
        get_category_number(
            get_first_category_id(p.policy_categories),
            p.business_id
        ) as category_number,
        COALESCE(
            SPLIT_PART(p.policy_version, '.', 1)::INTEGER,
            1
        ) as version_number
    FROM hr_policies p
    WHERE p.policy_number IS NULL OR p.policy_number NOT LIKE '%.%.%'
),
policy_sequences AS (
    SELECT 
        pd.*,
        ROW_NUMBER() OVER (
            PARTITION BY pd.business_id, pd.category_number 
            ORDER BY pd.created_at ASC
        ) as policy_sequence
    FROM policy_data pd
)
UPDATE hr_policies p
SET 
    policy_number = LPAD(ps.category_number::TEXT, 2, '0') || '.' ||
                    LPAD(ps.policy_sequence::TEXT, 2, '0') || '.' ||
                    LPAD(ps.version_number::TEXT, 2, '0'),
    updated_at = NOW()
FROM policy_sequences ps
WHERE p.id = ps.id;

-- Step 4: Handle policies without categories (use category 00)
WITH policies_without_categories AS (
    SELECT 
        p.id,
        p.business_id,
        p.policy_version,
        p.created_at,
        COALESCE(
            SPLIT_PART(p.policy_version, '.', 1)::INTEGER,
            1
        ) as version_number,
        ROW_NUMBER() OVER (
            PARTITION BY p.business_id 
            ORDER BY p.created_at ASC
        ) as policy_sequence
    FROM hr_policies p
    WHERE (p.policy_categories IS NULL OR jsonb_array_length(p.policy_categories) = 0)
    AND (p.policy_number IS NULL OR p.policy_number NOT LIKE '%.%.%')
)
UPDATE hr_policies p
SET 
    policy_number = '00.' ||
                    LPAD(pwoc.policy_sequence::TEXT, 2, '0') || '.' ||
                    LPAD(pwoc.version_number::TEXT, 2, '0'),
    updated_at = NOW()
FROM policies_without_categories pwoc
WHERE p.id = pwoc.id;

-- Step 5: Verify results
SELECT 
    p.id,
    p.policy_name,
    p.policy_number,
    p.policy_version,
    (
        SELECT pc.category_name 
        FROM hr_policy_categories pc 
        WHERE pc.id::TEXT = get_first_category_id(p.policy_categories)
        AND pc.business_id = p.business_id
    ) as first_category_name,
    get_category_number(
        get_first_category_id(p.policy_categories),
        p.business_id
    ) as category_number
FROM hr_policies p
WHERE p.policy_number IS NOT NULL
ORDER BY p.business_id, p.policy_number;

-- Summary by category
SELECT 
    p.business_id,
    (
        SELECT pc.category_name 
        FROM hr_policy_categories pc 
        WHERE pc.id::TEXT = get_first_category_id(p.policy_categories)
        AND pc.business_id = p.business_id
    ) as category_name,
    get_category_number(
        get_first_category_id(p.policy_categories),
        p.business_id
    ) as category_number,
    COUNT(*) as total_policies,
    STRING_AGG(p.policy_number, ', ' ORDER BY p.policy_number) as policy_numbers
FROM hr_policies p
WHERE p.policy_number IS NOT NULL
GROUP BY p.business_id, get_first_category_id(p.policy_categories)
ORDER BY p.business_id, category_number;

