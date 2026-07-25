-- Test: Create just the first function to see if it works
-- Run this first to verify the CREATE statement works

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

