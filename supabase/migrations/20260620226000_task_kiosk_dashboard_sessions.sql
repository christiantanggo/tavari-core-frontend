-- Task kiosk → dashboard module links (e.g. daily deposit) without full Supabase login.
-- Mirrors time_clock_kiosk_sessions: PIN-verified short-lived token for SECURITY DEFINER RPCs.

CREATE TABLE IF NOT EXISTS public.task_kiosk_dashboard_sessions (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.task_manager_tasks(id) ON DELETE SET NULL,
  module_link_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '4 hours')
);

CREATE INDEX IF NOT EXISTS idx_task_kiosk_dashboard_sessions_expires
  ON public.task_kiosk_dashboard_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_task_kiosk_dashboard_sessions_business_employee
  ON public.task_kiosk_dashboard_sessions (business_id, employee_id);

ALTER TABLE public.task_kiosk_dashboard_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.task_kiosk_dashboard_sessions FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.task_kiosk_dashboard_purge_expired()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.task_kiosk_dashboard_sessions WHERE expires_at <= now();
$$;

CREATE OR REPLACE FUNCTION public.task_kiosk_dashboard_assert_session(
  p_token uuid,
  p_business_id uuid,
  p_employee_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_token IS NULL OR p_business_id IS NULL OR p_employee_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM public.task_kiosk_dashboard_purge_expired();

  RETURN EXISTS (
    SELECT 1
    FROM public.task_kiosk_dashboard_sessions s
    WHERE s.token = p_token
      AND s.business_id = p_business_id
      AND s.employee_id = p_employee_id
      AND s.expires_at > now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.task_kiosk_dashboard_open_session(
  p_business_id uuid,
  p_employee_id uuid,
  p_pin text,
  p_task_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_verified uuid;
  v_task record;
  v_token uuid;
BEGIN
  PERFORM public.task_kiosk_dashboard_purge_expired();

  SELECT v.employee_id INTO v_verified
  FROM public.task_manager_verify_pin(p_business_id, p_pin) v
  WHERE v.employee_id = p_employee_id
  LIMIT 1;

  IF v_verified IS NULL THEN
    RAISE EXCEPTION 'Invalid PIN';
  END IF;

  SELECT t.id, t.module_link_key, t.business_id
  INTO v_task
  FROM public.task_manager_tasks t
  WHERE t.id = p_task_id
    AND t.business_id = p_business_id;

  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  IF v_task.module_link_key IS NULL OR length(trim(v_task.module_link_key)) = 0 THEN
    RAISE EXCEPTION 'Task has no module link';
  END IF;

  IF NOT public.task_manager_module_link_allowed(p_business_id, p_employee_id, v_task.module_link_key) THEN
    RAISE EXCEPTION 'Not allowed to open this module link';
  END IF;

  INSERT INTO public.task_kiosk_dashboard_sessions (
    business_id,
    employee_id,
    task_id,
    module_link_key,
    expires_at
  )
  VALUES (
    p_business_id,
    p_employee_id,
    p_task_id,
    v_task.module_link_key,
    now() + interval '4 hours'
  )
  RETURNING token INTO v_token;

  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.task_kiosk_employee_permissions(
  p_token uuid,
  p_business_id uuid,
  p_employee_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_permissions jsonb;
BEGIN
  IF NOT public.task_kiosk_dashboard_assert_session(p_token, p_business_id, p_employee_id) THEN
    RAISE EXCEPTION 'Invalid or expired task kiosk session';
  END IF;

  v_role := public.user_business_role(p_business_id, p_employee_id);

  SELECT COALESCE(jsonb_agg(rp.permission_key ORDER BY rp.permission_key), '[]'::jsonb)
  INTO v_permissions
  FROM public.role_permissions rp
  WHERE rp.business_id = p_business_id
    AND rp.role_key = v_role
    AND rp.granted IS TRUE;

  IF v_role = 'owner' THEN
    v_permissions := '["*"]'::jsonb;
  ELSIF v_role = 'admin' THEN
    SELECT COALESCE(jsonb_agg(DISTINCT rp.permission_key ORDER BY rp.permission_key), '[]'::jsonb)
    INTO v_permissions
    FROM public.role_permissions rp
    WHERE rp.business_id = p_business_id
      AND rp.granted IS TRUE
      AND rp.permission_key NOT LIKE 'owner.%';
  END IF;

  RETURN jsonb_build_object(
    'role', v_role,
    'permissions', v_permissions
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.task_kiosk_pos_daily_deposit_context(
  p_token uuid,
  p_business_id uuid,
  p_employee_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings jsonb;
  v_stations jsonb;
BEGIN
  IF NOT public.task_kiosk_dashboard_assert_session(p_token, p_business_id, p_employee_id) THEN
    RAISE EXCEPTION 'Invalid or expired task kiosk session';
  END IF;

  IF NOT public.user_has_any_business_permission(
    p_business_id,
    p_employee_id,
    ARRAY[
      'pos.daily_deposit.view',
      'pos.daily_deposit.edit',
      'pos.daily_deposit.create',
      'pos.deposits.view',
      'pos.deposits.create'
    ]
  ) THEN
    RAISE EXCEPTION 'Employee does not have daily deposit permission';
  END IF;

  SELECT to_jsonb(ps.*)
  INTO v_settings
  FROM public.pos_settings ps
  WHERE ps.business_id = p_business_id
    AND ps.terminal_id IS NULL
  ORDER BY ps.updated_at DESC NULLS LAST
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(to_jsonb(t.*) ORDER BY t.sort_order NULLS LAST, t.terminal_name), '[]'::jsonb)
  INTO v_stations
  FROM public.pos_terminals t
  WHERE t.business_id = p_business_id
    AND t.is_active IS TRUE;

  RETURN jsonb_build_object(
    'settings', COALESCE(v_settings, '{}'::jsonb),
    'stations', COALESCE(v_stations, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.task_kiosk_pos_daily_deposit_station_data(
  p_token uuid,
  p_business_id uuid,
  p_employee_id uuid,
  p_terminal_id text,
  p_deposit_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_totals jsonb;
  v_refunds jsonb;
  v_sale_ids uuid[];
BEGIN
  IF NOT public.task_kiosk_dashboard_assert_session(p_token, p_business_id, p_employee_id) THEN
    RAISE EXCEPTION 'Invalid or expired task kiosk session';
  END IF;

  IF p_terminal_id IS NULL OR length(trim(p_terminal_id)) = 0 THEN
    RETURN jsonb_build_object(
      'totals', jsonb_build_object('cash', 0, 'card', 0, 'gift_card', 0, 'check', 0, 'other', 0),
      'refunds', '[]'::jsonb
    );
  END IF;

  v_day_start := (p_deposit_date::text || 'T00:00:00.000Z')::timestamptz;
  v_day_end := (p_deposit_date::text || 'T23:59:59.999Z')::timestamptz;

  SELECT array_agg(s.id)
  INTO v_sale_ids
  FROM public.pos_sales s
  WHERE s.business_id = p_business_id
    AND s.terminal_id = p_terminal_id
    AND s.created_at >= v_day_start
    AND s.created_at <= v_day_end;

  SELECT jsonb_build_object(
    'cash', COALESCE(SUM(CASE WHEN p.payment_method = 'cash' THEN p.amount ELSE 0 END), 0),
    'card', COALESCE(SUM(CASE WHEN p.payment_method IN ('card', 'credit', 'debit', 'helcim') THEN p.amount ELSE 0 END), 0),
    'gift_card', COALESCE(SUM(CASE WHEN p.payment_method = 'gift_card' THEN p.amount ELSE 0 END), 0),
    'check', COALESCE(SUM(CASE WHEN p.payment_method = 'check' THEN p.amount ELSE 0 END), 0),
    'other', COALESCE(SUM(CASE WHEN p.payment_method NOT IN ('cash', 'card', 'credit', 'debit', 'helcim', 'gift_card', 'check') THEN p.amount ELSE 0 END), 0)
  )
  INTO v_totals
  FROM public.pos_payments p
  WHERE p.business_id = p_business_id
    AND (v_sale_ids IS NULL OR p.sale_id = ANY(v_sale_ids))
    AND p.created_at >= v_day_start
    AND p.created_at <= v_day_end;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'total_refund_amount', r.total_refund_amount,
        'refund_method', r.refund_method,
        'reason', r.reason,
        'created_at', r.created_at,
        'refunded_by', r.refunded_by,
        'original_sale_id', r.original_sale_id
      )
      ORDER BY r.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_refunds
  FROM public.pos_refunds r
  WHERE r.business_id = p_business_id
    AND (v_sale_ids IS NULL OR r.original_sale_id = ANY(v_sale_ids))
    AND r.created_at >= v_day_start
    AND r.created_at <= v_day_end;

  RETURN jsonb_build_object(
    'totals', COALESCE(v_totals, jsonb_build_object('cash', 0, 'card', 0, 'gift_card', 0, 'check', 0, 'other', 0)),
    'refunds', COALESCE(v_refunds, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.task_kiosk_validate_manager_pin(
  p_token uuid,
  p_business_id uuid,
  p_employee_id uuid,
  p_manager_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec record;
BEGIN
  IF NOT public.task_kiosk_dashboard_assert_session(p_token, p_business_id, p_employee_id) THEN
    RAISE EXCEPTION 'Invalid or expired task kiosk session';
  END IF;

  SELECT
    v.employee_id AS id,
    v.full_name,
    v.role
  INTO v_rec
  FROM public.task_manager_verify_pin(p_business_id, p_manager_pin) v
  LIMIT 1;

  IF v_rec.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_rec.role NOT IN ('manager', 'owner', 'admin') THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_rec.id,
    'full_name', v_rec.full_name,
    'role', v_rec.role
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.task_kiosk_pos_daily_deposit_save(
  p_token uuid,
  p_business_id uuid,
  p_employee_id uuid,
  p_deposit jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.task_kiosk_dashboard_assert_session(p_token, p_business_id, p_employee_id) THEN
    RAISE EXCEPTION 'Invalid or expired task kiosk session';
  END IF;

  IF NOT public.user_has_any_business_permission(
    p_business_id,
    p_employee_id,
    ARRAY['pos.daily_deposit.create', 'pos.daily_deposit.edit', 'pos.deposits.create']
  ) THEN
    RAISE EXCEPTION 'Employee does not have permission to save deposits';
  END IF;

  INSERT INTO public.pos_daily_deposits (
    business_id,
    terminal_id,
    deposit_date,
    expected_cash,
    expected_checks,
    expected_gift_cards,
    expected_total,
    counted_cash,
    counted_checks,
    counted_gift_cards,
    counted_total,
    variance_amount,
    variance_percentage,
    cash_breakdown,
    float_amount,
    refund_count,
    total_refunds,
    counted_by,
    verified_by,
    manager_override_required,
    notes,
    status,
    submitted_to_bank
  )
  VALUES (
    p_business_id,
    COALESCE(p_deposit->>'terminal_id', ''),
    COALESCE((p_deposit->>'deposit_date')::date, CURRENT_DATE),
    COALESCE((p_deposit->>'expected_cash')::numeric, 0),
    COALESCE((p_deposit->>'expected_checks')::numeric, 0),
    COALESCE((p_deposit->>'expected_gift_cards')::numeric, 0),
    COALESCE((p_deposit->>'expected_total')::numeric, 0),
    COALESCE((p_deposit->>'counted_cash')::numeric, 0),
    COALESCE((p_deposit->>'counted_checks')::numeric, 0),
    COALESCE((p_deposit->>'counted_gift_cards')::numeric, 0),
    COALESCE((p_deposit->>'counted_total')::numeric, 0),
    COALESCE((p_deposit->>'variance_amount')::numeric, 0),
    COALESCE((p_deposit->>'variance_percentage')::numeric, 0),
    COALESCE(p_deposit->'cash_breakdown', '{}'::jsonb),
    COALESCE((p_deposit->>'float_amount')::numeric, 0),
    COALESCE((p_deposit->>'refund_count')::integer, 0),
    COALESCE((p_deposit->>'total_refunds')::numeric, 0),
    p_employee_id,
    COALESCE((p_deposit->>'verified_by')::uuid, p_employee_id),
    COALESCE((p_deposit->>'manager_override_required')::boolean, false),
    NULLIF(p_deposit->>'notes', ''),
    COALESCE(NULLIF(p_deposit->>'status', ''), 'completed'),
    COALESCE((p_deposit->>'submitted_to_bank')::boolean, false)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.task_kiosk_dashboard_purge_expired() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_kiosk_dashboard_assert_session(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_kiosk_dashboard_open_session(uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_kiosk_employee_permissions(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_kiosk_pos_daily_deposit_context(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_kiosk_pos_daily_deposit_station_data(uuid, uuid, uuid, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_kiosk_validate_manager_pin(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_kiosk_pos_daily_deposit_save(uuid, uuid, uuid, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.task_kiosk_dashboard_open_session(uuid, uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_kiosk_employee_permissions(uuid, uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_kiosk_pos_daily_deposit_context(uuid, uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_kiosk_pos_daily_deposit_station_data(uuid, uuid, uuid, text, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_kiosk_validate_manager_pin(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_kiosk_pos_daily_deposit_save(uuid, uuid, uuid, jsonb) TO anon, authenticated;
