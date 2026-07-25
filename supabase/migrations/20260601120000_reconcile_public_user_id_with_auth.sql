-- Reconcile split identity: public.users.id != auth.users.id
-- Updates all FK references then rekeys public.users.id to match auth.users.id

CREATE OR REPLACE FUNCTION reconcile_public_user_id_with_auth(
  p_old_user_id UUID,
  p_new_user_id UUID
)
RETURNS TABLE (
  step TEXT,
  detail TEXT,
  affected_rows BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_count BIGINT;
  v_old_email TEXT;
  v_new_email TEXT;
BEGIN
  IF p_old_user_id IS NULL OR p_new_user_id IS NULL THEN
    RAISE EXCEPTION 'Both old and new user IDs are required';
  END IF;

  IF p_old_user_id = p_new_user_id THEN
    RETURN QUERY SELECT 'noop'::TEXT, 'IDs already match'::TEXT, 0::BIGINT;
    RETURN;
  END IF;

  SELECT email INTO v_old_email FROM users WHERE id = p_old_user_id;
  IF v_old_email IS NULL THEN
    RAISE EXCEPTION 'Old user % not found in public.users', p_old_user_id;
  END IF;

  IF EXISTS (SELECT 1 FROM users WHERE id = p_new_user_id) THEN
    RAISE EXCEPTION 'New user % already exists in public.users; merge required instead of rekey', p_new_user_id;
  END IF;

  SELECT email INTO v_new_email FROM auth.users WHERE id = p_new_user_id;
  IF v_new_email IS NULL THEN
    RAISE EXCEPTION 'New user % not found in auth.users', p_new_user_id;
  END IF;

  IF lower(trim(v_old_email)) <> lower(trim(v_new_email)) THEN
    RAISE EXCEPTION 'Email mismatch: public.users=% auth.users=%', v_old_email, v_new_email;
  END IF;

  -- Free unique email/employee_number so we can clone the profile row under auth.users.id
  UPDATE users
  SET email = 'rekey-temp-' || p_old_user_id::text || '@internal.tavari.local',
      employee_number = NULL
  WHERE id = p_old_user_id;

  EXECUTE format(
    'INSERT INTO public.users (%s) SELECT %s FROM public.users WHERE id = $1',
    (SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'users'
       AND COALESCE(is_generated, 'NEVER') = 'NEVER'),
    (SELECT string_agg(
       CASE
         WHEN column_name = 'id' THEN quote_literal(p_new_user_id::text) || '::uuid'
         WHEN column_name = 'email' THEN quote_literal(v_old_email)
         ELSE quote_ident(column_name)
       END,
       ', ' ORDER BY ordinal_position)
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'users'
       AND COALESCE(is_generated, 'NEVER') = 'NEVER')
  ) USING p_old_user_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT 'public.users'::TEXT, 'insert_new_row'::TEXT, v_count;

  FOR r IN
    SELECT tc.table_schema, tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_schema = 'public'
      AND ccu.table_name = 'users'
      AND ccu.column_name = 'id'
      AND NOT (tc.table_schema = 'public' AND tc.table_name = 'users' AND kcu.column_name = 'id')
    ORDER BY tc.table_name, kcu.column_name
  LOOP
    EXECUTE format(
      'UPDATE %I.%I SET %I = $2 WHERE %I = $1',
      r.table_schema, r.table_name, r.column_name, r.column_name
    )
    USING p_old_user_id, p_new_user_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN
      RETURN QUERY SELECT
        format('%I.%I', r.table_schema, r.table_name)::TEXT,
        r.column_name::TEXT,
        v_count;
    END IF;
  END LOOP;

  DELETE FROM users WHERE id = p_old_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT 'public.users'::TEXT, 'delete_old_row'::TEXT, v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION reconcile_public_user_id_with_auth(UUID, UUID) TO service_role;

COMMENT ON FUNCTION reconcile_public_user_id_with_auth(UUID, UUID) IS
  'Rekeys public.users.id to auth.users.id and updates all FK references. Used when split identity blocks POS/auth lookups.';
