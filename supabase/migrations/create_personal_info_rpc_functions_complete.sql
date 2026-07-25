-- Complete RPC functions for personal info form (works for unauthenticated users)
-- These functions use SECURITY DEFINER to bypass RLS

-- ============================================================================
-- DROP EXISTING FUNCTIONS FIRST
-- ============================================================================

DROP FUNCTION IF EXISTS create_user_from_personal_info_token(TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS update_user_personal_info_complete(TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID);

-- ============================================================================
-- FUNCTION: Create new user from personal_info_token (for employees not in system)
-- ============================================================================

CREATE OR REPLACE FUNCTION create_user_from_personal_info_token(
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
  p_hashed_password TEXT,
  p_hashed_pin TEXT,
  p_business_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_id_result UUID;
  contract_record RECORD;
  final_business_id UUID;
BEGIN
  -- Verify token exists in hr_contracts or users table
  SELECT id, business_id INTO contract_record
  FROM public.hr_contracts
  WHERE personal_info_token = token_param
  LIMIT 1;
  
  -- If no contract found, check if user exists with token
  IF contract_record IS NULL OR contract_record.id IS NULL THEN
    SELECT id INTO user_id_result
    FROM public.users
    WHERE personal_info_token = token_param
    LIMIT 1;
    
    IF user_id_result IS NOT NULL THEN
      RAISE EXCEPTION 'User already exists with this token. Use update function instead.';
    END IF;
  END IF;
  
  -- Use business_id from contract if provided, otherwise use parameter
  final_business_id := COALESCE(p_business_id, CASE WHEN contract_record IS NOT NULL THEN contract_record.business_id ELSE NULL END);
  
  -- Create new user
  INSERT INTO public.users (
    email,
    first_name,
    last_name,
    full_name,
    sin,
    sin_number,
    birth_date,
    address_line1,
    address_line2,
    address_city,
    address_state,
    address_postal_code,
    phone,
    emergency_contact_name,
    emergency_contact_phone,
    emergency_contact_relationship,
    hashed_password,
    pin,
    personal_info_token,
    roles,
    status
  ) VALUES (
    LOWER(TRIM(p_email)),
    TRIM(p_first_name),
    TRIM(p_last_name),
    TRIM(p_first_name) || ' ' || TRIM(p_last_name),
    REGEXP_REPLACE(p_sin, '\D', '', 'g'),
    REGEXP_REPLACE(p_sin, '\D', '', 'g'),
    p_birth_date,
    TRIM(p_address_line1),
    NULLIF(TRIM(p_address_line2), ''),
    TRIM(p_address_city),
    TRIM(p_address_state),
    TRIM(p_address_postal_code),
    NULLIF(TRIM(p_phone), ''),
    TRIM(p_emergency_contact_name),
    TRIM(p_emergency_contact_phone),
    TRIM(p_emergency_contact_relationship),
    p_hashed_password,
    p_hashed_pin,
    NULL, -- Clear token after creation
    ARRAY['employee']::TEXT[],
    'active'
  )
  RETURNING id INTO user_id_result;
  
  -- Link to business if business_id is available
  IF final_business_id IS NOT NULL THEN
    -- Check if user_roles entry already exists
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = user_id_result
      AND business_id = final_business_id
    ) THEN
      INSERT INTO public.user_roles (
        user_id,
        business_id,
        role,
        active
      ) VALUES (
        user_id_result,
        final_business_id,
        'employee',
        true
      );
    END IF;
    
    -- Update contract if it exists
    UPDATE public.hr_contracts
    SET
      personal_info_submitted_at = NOW(),
      employee_id = user_id_result
    WHERE personal_info_token = token_param;
  END IF;
  
  RETURN user_id_result;
END;
$$;

-- Grant execute to public (for unauthenticated access)
GRANT EXECUTE ON FUNCTION create_user_from_personal_info_token(TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO public;

-- ============================================================================
-- FUNCTION: Update existing user by personal_info_token (complete version with password/PIN)
-- ============================================================================

CREATE OR REPLACE FUNCTION update_user_personal_info_complete(
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
  p_hashed_password TEXT DEFAULT NULL,
  p_hashed_pin TEXT,
  p_business_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_id_result UUID;
  contract_record RECORD;
  final_business_id UUID;
BEGIN
  -- Find user by token
  SELECT id INTO user_id_result
  FROM public.users
  WHERE personal_info_token = token_param
  LIMIT 1;
  
  IF user_id_result IS NULL THEN
    RAISE EXCEPTION 'User not found with provided token';
  END IF;
  
  -- Get contract info if exists
  SELECT id, business_id INTO contract_record
  FROM public.hr_contracts
  WHERE personal_info_token = token_param
  LIMIT 1;
  
  final_business_id := COALESCE(p_business_id, CASE WHEN contract_record IS NOT NULL THEN contract_record.business_id ELSE NULL END);
  
  -- Update user with all personal info
  UPDATE public.users
  SET
    email = COALESCE(LOWER(TRIM(p_email)), email),
    first_name = COALESCE(TRIM(p_first_name), first_name),
    last_name = COALESCE(TRIM(p_last_name), last_name),
    full_name = COALESCE(TRIM(p_first_name) || ' ' || TRIM(p_last_name), full_name),
    sin = COALESCE(REGEXP_REPLACE(p_sin, '\D', '', 'g'), sin),
    sin_number = COALESCE(REGEXP_REPLACE(p_sin, '\D', '', 'g'), sin_number),
    birth_date = COALESCE(p_birth_date, birth_date),
    address_line1 = COALESCE(TRIM(p_address_line1), address_line1),
    address_line2 = COALESCE(NULLIF(TRIM(p_address_line2), ''), address_line2),
    address_city = COALESCE(TRIM(p_address_city), address_city),
    address_state = COALESCE(TRIM(p_address_state), address_state),
    address_postal_code = COALESCE(TRIM(p_address_postal_code), address_postal_code),
    phone = COALESCE(NULLIF(TRIM(p_phone), ''), phone),
    emergency_contact_name = COALESCE(TRIM(p_emergency_contact_name), emergency_contact_name),
    emergency_contact_phone = COALESCE(TRIM(p_emergency_contact_phone), emergency_contact_phone),
    emergency_contact_relationship = COALESCE(TRIM(p_emergency_contact_relationship), emergency_contact_relationship),
    hashed_password = COALESCE(p_hashed_password, hashed_password),
    pin = COALESCE(p_hashed_pin, pin),
    personal_info_token = NULL, -- Clear token after submission
    updated_at = NOW()
  WHERE id = user_id_result;
  
  -- Link to business if business_id is available and not already linked
  IF final_business_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = user_id_result
      AND business_id = final_business_id
    ) THEN
      INSERT INTO public.user_roles (
        user_id,
        business_id,
        role,
        active
      ) VALUES (
        user_id_result,
        final_business_id,
        'employee',
        true
      );
    END IF;
    
    -- Update contract if it exists
    IF contract_record.id IS NOT NULL THEN
      UPDATE public.hr_contracts
      SET
        personal_info_submitted_at = NOW(),
        employee_id = user_id_result
      WHERE id = contract_record.id;
    END IF;
  END IF;
  
  RETURN user_id_result;
END;
$$;

-- Grant execute to public (for unauthenticated access)
GRANT EXECUTE ON FUNCTION update_user_personal_info_complete(TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO public;

-- Force PostgREST to refresh schema cache
NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

COMMENT ON FUNCTION create_user_from_personal_info_token IS 'Create new user from personal_info_token - works for unauthenticated users';
COMMENT ON FUNCTION update_user_personal_info_complete IS 'Update existing user by personal_info_token - works for unauthenticated users';

