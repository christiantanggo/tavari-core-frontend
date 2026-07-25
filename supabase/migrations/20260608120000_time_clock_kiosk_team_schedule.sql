-- Punch clock "Week schedule" runs as anon (no dashboard JWT).
-- Kiosk is bound to a business_id: return the same week schedule data managers see (all shifts, not only published).

CREATE OR REPLACE FUNCTION public.time_clock_kiosk_fetch_team_schedule(
  p_business_id uuid,
  p_week_start date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_end date;
  v_employees jsonb;
  v_shifts jsonb;
  v_events jsonb;
  v_operating_hours jsonb;
  v_holiday_hours jsonb;
  v_positions jsonb;
  v_scheduling_settings jsonb;
BEGIN
  IF p_business_id IS NULL OR p_week_start IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_arguments');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = p_business_id) THEN
    RETURN jsonb_build_object('error', 'business_not_found');
  END IF;

  v_week_end := p_week_start + 6;

  WITH member_ids AS (
    SELECT DISTINCT u.id
    FROM public.users u
    WHERE COALESCE(lower(u.employment_status), '') <> 'terminated'
      AND (
        u.business_id = p_business_id
        OR EXISTS (
          SELECT 1
          FROM public.business_users bu
          WHERE bu.user_id = u.id
            AND bu.business_id = p_business_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.user_roles ur
          WHERE ur.user_id = u.id
            AND ur.business_id = p_business_id
            AND ur.active IS TRUE
        )
      )
  ),
  merged AS (
    SELECT
      u.id,
      u.full_name,
      COALESCE(u.wage, 0) AS wage,
      u.position,
      bu.employee_order,
      u.hire_date,
      COALESCE(u.lieu_time_enabled, false) AS lieu_time_enabled,
      COALESCE(u.lieu_time_balance, 0) AS lieu_time_balance,
      u.max_paid_hours_per_period
    FROM member_ids m
    JOIN public.users u ON u.id = m.id
    LEFT JOIN public.business_users bu
      ON bu.user_id = u.id
     AND bu.business_id = p_business_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'full_name', m.full_name,
        'wage', m.wage,
        'position', m.position,
        'order', m.employee_order,
        'maxHours', m.max_paid_hours_per_period,
        'hireDate', m.hire_date,
        'lieuTimeEnabled', m.lieu_time_enabled,
        'lieuTimeBalance', m.lieu_time_balance
      )
      ORDER BY
        CASE WHEN m.employee_order IS NOT NULL THEN 0 ELSE 1 END,
        m.employee_order NULLS LAST,
        m.hire_date NULLS LAST,
        m.full_name
    ),
    '[]'::jsonb
  )
  INTO v_employees
  FROM merged m;

  SELECT COALESCE(
    jsonb_agg(to_jsonb(s) ORDER BY s.shift_date, s.start_time),
    '[]'::jsonb
  )
  INTO v_shifts
  FROM public.scheduling_shifts s
  WHERE s.business_id = p_business_id
    AND s.shift_date >= p_week_start
    AND s.shift_date <= v_week_end;

  SELECT COALESCE(
    jsonb_agg(to_jsonb(e) ORDER BY e.event_date, e.start_time),
    '[]'::jsonb
  )
  INTO v_events
  FROM public.scheduling_events e
  WHERE e.business_id = p_business_id
    AND e.event_date >= p_week_start
    AND e.event_date <= v_week_end;

  SELECT b.operating_hours, COALESCE(b.holiday_hours, '[]'::jsonb)
  INTO v_operating_hours, v_holiday_hours
  FROM public.businesses b
  WHERE b.id = p_business_id;

  SELECT COALESCE(
    jsonb_agg(to_jsonb(p) ORDER BY p.display_order NULLS LAST, p.position_name),
    '[]'::jsonb
  )
  INTO v_positions
  FROM public.positions p
  WHERE p.business_id = p_business_id
    AND COALESCE(p.is_active, true) = true;

  SELECT to_jsonb(ss)
  INTO v_scheduling_settings
  FROM public.scheduling_settings ss
  WHERE ss.business_id = p_business_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'employees', COALESCE(v_employees, '[]'::jsonb),
    'shifts', COALESCE(v_shifts, '[]'::jsonb),
    'events', COALESCE(v_events, '[]'::jsonb),
    'operating_hours', v_operating_hours,
    'holiday_hours', COALESCE(v_holiday_hours, '[]'::jsonb),
    'positions', COALESCE(v_positions, '[]'::jsonb),
    'scheduling_settings', v_scheduling_settings
  );
END;
$$;

REVOKE ALL ON FUNCTION public.time_clock_kiosk_fetch_team_schedule(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_fetch_team_schedule(uuid, date) TO anon;
GRANT EXECUTE ON FUNCTION public.time_clock_kiosk_fetch_team_schedule(uuid, date) TO authenticated;

COMMENT ON FUNCTION public.time_clock_kiosk_fetch_team_schedule(uuid, date) IS
  'Returns full team schedule for a business-bound punch clock kiosk (anon-safe; all shifts for the week).';
