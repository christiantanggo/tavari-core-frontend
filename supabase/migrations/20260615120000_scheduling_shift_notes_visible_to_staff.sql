-- Manager shift notes: optional visibility to staff (punch clock + employee portal after clock-in).
-- Managers always see full notes on timesheets / schedule regardless of this flag.

alter table public.scheduling_shifts
  add column if not exists notes_visible_to_staff boolean not null default false;

comment on column public.scheduling_shifts.notes_visible_to_staff is
  'When true, shift notes may be shown to employees on the punch clock (confirm clock-in) and employee portal immediately after clock-in.';
