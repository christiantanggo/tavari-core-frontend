-- Persist manager_id when creating/updating employees from signed contracts.

DROP FUNCTION IF EXISTS create_employee_from_contract_rpc(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, NUMERIC, NUMERIC, TEXT, UUID
);

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
  p_manager_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
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
  IF p_manager_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.business_users
      WHERE user_id = p_manager_id
        AND business_id = p_business_id
        AND role IN ('owner', 'admin', 'manager')
    ) THEN
      RAISE EXCEPTION 'manager_id is not a valid manager for this business';
    END IF;
  END IF;

  SELECT id INTO existing_user_id
  FROM public.users
  WHERE email = LOWER(TRIM(p_employee_email))
  LIMIT 1;

  IF existing_user_id IS NOT NULL THEN
    user_id_result := existing_user_id;

    IF p_manager_id IS NOT NULL AND p_manager_id = user_id_result THEN
      RAISE EXCEPTION 'employee cannot be their own manager';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = user_id_result
        AND business_id = p_business_id
    ) THEN
      INSERT INTO public.user_roles (user_id, business_id, role, active)
      VALUES (user_id_result, p_business_id, 'employee', true);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.business_users
      WHERE user_id = user_id_result
        AND business_id = p_business_id
    ) THEN
      INSERT INTO public.business_users (user_id, business_id, role)
      VALUES (user_id_result, p_business_id, 'employee');
    END IF;

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
      manager_id = COALESCE(p_manager_id, manager_id),
      roles = ARRAY['employee']::TEXT[],
      status = 'active'
    WHERE id = user_id_result;

    RETURN user_id_result;
  END IF;

  IF p_user_id IS NOT NULL THEN
    IF p_manager_id IS NOT NULL AND p_manager_id = p_user_id THEN
      RAISE EXCEPTION 'employee cannot be their own manager';
    END IF;

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
      manager_id,
      roles,
      status
    ) VALUES (
      p_user_id,
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
      p_manager_id,
      ARRAY['employee']::TEXT[],
      'active'
    )
    RETURNING id INTO user_id_result;
  ELSE
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
      manager_id,
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
      p_manager_id,
      ARRAY['employee']::TEXT[],
      'active'
    )
    RETURNING id INTO user_id_result;
  END IF;

  INSERT INTO public.user_roles (user_id, business_id, role, active)
  VALUES (user_id_result, p_business_id, 'employee', true);

  INSERT INTO public.business_users (user_id, business_id, role)
  VALUES (user_id_result, p_business_id, 'employee');

  RETURN user_id_result;
END;
$$;

GRANT EXECUTE ON FUNCTION create_employee_from_contract_rpc(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, NUMERIC, NUMERIC, TEXT, UUID, UUID
) TO authenticated;

NOTIFY pgrst, 'reload schema';
