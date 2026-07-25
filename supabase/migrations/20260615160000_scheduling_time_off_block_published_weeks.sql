-- Block new time off requests for dates in schedule weeks that have been posted (published shifts exist).

create or replace function public.scheduling_schedule_week_start(p_date date)
returns date
language sql
immutable
as $$
  select p_date - extract(dow from p_date)::int;
$$;

comment on function public.scheduling_schedule_week_start(date) is
  'Sunday-based schedule week start (matches scheduling UI getScheduleWeekStart).';

create or replace function public.scheduling_check_time_off_eligible(
  p_business_id uuid,
  p_employee_id uuid,
  p_start_date date,
  p_end_date date,
  p_exclude_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_blackouts jsonb;
  v_max int;
  d date;
  v_cnt bigint;
  v_week_start date;
  v_week_end date;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'auth', 'message', 'Not authenticated');
  end if;

  if not (
    v_uid = p_employee_id
    or exists (
      select 1
      from public.business_users bu
      where bu.business_id = p_business_id
        and bu.user_id = v_uid
        and bu.role in ('owner', 'manager', 'admin', 'hr_admin')
    )
    or exists (
      select 1
      from public.user_roles ur
      where ur.business_id = p_business_id
        and ur.user_id = v_uid
        and ur.active = true
        and ur.role in ('owner', 'manager', 'admin')
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'You are not allowed to submit this time off request.');
  end if;

  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Invalid date range.');
  end if;

  select coalesce(ss.time_off_blackout_dates, '[]'::jsonb), ss.time_off_max_people_per_day
    into v_blackouts, v_max
  from public.scheduling_settings ss
  where ss.business_id = p_business_id;

  v_blackouts := coalesce(v_blackouts, '[]'::jsonb);

  d := p_start_date;
  while d <= p_end_date loop
    if exists (
      select 1
      from jsonb_array_elements_text(v_blackouts) as elem(val)
      where val = d::text
    ) then
      return jsonb_build_object(
        'ok', false,
        'code', 'blackout',
        'message', format('Time off cannot be requested on %s: this date is blocked for time off requests.', d),
        'blocked_date', d
      );
    end if;

    v_week_start := public.scheduling_schedule_week_start(d);
    v_week_end := v_week_start + 6;

    if exists (
      select 1
      from public.scheduling_shifts s
      where s.business_id = p_business_id
        and s.is_published is true
        and s.shift_date >= v_week_start
        and s.shift_date <= v_week_end
    ) then
      return jsonb_build_object(
        'ok', false,
        'code', 'schedule_published',
        'message', format(
          'Time off cannot be requested for %s: the schedule for %s through %s has already been posted.',
          to_char(d, 'Mon FMDD, YYYY'),
          to_char(v_week_start, 'Mon FMDD, YYYY'),
          to_char(v_week_end, 'Mon FMDD, YYYY')
        ),
        'blocked_date', d,
        'week_start', v_week_start,
        'week_end', v_week_end
      );
    end if;

    if v_max is not null and v_max >= 1 then
      with combined as (
        select distinct t.employee_id
        from public.scheduling_time_off t
        where t.business_id = p_business_id
          and t.status in ('pending', 'approved')
          and (p_exclude_request_id is null or t.id <> p_exclude_request_id)
          and t.start_date <= d
          and t.end_date >= d
        union
        select p_employee_id
      )
      select count(*) into v_cnt from combined;

      if v_cnt > v_max::bigint then
        return jsonb_build_object(
          'ok', false,
          'code', 'capacity',
          'message', format(
            'Time off cannot be requested: too many people are already off or have pending requests for %s (limit %s).',
            d,
            v_max
          ),
          'blocked_date', d
        );
      end if;
    end if;

    d := d + 1;
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.scheduling_check_time_off_eligible is
  'Returns {ok:true} or {ok:false,code,message,blocked_date?} for time off validation (blackouts, posted schedule weeks, per-day headcount).';

-- Internal validation for INSERT trigger (no auth check; RLS already governs who may insert).
create or replace function public.scheduling_validate_time_off_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  v_result := public.scheduling_check_time_off_eligible(
    new.business_id,
    new.employee_id,
    new.start_date,
    new.end_date,
    null
  );

  if coalesce((v_result ->> 'ok')::boolean, false) = false then
    raise exception '%', coalesce(v_result ->> 'message', 'Time off request is not allowed')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists scheduling_time_off_validate_insert on public.scheduling_time_off;

create trigger scheduling_time_off_validate_insert
  before insert on public.scheduling_time_off
  for each row
  execute function public.scheduling_validate_time_off_insert();
