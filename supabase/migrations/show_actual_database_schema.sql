-- COMPREHENSIVE DATABASE SCHEMA DIAGNOSTIC
-- This shows the ACTUAL column names and structure so we can fix the code properly

-- ============================================================================
-- USERS TABLE - ALL COLUMNS RELATED TO PERSONAL INFO
-- ============================================================================

SELECT 
    'USERS TABLE COLUMNS' as section,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'users'
  AND (
    column_name LIKE '%address%' OR
    column_name LIKE '%birth%' OR
    column_name LIKE '%sin%' OR
    column_name LIKE '%emergency%' OR
    column_name LIKE '%personal_info%' OR
    column_name IN ('id', 'email', 'first_name', 'last_name', 'phone')
  )
ORDER BY column_name;

-- ============================================================================
-- HR_CONTRACTS TABLE - ALL COLUMNS
-- ============================================================================

SELECT 
    'HR_CONTRACTS TABLE COLUMNS' as section,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'hr_contracts'
ORDER BY column_name;

-- ============================================================================
-- SAMPLE DATA - USERS WITH PERSONAL_INFO_TOKEN
-- ============================================================================

SELECT 
    'SAMPLE USER DATA' as section,
    id,
    email,
    first_name,
    last_name,
    phone,
    -- Show all birth-related columns
    birthdate,
    birth_date,
    birth_day,
    date_of_birth,
    dob,
    -- Show all address columns
    address,
    address_line1,
    address_line2,
    address_city,
    address_state,
    address_postal_code,
    address_province,
    -- Show personal info columns
    sin,
    emergency_contact_name,
    emergency_contact_phone,
    emergency_contact_relationship,
    personal_info_token
FROM users
WHERE personal_info_token IS NOT NULL
LIMIT 5;

-- ============================================================================
-- SAMPLE DATA - CONTRACTS WITH PERSONAL_INFO_TOKEN
-- ============================================================================

SELECT 
    'SAMPLE CONTRACT DATA' as section,
    id,
    business_id,
    employee_email,
    employee_first_name,
    employee_last_name,
    employee_address,
    contract_data,
    personal_info_token,
    personal_info_submitted_at,
    expires_at
FROM hr_contracts
WHERE personal_info_token IS NOT NULL
LIMIT 5;

-- ============================================================================
-- CHECK FOR BIRTH DATE COLUMN VARIATIONS
-- ============================================================================

SELECT 
    'BIRTH DATE COLUMN CHECK' as section,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'users'
  AND (
    column_name LIKE '%birth%' OR
    column_name LIKE '%dob%' OR
    column_name LIKE '%date_of_birth%'
  )
ORDER BY column_name;

-- ============================================================================
-- CHECK RPC FUNCTION SIGNATURES
-- ============================================================================

SELECT 
    'RPC FUNCTION SIGNATURES' as section,
    routine_name,
    routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('get_user_by_personal_info_token', 'get_contract_by_personal_info_token')
ORDER BY routine_name;

-- ============================================================================
-- CHECK ALL COLUMNS IN USERS TABLE (FULL LIST)
-- ============================================================================

SELECT 
    'ALL USERS COLUMNS' as section,
    column_name,
    data_type,
    ordinal_position
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'users'
ORDER BY ordinal_position;












