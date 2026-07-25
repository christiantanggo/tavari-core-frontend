-- Step 3: Create the update_user_personal_info_complete function
-- This function updates an existing user by using the contract's employee_id
-- REWRITTEN: Uses employee_id from contract as PRIMARY identifier (no more email/token guessing)

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
  p_hashed_pin TEXT DEFAULT NULL,
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
  contract_id UUID;
  contract_employee_id UUID;
  contract_employee_email TEXT;
  final_business_id UUID;
BEGIN
  -- Get contract info - CRITICAL: Get employee_id from contract
  SELECT id, business_id, employee_id, employee_email
  INTO contract_id, contract_business_id, contract_employee_id, contract_employee_email
  FROM public.hr_contracts
  WHERE personal_info_token = token_param
  LIMIT 1;
  
  -- PRIMARY: Use employee_id from contract (this is set when employee is created)
  IF contract_employee_id IS NOT NULL THEN
    user_id_result := contract_employee_id;
    -- Verify user exists
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = contract_employee_id) THEN
      RAISE EXCEPTION 'Contract employee_id % references non-existent user', contract_employee_id;
    END IF;
  ELSE
    -- FALLBACK: If employee_id is NULL (shouldn't happen, but handle gracefully)
    -- Try to find user by email from contract
    IF contract_employee_email IS NOT NULL THEN
      SELECT id INTO user_id_result
      FROM public.users
      WHERE email = LOWER(TRIM(contract_employee_email))
      LIMIT 1;
    END IF;
    
    -- If still not found, this is an error - employee should have been created when contract was sent
    IF user_id_result IS NULL THEN
      RAISE EXCEPTION 'Cannot find user for contract. Contract ID: %, Employee ID: %, Employee Email: %. Employee should have been created when contract was sent.', 
        contract_id, contract_employee_id, contract_employee_email;
    END IF;
  END IF;
  
  -- Get business_id (from parameter or contract)
  final_business_id := COALESCE(p_business_id, contract_business_id);
  
  -- CRITICAL: If business_id is NULL, we can't create business_users entry - this will cause portal access to fail
  IF final_business_id IS NULL THEN
    RAISE EXCEPTION 'Cannot determine business_id. p_business_id=%, contract_business_id=%, contract_id=%. Either provide p_business_id parameter or ensure contract has business_id set.', 
      p_business_id, contract_business_id, contract_id;
  END IF;
  
  -- Update user with all personal info (user_id_result is guaranteed to be set at this point)
  -- NOTE: SIN is NOT saved here - it should be encrypted and saved to employee_sin_numbers table via the frontend
  UPDATE public.users
  SET
    email = COALESCE(LOWER(TRIM(p_email)), email),
    first_name = COALESCE(TRIM(p_first_name), first_name),
    last_name = COALESCE(TRIM(p_last_name), last_name),
    full_name = COALESCE(TRIM(p_first_name) || ' ' || TRIM(p_last_name), full_name),
    -- SIN removed: sin and sin_number should NOT be saved to users table (security risk)
    -- SIN must be encrypted and saved to employee_sin_numbers table via frontend
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
  
  -- Ensure user_roles entry exists
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
  
  -- Ensure business_users entry exists (required for portal access)
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
  
  -- Update contract to mark personal info as submitted
  IF contract_id IS NOT NULL THEN
    UPDATE public.hr_contracts
    SET
      personal_info_submitted_at = NOW(),
      employee_id = user_id_result -- Ensure it's set (should already be set, but just in case)
    WHERE id = contract_id;
  END IF;
  
  RETURN user_id_result;
END;
$$;

-- Grant execute to authenticated and anonymous users (form is accessed by unauthenticated users)
GRANT EXECUTE ON FUNCTION update_user_personal_info_complete(TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_user_personal_info_complete(TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO anon;

-- Force PostgREST to refresh schema cache
NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');
