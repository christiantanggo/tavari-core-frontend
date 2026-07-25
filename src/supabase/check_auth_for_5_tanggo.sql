-- ============================================
-- CHECK AUTH ACCOUNT FOR 5@tanggo.ca
-- ============================================
-- User ID: e861f114-7a95-47c3-a4ca-465e7c405aac
-- ============================================

-- Check if auth account exists
SELECT 
    id,
    email,
    email_confirmed_at,
    created_at,
    updated_at,
    last_sign_in_at,
    banned_until,
    confirmation_sent_at,
    recovery_sent_at
FROM auth.users
WHERE id = 'e861f114-7a95-47c3-a4ca-465e7c405aac'
   OR email = '5@tanggo.ca'
   OR LOWER(email) = '5@tanggo.ca';


