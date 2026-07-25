-- ============================================
-- SHOW ALL USERS - FIND 5@tanggo.ca
-- ============================================
-- This shows ALL users so you can find the one you need

SELECT 
    id,
    email,
    first_name,
    last_name,
    full_name,
    created_at
FROM users
ORDER BY email;


