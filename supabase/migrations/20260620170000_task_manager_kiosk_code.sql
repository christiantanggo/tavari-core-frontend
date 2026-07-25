-- Short 6-digit kiosk codes for task-manager.tavarios.ca (replaces long ?business=uuid URLs)

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS task_manager_kiosk_code text;

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_task_manager_kiosk_code_chk;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_task_manager_kiosk_code_chk
  CHECK (task_manager_kiosk_code IS NULL OR task_manager_kiosk_code ~ '^[0-9]{6}$');

CREATE UNIQUE INDEX IF NOT EXISTS businesses_task_manager_kiosk_code_uidx
  ON public.businesses (task_manager_kiosk_code)
  WHERE task_manager_kiosk_code IS NOT NULL;

COMMENT ON COLUMN public.businesses.task_manager_kiosk_code IS
  'Persistent 6-digit code for task manager kiosk (?code=123456 on task-manager subdomain).';

CREATE OR REPLACE FUNCTION public.task_manager_ensure_kiosk_code(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_existing text;
  i int;
BEGIN
  IF NOT public.task_manager_is_business_manager(p_business_id) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT b.task_manager_kiosk_code INTO v_existing
  FROM public.businesses b
  WHERE b.id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'business not found';
  END IF;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'code', v_existing);
  END IF;

  FOR i IN 1..50 LOOP
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    BEGIN
      UPDATE public.businesses
      SET task_manager_kiosk_code = v_code
      WHERE id = p_business_id
        AND task_manager_kiosk_code IS NULL;
      IF FOUND THEN
        RETURN jsonb_build_object('ok', true, 'code', v_code);
      END IF;

      SELECT b.task_manager_kiosk_code INTO v_existing
      FROM public.businesses b
      WHERE b.id = p_business_id;
      IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'code', v_existing);
      END IF;
    EXCEPTION
      WHEN unique_violation THEN
        NULL;
    END;
  END LOOP;

  RAISE EXCEPTION 'could not allocate kiosk code';
END;
$$;

REVOKE ALL ON FUNCTION public.task_manager_ensure_kiosk_code(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.task_manager_ensure_kiosk_code(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.task_manager_resolve_kiosk_code(p_code text)
RETURNS TABLE (
  business_id uuid,
  business_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, COALESCE(b.name, 'Tavari Business')::text
  FROM public.businesses b
  WHERE b.task_manager_kiosk_code = regexp_replace(trim(COALESCE(p_code, '')), '\D', '', 'g')
    AND b.task_manager_kiosk_code IS NOT NULL
    AND length(regexp_replace(trim(COALESCE(p_code, '')), '\D', '', 'g')) = 6
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.task_manager_resolve_kiosk_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.task_manager_resolve_kiosk_code(text) TO anon, authenticated;
