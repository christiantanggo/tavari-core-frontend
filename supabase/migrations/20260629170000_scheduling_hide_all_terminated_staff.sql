-- Punch clock schedule: exclude all terminated staff (no week-based visibility).

create or replace function public.time_clock_kiosk_fetch_team_schedule(
  p_business_id uuid,
  p_week_start date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week_end date;
  v_employees jsonb;
  v_shifts jsonb;
  v_events jsonb;
  v_operating_hours jsonb;
  v_holiday_hours jsonb;
  v_positions jsonb;
  v_scheduling_settings jsonb;
begin
  if p_business_id is null or p_week_start is null then
    return jsonb_build_object('error', 'invalid_arguments');
  end if;

  if not exists (select 1 from public.businesses b where b.id = p_business_id) then
    return jsonb_build_object('error', 'business_not_found');
  end if;

  v_week_end := p_week_start + 6;

  with merged as (
    select
      u.id,
      u.full_name,
      coalesce(u.wage, 0) as wage,
      u.position,
      bu.employee_order,
      u.hire_date,
      coalesce(u.lieu_time_enabled, false) as lieu_time_enabled,
      coalesce(u.lieu_time_balance, 0) as lieu_time_balance,
      u.max_paid_hours_per_period
    from public.business_users bu
    join public.users u on u.id = bu.user_id
    where bu.business_id = p_business_id
      and (
        coalesce(lower(trim(bu.role)), '') in ('owner', 'admin', 'manager')
        or coalesce(lower(trim(bu.employment_status)), 'active') <> 'terminated'
      )
      and coalesce(lower(trim(u.employment_status)), 'active') <> 'terminated'
  )
  select coalesce(
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
      order by
        case when m.employee_order is not null then 0 else 1 end,
        m.employee_order nulls last,
        m.hire_date nulls last,
        m.full_name
    ),
    '[]'::jsonb
  )
  into v_employees
  from merged m;

  select coalesce(
    jsonb_agg(to_jsonb(s) order by s.shift_date, s.start_time),
    '[]'::jsonb
  )
  into v_shifts
  from public.scheduling_shifts s
  where s.business_id = p_business_id
    and s.shift_date >= p_week_start
    and s.shift_date <= v_week_end;

  select coalesce(
    jsonb_agg(to_jsonb(e) order by e.event_date, e.start_time),
    '[]'::jsonb
  )
  into v_events
  from public.scheduling_events e
  where e.business_id = p_business_id
    and e.event_date >= p_week_start
    and e.event_date <= v_week_end;

  select b.operating_hours, coalesce(b.holiday_hours, '[]'::jsonb)
  into v_operating_hours, v_holiday_hours
  from public.businesses b
  where b.id = p_business_id;

  select coalesce(
    jsonb_agg(to_jsonb(p) order by p.position_name),
    '[]'::jsonb
  )
  into v_positions
  from public.positions p
  where p.business_id = p_business_id
    and p.is_active is true;

  select to_jsonb(ss)
  into v_scheduling_settings
  from public.scheduling_settings ss
  where ss.business_id = p_business_id;

  return jsonb_build_object(
    'employees', coalesce(v_employees, '[]'::jsonb),
    'shifts', coalesce(v_shifts, '[]'::jsonb),
    'events', coalesce(v_events, '[]'::jsonb),
    'operatingHours', v_operating_hours,
    'holidayHours', coalesce(v_holiday_hours, '[]'::jsonb),
    'positions', coalesce(v_positions, '[]'::jsonb),
    'schedulingSettings', coalesce(v_scheduling_settings, '{}'::jsonb)
  );
end;
$$;
