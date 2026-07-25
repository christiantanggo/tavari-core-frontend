-- Step 2: Create the create_user_from_personal_info_token function
-- This function creates a new user from a personal info token

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
  contract_business_id UUID;
  final_business_id UUID;
BEGIN
  -- Check if user already exists with this token
  SELECT id INTO user_id_result
  FROM public.users
  WHERE personal_info_token = token_param
  LIMIT 1;
  
  IF user_id_result IS NOT NULL THEN
    RAISE EXCEPTION 'User already exists with this token. Use update function instead.';
  END IF;
  
  -- CRITICAL: Also check if user exists by email (employee may have been created when contract was sent)
  IF p_email IS NOT NULL THEN
    SELECT id INTO user_id_result
    FROM public.users
    WHERE email = LOWER(TRIM(p_email))
    LIMIT 1;
    
    IF user_id_result IS NOT NULL THEN
      -- User exists by email - update them instead of creating new
      RAISE EXCEPTION 'User already exists with this email. Use update function instead.';
    END IF;
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
    NULL, -- Clear token after creation
    ARRAY['employee']::TEXT[],
    'active'
  )
  RETURNING id INTO user_id_result;
  
  -- Link to business if business_id is available
  IF final_business_id IS NOT NULL THEN
    -- Create user_roles entry
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
    
    -- Create business_users entry (required for portal access)
    IF NOT EXISTS (
      SELECT 1 FROM public.business_users
      WHERE user_id = user_id_result
      AND business_id = final_business_id
    ) THEN
      INSERT INTO public.business_users (
        user_id,
        business_id,
        role
      ) VALUES (
        user_id_result,
        final_business_id,
        'employee'
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
-- Note: Grant without parameter list to avoid signature mismatch issues
GRANT EXECUTE ON FUNCTION create_user_from_personal_info_token TO public;

-- Force PostgREST to refresh schema cache
NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

