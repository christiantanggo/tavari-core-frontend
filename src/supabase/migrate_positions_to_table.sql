-- Migration script to move positions from users.position to positions table
-- This script:
-- 1. Extracts unique positions from users table per business
-- 2. Creates corresponding entries in the positions table
-- 3. Assumes you've already run create_positions_table.sql

DO $$
DECLARE
    business_record RECORD;
    position_record RECORD;
    position_id UUID;
    existing_position RECORD;
    business_positions TEXT[];
BEGIN
    -- Loop through each business
    FOR business_record IN SELECT DISTINCT id FROM businesses LOOP
        -- Collect all unique positions for this business
        business_positions := ARRAY[]::TEXT[];
        
        FOR position_record IN 
            SELECT DISTINCT u.position 
            FROM users u
            INNER JOIN business_users bu ON u.id = bu.user_id
            WHERE bu.business_id = business_record.id
                AND u.position IS NOT NULL 
                AND u.position != ''
        LOOP
            -- Check if position already exists in positions table
            SELECT * INTO existing_position
            FROM positions
            WHERE business_id = business_record.id 
                AND position_name = position_record.position;
            
            -- If position doesn't exist, create it
            IF existing_position IS NULL THEN
                INSERT INTO positions (business_id, position_name, color, is_active)
                VALUES (
                    business_record.id,
                    position_record.position,
                    CASE 
                        WHEN position_record.position LIKE '%President%' OR position_record.position LIKE '%CEO%' THEN '#dc3545'
                        WHEN position_record.position LIKE '%Director%' THEN '#fd7e14'
                        WHEN position_record.position LIKE '%Lead%' OR position_record.position LIKE '%Supervisor%' THEN '#28a745'
                        WHEN position_record.position LIKE '%Clerk%' THEN '#007bff'
                        WHEN position_record.position LIKE '%Cleaner%' THEN '#6610f2'
                        WHEN position_record.position LIKE '%Manager%' THEN '#fbbf24'
                        ELSE '#4a90e2'
                    END,
                    true
                );
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- Optional: If you want to see what positions were created for each business
-- Run this query to verify:
SELECT 
    b.name as business_name,
    p.position_name,
    p.color,
    COUNT(u.id) as employee_count
FROM positions p
INNER JOIN businesses b ON p.business_id = b.id
LEFT JOIN users u ON u.position = p.position_name
INNER JOIN business_users bu ON u.id = bu.user_id AND bu.business_id = p.business_id
GROUP BY b.name, p.position_name, p.color
ORDER BY b.name, p.position_name;
