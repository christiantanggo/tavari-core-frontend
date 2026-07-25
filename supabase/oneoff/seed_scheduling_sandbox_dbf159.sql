-- Sandbox schedule + punches for business dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7
-- Times America/Toronto → EDT Jun 2026: local + clock UTC (+00).
-- Approve time sheets in UI for period 2026-06-09 .. 2026-06-13 (range tab).

-- Sophia Nguyen — weekday shifts + clocks (9:00–17:00 local, 30 min unpaid break → 7.5 paid hrs)

INSERT INTO public.scheduling_shifts (
  business_id, employee_id, shift_date, start_time, end_time,
  position, status, platform, break_duration_minutes, notes
)
VALUES
  ('dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7', '8c9e4b42-ef37-45d4-8656-5df869474805', '2026-06-09', '09:00:00', '17:00:00',
   'Customer Service', 'scheduled', 'tavari', 30, 'sandbox seed'),
  ('dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7', '8c9e4b42-ef37-45d4-8656-5df869474805', '2026-06-10', '09:00:00', '17:00:00',
   'Customer Service', 'scheduled', 'tavari', 30, 'sandbox seed'),
  ('dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7', '8c9e4b42-ef37-45d4-8656-5df869474805', '2026-06-11', '09:00:00', '17:00:00',
   'Customer Service', 'scheduled', 'tavari', 30, 'sandbox seed'),
  ('dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7', '8c9e4b42-ef37-45d4-8656-5df869474805', '2026-06-12', '09:00:00', '17:00:00',
   'Customer Service', 'scheduled', 'tavari', 30, 'sandbox seed'),
  ('dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7', '8c9e4b42-ef37-45d4-8656-5df869474805', '2026-06-13', '09:00:00', '17:00:00',
   'Customer Service', 'scheduled', 'tavari', 30, 'sandbox seed');

-- Noah Brooks — Tue + Thu (10:00–18:00 local)
INSERT INTO public.scheduling_shifts (
  business_id, employee_id, shift_date, start_time, end_time,
  position, status, platform, break_duration_minutes, notes
)
VALUES
  ('dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7', '8c9e4b42-ef37-45d4-8656-5df869474802', '2026-06-10', '10:00:00', '18:00:00',
   'Floor Staff', 'scheduled', 'tavari', 30, 'sandbox seed'),
  ('dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7', '8c9e4b42-ef37-45d4-8656-5df869474802', '2026-06-12', '10:00:00', '18:00:00',
   'Floor Staff', 'scheduled', 'tavari', 30, 'sandbox seed');

-- Completed punches (clock_in in UTC). Match scheduled windows.

INSERT INTO public.scheduling_time_clocks (
  business_id, employee_id, clock_in_time, clock_out_time,
  total_hours, break_duration_minutes, platform, notes
)
VALUES
  -- Sophia Mon Jun 9  09:00–17:00 Toronto → 13:00–21:00 UTC
  ('dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7', '8c9e4b42-ef37-45d4-8656-5df869474805',
   '2026-06-09 13:00:00+00', '2026-06-09 21:00:00+00', 7.5, 30, 'tavari', 'sandbox seed'),
  ('dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7', '8c9e4b42-ef37-45d4-8656-5df869474805',
   '2026-06-10 13:00:00+00', '2026-06-10 21:00:00+00', 7.5, 30, 'tavari', 'sandbox seed'),
  ('dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7', '8c9e4b42-ef37-45d4-8656-5df869474805',
   '2026-06-11 13:00:00+00', '2026-06-11 21:00:00+00', 7.5, 30, 'tavari', 'sandbox seed'),
  ('dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7', '8c9e4b42-ef37-45d4-8656-5df869474805',
   '2026-06-12 13:00:00+00', '2026-06-12 21:00:00+00', 7.5, 30, 'tavari', 'sandbox seed'),
  ('dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7', '8c9e4b42-ef37-45d4-8656-5df869474805',
   '2026-06-13 13:00:00+00', '2026-06-13 21:00:00+00', 7.5, 30, 'tavari', 'sandbox seed'),

  -- Noah Tue Jun 10 10–18 Toronto → 14:00–22:00 UTC
  ('dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7', '8c9e4b42-ef37-45d4-8656-5df869474802',
   '2026-06-10 14:00:00+00', '2026-06-10 22:00:00+00', 7.5, 30, 'tavari', 'sandbox seed'),
  -- Noah Thu Jun 12
  ('dbf159a7-48b0-4a44-9e56-51d0b6d0bfc7', '8c9e4b42-ef37-45d4-8656-5df869474802',
   '2026-06-12 14:00:00+00', '2026-06-12 22:00:00+00', 7.5, 30, 'tavari', 'sandbox seed');
