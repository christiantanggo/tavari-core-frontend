-- Create SECURITY DEFINER function to create employees from contracts
-- This bypasses RLS so HR managers can create employee records

CREATE OR REPLACE FUNCTION create_employee_from_contract_rpc(
  p_business_id UUID,
  p_employee_email TEXT,
  p_employee_first_name TEXT,
  p_employee_last_name TEXT,
  p_employee_address TEXT DEFAULT NULL,
  p_position_title TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_hire_date DATE DEFAULT NULL,
  p_employment_status TEXT DEFAULT 'active',
  p_wage NUMERIC DEFAULT NULL,
  p_vacation_percent NUMERIC DEFAULT NULL,
  p_department TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL  -- Optional: if provided, use this ID (from auth.users) instead of generating a new one
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_id_result UUID;
  existing_user_id UUID;
BEGIN
  -- Check if user already exists
  SELECT id INTO existing_user_id
  FROM public.users
  WHERE email = LOWER(TRIM(p_employee_email))
  LIMIT 1;
  
  IF existing_user_id IS NOT NULL THEN
    -- User exists, just link them to business
    user_id_result := existing_user_id;
    
    -- Create user_roles entry if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = user_id_result
      AND business_id = p_business_id
    ) THEN
      INSERT INTO public.user_roles (
        user_id,
        business_id,
        role,
        active
      ) VALUES (
        user_id_result,
        p_business_id,
        'employee',
        true
      );
    END IF;
    
    -- Create business_users entry if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM public.business_users
      WHERE user_id = user_id_result
      AND business_id = p_business_id
    ) THEN
      INSERT INTO public.business_users (
        user_id,
        business_id,
        role
      ) VALUES (
        user_id_result,
        p_business_id,
        'employee'
      );
    END IF;
    
    -- Update user with contract data
    UPDATE public.users
    SET
      first_name = COALESCE(TRIM(p_employee_first_name), first_name),
      last_name = COALESCE(TRIM(p_employee_last_name), last_name),
      full_name = COALESCE(TRIM(p_employee_first_name) || ' ' || TRIM(p_employee_last_name), full_name),
      address_line1 = COALESCE(p_employee_address, address_line1),
      position = COALESCE(p_position_title, position),
      phone = COALESCE(p_phone, phone),
      hire_date = COALESCE(p_hire_date, hire_date),
      employment_status = COALESCE(p_employment_status, employment_status),
      wage = COALESCE(p_wage, wage),
      vacation_percent = COALESCE(p_vacation_percent, vacation_percent),
      department = COALESCE(p_department, department),
      roles = ARRAY['employee']::TEXT[],
      status = 'active'
    WHERE id = user_id_result;
    
    RETURN user_id_result;
  END IF;
  
  -- Create new user
  -- If p_user_id is provided (from auth.users), use it so public.users.id == auth.users.id
  IF p_user_id IS NOT NULL THEN
    INSERT INTO public.users (
      id,
      email,
      first_name,
      last_name,
      full_name,
      address_line1,
      position,
      phone,
      hire_date,
      employment_status,
      wage,
      vacation_percent,
      department,
      roles,
      status
    ) VALUES (
      p_user_id,  -- Use auth.users.id so they match!
      LOWER(TRIM(p_employee_email)),
      TRIM(p_employee_first_name),
      TRIM(p_employee_last_name),
      TRIM(p_employee_first_name) || ' ' || TRIM(p_employee_last_name),
      p_employee_address,
      p_position_title,
      p_phone,
      p_hire_date,
      p_employment_status,
      p_wage,
      p_vacation_percent,
      p_department,
      ARRAY['employee']::TEXT[],
      'active'
    )
    RETURNING id INTO user_id_result;
  ELSE
    -- No user_id provided, generate new one (legacy behavior)
    INSERT INTO public.users (
      email,
      first_name,
      last_name,
      full_name,
      address_line1,
      position,
      phone,
      hire_date,
      employment_status,
      wage,
      vacation_percent,
      department,
      roles,
      status
    ) VALUES (
      LOWER(TRIM(p_employee_email)),
      TRIM(p_employee_first_name),
      TRIM(p_employee_last_name),
      TRIM(p_employee_first_name) || ' ' || TRIM(p_employee_last_name),
      p_employee_address,
      p_position_title,
      p_phone,
      p_hire_date,
      p_employment_status,
      p_wage,
      p_vacation_percent,
      p_department,
      ARRAY['employee']::TEXT[],
      'active'
    )
    RETURNING id INTO user_id_result;
  END IF;
  
  -- Create user_roles entry
  INSERT INTO public.user_roles (
    user_id,
    business_id,
    role,
    active
  ) VALUES (
    user_id_result,
    p_business_id,
    'employee',
    true
  );
  
  -- Create business_users entry (required for portal access)
  INSERT INTO public.business_users (
    user_id,
    business_id,
    role
  ) VALUES (
    user_id_result,
    p_business_id,
    'employee'
  );
  
  RETURN user_id_result;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION create_employee_from_contract_rpc(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, NUMERIC, NUMERIC, TEXT, UUID) TO authenticated;

-- Force PostgREST to refresh schema cache
NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

