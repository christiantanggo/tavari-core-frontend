alter table public.scheduling_shifts
  add column if not exists absence_reason text,
  add column if not exists absence_notes text,
  add column if not exists absence_recorded_by uuid references public.users(id),
  add column if not exists absence_recorded_at timestamp with time zone;

comment on column public.scheduling_shifts.absence_reason is 'Manager-selected reason when a scheduled employee is absent or does not clock in.';
comment on column public.scheduling_shifts.absence_notes is 'Optional manager notes for the absence reason.';
comment on column public.scheduling_shifts.absence_recorded_by is 'User who recorded the absence reason.';
comment on column public.scheduling_shifts.absence_recorded_at is 'Time the absence reason was recorded.';
