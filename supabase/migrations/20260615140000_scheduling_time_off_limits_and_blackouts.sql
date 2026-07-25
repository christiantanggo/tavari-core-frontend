-- Time off policy: max distinct employees off per calendar day (pending + approved) and blackout dates.

alter table public.scheduling_settings
  add column if not exists time_off_max_people_per_day integer,
  add column if not exists time_off_blackout_dates jsonb not null default '[]'::jsonb;

comment on column public.scheduling_settings.time_off_max_people_per_day is
  'Maximum distinct employees who may have overlapping pending or approved time off on the same calendar day; NULL = no limit.';
comment on column public.scheduling_settings.time_off_blackout_dates is
  'JSON array of ISO dates (YYYY-MM-DD) when time off requests are not allowed.';

-- Eligibility check (SECURITY DEFINER): employees cannot read other employees time off under RLS, but must validate capacity.
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
  'Returns {ok:true} or {ok:false,code,message,blocked_date?} for time off validation (blackouts + per-day headcount).';

revoke all on function public.scheduling_check_time_off_eligible(uuid, uuid, date, date, uuid) from public;
grant execute on function public.scheduling_check_time_off_eligible(uuid, uuid, date, date, uuid) to authenticated;
