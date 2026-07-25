-- Release only future schedule shifts on termination; keep shifts the employee already worked (timecard exists).

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

  -- Future schedule only: strictly after termination date.
  -- Never unassign a shift if the employee already clocked in for that calendar day.
  update public.scheduling_shifts s
  set
    employee_id = null,
    is_open_shift = true,
    is_published = false,
    updated_at = now()
  where s.business_id = p_business_id
    and s.employee_id = p_employee_id
    and s.shift_date > v_cutoff
    and not exists (
      select 1
      from public.scheduling_time_clocks tc
      where tc.business_id = s.business_id
        and tc.employee_id = s.employee_id
        and (tc.clock_in_time at time zone 'UTC')::date = s.shift_date
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.scheduling_release_employee_shifts(uuid, uuid, date) is
  'Unassigns an employee from future shifts (after termination date) and marks them open. Skips days with a timeclock.';

-- Restore open shifts that were previously released but the employee clocked in that day.
update public.scheduling_shifts s
set
  employee_id = tc.employee_id,
  is_open_shift = false,
  updated_at = now()
from public.scheduling_time_clocks tc
where s.business_id = tc.business_id
  and s.is_open_shift = true
  and s.employee_id is null
  and tc.employee_id is not null
  and (tc.clock_in_time at time zone 'UTC')::date = s.shift_date
  and exists (
    select 1
    from public.business_users bu
    where bu.business_id = s.business_id
      and bu.user_id = tc.employee_id
      and coalesce(lower(trim(bu.employment_status)), '') = 'terminated'
  )
  and not exists (
    select 1
    from public.scheduling_shifts s2
    where s2.business_id = s.business_id
      and s2.id <> s.id
      and s2.employee_id = tc.employee_id
      and s2.shift_date = s.shift_date
  );

-- Re-run release with corrected rules for already-terminated employees.
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
