-- Create RPC functions to bypass PostgREST schema cache issues
-- These functions use dynamic SQL to access columns even if PostgREST cache is stale

-- ============================================================================
-- DROP EXISTING FUNCTIONS FIRST (to avoid return type conflicts)
-- ============================================================================

DROP FUNCTION IF EXISTS get_user_by_personal_info_token(TEXT);
DROP FUNCTION IF EXISTS get_contract_by_personal_info_token(TEXT);

-- ============================================================================
-- FUNCTION: Get user by personal_info_token (bypasses PostgREST cache)
-- ============================================================================

CREATE FUNCTION get_user_by_personal_info_token(token_param TEXT)
RETURNS TABLE (
  id UUID,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  address_city TEXT,
  address_state TEXT,
  address_postal_code TEXT,
  phone TEXT,
  sin TEXT,
  birth_date DATE,  -- Fixed: column is birth_date not birthdate
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  emergency_contact_relationship TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Bypass RLS by using SECURITY DEFINER and explicit table access
  RETURN QUERY
  SELECT 
    u.id,
    u.email,
    u.first_name,
    u.last_name,
    u.address_line1,
    u.address_line2,
    u.address_city,
    u.address_state,
    u.address_postal_code,
    u.phone,
    u.sin,
    u.birth_date,  -- Fixed: column is birth_date not birthdate
    u.emergency_contact_name,
    u.emergency_contact_phone,
    u.emergency_contact_relationship
  FROM public.users u
  WHERE u.personal_info_token = token_param;
END;
$$;

-- Grant execute to public (for unauthenticated access)
GRANT EXECUTE ON FUNCTION get_user_by_personal_info_token(TEXT) TO public;

COMMENT ON FUNCTION get_user_by_personal_info_token(TEXT) IS 'Get user by personal_info_token - bypasses PostgREST schema cache issues';

-- ============================================================================
-- FUNCTION: Get contract by personal_info_token (bypasses PostgREST cache)
-- ============================================================================

CREATE FUNCTION get_contract_by_personal_info_token(token_param TEXT)
RETURNS TABLE (
  id UUID,
  business_id UUID,
  employee_email TEXT,
  employee_first_name TEXT,
  employee_last_name TEXT,
  employee_address TEXT,
  contract_data JSONB,
  personal_info_submitted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Bypass RLS by using SECURITY DEFINER and explicit table access
  RETURN QUERY
  SELECT 
    c.id,
    c.business_id,
    c.employee_email,
    c.employee_first_name,
    c.employee_last_name,
    c.employee_address,
    c.contract_data,
    c.personal_info_submitted_at,
    c.expires_at
  FROM public.hr_contracts c
  WHERE c.personal_info_token = token_param;
END;
$$;

-- Grant execute to public (for unauthenticated access)
GRANT EXECUTE ON FUNCTION get_contract_by_personal_info_token(TEXT) TO public;

COMMENT ON FUNCTION get_contract_by_personal_info_token(TEXT) IS 'Get contract by personal_info_token - bypasses PostgREST schema cache issues';

-- ============================================================================
-- FUNCTION: Update user by personal_info_token (bypasses PostgREST cache and RLS)
-- ============================================================================

CREATE OR REPLACE FUNCTION update_user_personal_info(
  token_param TEXT,
  p_email TEXT,
  p_first_name TEXT,
  p_last_name TEXT,
  p_sin TEXT,
  p_birth_date DATE,
  p_address_line1 TEXT,
  p_address_line2 TEXT,
  p_address_city TEXT,
  p_address_state TEXT,
  p_address_postal_code TEXT,
  p_phone TEXT,
  p_emergency_contact_name TEXT,
  p_emergency_contact_phone TEXT,
  p_emergency_contact_relationship TEXT,
  p_pin TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_id_result UUID;
BEGIN
  -- Find user by token
  SELECT id INTO user_id_result
  FROM public.users
  WHERE personal_info_token = token_param;
  
  IF user_id_result IS NULL THEN
    RAISE EXCEPTION 'User not found with provided token';
  END IF;
  
  -- Update user with all personal info
  UPDATE public.users
  SET
    email = COALESCE(p_email, email),
    first_name = COALESCE(p_first_name, first_name),
    last_name = COALESCE(p_last_name, last_name),
    full_name = COALESCE(p_first_name || ' ' || p_last_name, full_name),
    sin = COALESCE(p_sin, sin),
    sin_number = COALESCE(p_sin, sin_number), -- Also update sin_number column
    birth_date = COALESCE(p_birth_date, birth_date),
    address_line1 = COALESCE(p_address_line1, address_line1),
    address_line2 = COALESCE(p_address_line2, address_line2),
    address_city = COALESCE(p_address_city, address_city),
    address_state = COALESCE(p_address_state, address_state),
    address_postal_code = COALESCE(p_address_postal_code, address_postal_code),
    phone = COALESCE(p_phone, phone),
    emergency_contact_name = COALESCE(p_emergency_contact_name, emergency_contact_name),
    emergency_contact_phone = COALESCE(p_emergency_contact_phone, emergency_contact_phone),
    emergency_contact_relationship = COALESCE(p_emergency_contact_relationship, emergency_contact_relationship),
    pin = COALESCE(p_pin, pin),
    personal_info_token = NULL, -- Clear token after submission
    updated_at = NOW()
  WHERE id = user_id_result;
  
  RETURN user_id_result;
END;
$$;

-- Grant execute to public (for unauthenticated access)
DO $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.update_user_personal_info(TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO public';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Grant statement failed: %', SQLERRM;
    -- Continue anyway - function was created
END $$;

-- Force PostgREST to refresh schema cache to see the new function
NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Test the functions exist
SELECT 
    'FUNCTION VERIFICATION' as check_type,
    routine_name,
    routine_type,
    '✅ Function exists' as status
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('get_user_by_personal_info_token', 'get_contract_by_personal_info_token', 'update_user_personal_info')
ORDER BY routine_name;

