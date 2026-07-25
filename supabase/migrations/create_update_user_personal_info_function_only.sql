-- CREATE UPDATE FUNCTION ONLY - No GRANT or COMMENT to avoid errors
-- Run this first, then run the full migration

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
    personal_info_token = NULL,
    updated_at = NOW()
  WHERE id = user_id_result;
  
  RETURN user_id_result;
END;
$$;

-- Now grant permissions
GRANT EXECUTE ON FUNCTION update_user_personal_info(TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO public;












