-- Backfill policy numbers using the correct format: [category_number].[policy_number].[version]
-- Format: 01.01.01 where:
--   First number = category number (from first category in policy_categories array)
--   Second number = policy number within that category (sequential)
--   Third number = version number

-- First, let's see what we're working with
SELECT 
    p.id,
    p.policy_name,
    p.policy_categories,
    p.policy_version,
    p.policy_number,
    p.business_id
FROM hr_policies p
WHERE p.policy_number IS NULL OR p.policy_number NOT LIKE '%.%.%'
ORDER BY p.business_id, p.created_at;

-- Function to get category number from display_order
-- We'll use display_order as the category number, or assign sequential if not set
WITH category_numbers AS (
    SELECT 
        pc.id as category_id,
        pc.business_id,
        pc.display_order,
        COALESCE(
            pc.display_order,
            ROW_NUMBER() OVER (PARTITION BY pc.business_id ORDER BY pc.created_at)
        ) as category_number
    FROM hr_policy_categories pc
    WHERE pc.is_active = true
)
-- Update policies with new numbering format
UPDATE hr_policies p
SET 
    policy_number = (
        -- Get category number from first category in policy_categories array
        SELECT LPAD(
            COALESCE(
                cn.category_number::TEXT,
                '01'  -- Default to 01 if category not found
            ),
            2, '0'
        )
        FROM category_numbers cn
        WHERE cn.category_id::TEXT = (
            -- Get first category ID from policy_categories JSONB array
            SELECT (jsonb_array_elements(p.policy_categories)->>'categoryId')::TEXT
            FROM jsonb_array_elements(p.policy_categories)
            LIMIT 1
        )
        AND cn.business_id = p.business_id
    ) || '.' || 
    -- Policy number within category (sequential based on creation date)
    LPAD(
        (
            SELECT COUNT(*) 
            FROM hr_policies p2
            WHERE p2.business_id = p.business_id
            AND p2.id != p.id
            AND (
                -- Same first category
                (jsonb_array_elements(p2.policy_categories)->>'categoryId')::TEXT = 
                (SELECT (jsonb_array_elements(p.policy_categories)->>'categoryId')::TEXT
                 FROM jsonb_array_elements(p.policy_categories)
                 LIMIT 1)
            )
            AND p2.created_at < p.created_at
        ) + 1,
        2, '0'
    ) || '.' ||
    -- Version number (from policy_version field, default to 1.0)
    LPAD(
        COALESCE(
            SPLIT_PART(p.policy_version, '.', 1)::INTEGER,
            1
        )::TEXT,
        2, '0'
    ),
    updated_at = NOW()
WHERE p.policy_categories IS NOT NULL 
AND jsonb_array_length(p.policy_categories) > 0;

-- For policies without categories, use a default category number (00)
UPDATE hr_policies p
SET 
    policy_number = '00.' ||
    LPAD(
        (
            SELECT COUNT(*) 
            FROM hr_policies p2
            WHERE p2.business_id = p.business_id
            AND p2.id != p.id
            AND (p2.policy_categories IS NULL OR jsonb_array_length(p2.policy_categories) = 0)
            AND p2.created_at < p.created_at
        ) + 1,
        2, '0'
    ) || '.' ||
    LPAD(
        COALESCE(
            SPLIT_PART(p.policy_version, '.', 1)::INTEGER,
            1
        )::TEXT,
        2, '0'
    ),
    updated_at = NOW()
WHERE (p.policy_categories IS NULL OR jsonb_array_length(p.policy_categories) = 0)
AND (p.policy_number IS NULL OR p.policy_number NOT LIKE '%.%.%');

-- Verify the results
SELECT 
    p.id,
    p.policy_name,
    p.policy_number,
    p.policy_version,
    p.policy_categories,
    (
        SELECT pc.category_name 
        FROM hr_policy_categories pc 
        WHERE pc.id::TEXT = (
            SELECT (jsonb_array_elements(p.policy_categories)->>'categoryId')::TEXT
            FROM jsonb_array_elements(p.policy_categories)
            LIMIT 1
        )
    ) as first_category_name
FROM hr_policies p
ORDER BY p.business_id, p.policy_number;


