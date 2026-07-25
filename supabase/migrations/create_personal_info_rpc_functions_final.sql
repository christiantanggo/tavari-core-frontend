-- Complete RPC functions for personal info form (works for unauthenticated users)
-- These functions use SECURITY DEFINER to bypass RLS

-- ============================================================================
-- DROP EXISTING FUNCTIONS FIRST (if they exist)
-- ============================================================================

DROP FUNCTION IF EXISTS create_user_from_personal_info_token(text, text, text, text, text, date, text, text, text, text, text, text, text, text, text, text, text, text, uuid);
DROP FUNCTION IF EXISTS update_user_personal_info_complete(text, text, text, text, text, date, text, text, text, text, text, text, text, text, text, text, text, text, uuid);

-- ============================================================================
-- FUNCTION: Create new user from personal_info_token (for employees not in system)
-- ============================================================================

CREATE OR REPLACE FUNCTION create_user_from_personal_info_token(
  token_param text,
  p_email text,
  p_first_name text,
  p_last_name text,
  p_sin text,
  p_birth_date date,
  p_address_line1 text,
  p_address_line2 text,
  p_address_city text,
  p_address_state text,
  p_address_postal_code text,
  p_phone text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text,
  p_emergency_contact_relationship text,
  p_hashed_password text DEFAULT NULL,
  p_hashed_pin text DEFAULT NULL,
  p_business_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_id_result uuid;
  contract_business_id uuid;
  final_business_id uuid;
BEGIN
  -- Check if user already exists with this token
  SELECT id INTO user_id_result
  FROM public.users
  WHERE personal_info_token = token_param
  LIMIT 1;
  
  IF user_id_result IS NOT NULL THEN
    RAISE EXCEPTION 'User already exists with this token. Use update function instead.';
  END IF;
  
  -- Validate required fields
  IF p_hashed_pin IS NULL THEN
    RAISE EXCEPTION 'PIN is required';
  END IF;
  
  -- Get business_id from contract if token exists there
  SELECT business_id INTO contract_business_id
  FROM public.hr_contracts
  WHERE personal_info_token = token_param
  LIMIT 1;
  
  -- Use provided business_id, or from contract, or NULL
  final_business_id := COALESCE(p_business_id, contract_business_id);
  
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
    NULL,
    ARRAY['employee']::text[],
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
DO $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_user_from_personal_info_token(text, text, text, text, text, date, text, text, text, text, text, text, text, text, text, text, text, text, uuid) TO public';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Grant failed (function may not exist yet): %', SQLERRM;
END $$;

-- ============================================================================
-- FUNCTION: Update existing user by personal_info_token (complete version with password/PIN)
-- ============================================================================

CREATE OR REPLACE FUNCTION update_user_personal_info_complete(
  token_param text,
  p_email text,
  p_first_name text,
  p_last_name text,
  p_sin text,
  p_birth_date date,
  p_address_line1 text,
  p_address_line2 text,
  p_address_city text,
  p_address_state text,
  p_address_postal_code text,
  p_phone text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text,
  p_emergency_contact_relationship text,
  p_hashed_password text DEFAULT NULL,
  p_hashed_pin text DEFAULT NULL,
  p_business_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_id_result uuid;
  contract_business_id uuid;
  contract_id uuid;
  final_business_id uuid;
BEGIN
  -- Find user by token
  SELECT id INTO user_id_result
  FROM public.users
  WHERE personal_info_token = token_param
  LIMIT 1;
  
  IF user_id_result IS NULL THEN
    RAISE EXCEPTION 'User not found with provided token';
  END IF;
  
  -- Validate required fields
  IF p_hashed_pin IS NULL THEN
    RAISE EXCEPTION 'PIN is required';
  END IF;
  
  -- Get contract info if exists
  SELECT id, business_id INTO contract_id, contract_business_id
  FROM public.hr_contracts
  WHERE personal_info_token = token_param
  LIMIT 1;
  
  -- Use provided business_id, or from contract, or NULL
  final_business_id := COALESCE(p_business_id, contract_business_id);
  
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
    personal_info_token = NULL,
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
    IF contract_id IS NOT NULL THEN
      UPDATE public.hr_contracts
      SET
        personal_info_submitted_at = NOW(),
        employee_id = user_id_result
      WHERE id = contract_id;
    END IF;
  END IF;
  
  RETURN user_id_result;
END;
$$;

-- Grant execute to public (for unauthenticated access)
DO $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.update_user_personal_info_complete(text, text, text, text, text, date, text, text, text, text, text, text, text, text, text, text, text, text, uuid) TO public';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Grant failed (function may not exist yet): %', SQLERRM;
END $$;

-- Force PostgREST to refresh schema cache
NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

COMMENT ON FUNCTION create_user_from_personal_info_token IS 'Create new user from personal_info_token - works for unauthenticated users';
COMMENT ON FUNCTION update_user_personal_info_complete IS 'Update existing user by personal_info_token - works for unauthenticated users';

