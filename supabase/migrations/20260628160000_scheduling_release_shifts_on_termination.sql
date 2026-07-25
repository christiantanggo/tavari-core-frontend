-- When an employee is terminated at a business, release their future assigned shifts as open shifts.

alter table public.scheduling_shifts
  alter column employee_id drop not null;

create or replace function public.scheduling_release_employee_shifts(
  p_business_id uuid,
  p_employee_id uuid,
  p_from_date date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff date := coalesce(p_from_date, current_date);
  v_count integer;
begin
  if p_business_id is null or p_employee_id is null then
    return 0;
  end if;

  update public.scheduling_shifts s
  set
    employee_id = null,
    is_open_shift = true,
    is_published = false,
    updated_at = now()
  where s.business_id = p_business_id
    and s.employee_id = p_employee_id
    and s.shift_date >= v_cutoff;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.scheduling_release_employee_shifts(uuid, uuid, date) is
  'Unassigns an employee from shifts on/after p_from_date and marks them open (unpublished).';

create or replace function public.business_users_release_shifts_on_termination()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff date;
begin
  if coalesce(lower(trim(new.employment_status)), '') <> 'terminated' then
    return new;
  end if;

  if coalesce(lower(trim(new.role)), '') in ('owner', 'admin', 'manager') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and coalesce(lower(trim(old.employment_status)), '') = 'terminated'
     and new.termination_date is not distinct from old.termination_date
     and new.employment_status is not distinct from old.employment_status then
    return new;
  end if;

  v_cutoff := coalesce(new.termination_date, current_date);
  perform public.scheduling_release_employee_shifts(new.business_id, new.user_id, v_cutoff);

  return new;
end;
$$;

drop trigger if exists business_users_release_shifts_on_termination on public.business_users;

create trigger business_users_release_shifts_on_termination
  after insert or update of employment_status, termination_date
  on public.business_users
  for each row
  execute function public.business_users_release_shifts_on_termination();

-- Backfill: release shifts for employees already marked terminated.
do $$
declare
  r record;
begin
  for r in
    select bu.business_id, bu.user_id, coalesce(bu.termination_date, current_date) as cutoff
    from public.business_users bu
    where coalesce(lower(trim(bu.employment_status)), '') = 'terminated'
      and coalesce(lower(trim(bu.role)), '') not in ('owner', 'admin', 'manager')
  loop
    perform public.scheduling_release_employee_shifts(r.business_id, r.user_id, r.cutoff);
  end loop;
end;
$$;

-- Punch clock kiosk: use per-business employment on business_users, not global users.employment_status.
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
        or (bu.termination_date is not null and bu.termination_date >= p_week_start)
      )
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
