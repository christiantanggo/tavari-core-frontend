CREATE INDEX IF NOT EXISTS idx_scheduling_time_clocks_active_employee_business
  ON public.scheduling_time_clocks (business_id, employee_id, clock_in_time DESC)
  WHERE clock_out_time IS NULL;

CREATE INDEX IF NOT EXISTS idx_scheduling_time_clocks_recent_clock_out
  ON public.scheduling_time_clocks (business_id, employee_id, clock_out_time DESC)
  WHERE clock_out_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scheduling_break_tracking_active_clock
  ON public.scheduling_break_tracking (time_clock_id)
  WHERE break_end_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_scheduling_break_tracking_active_employee_business
  ON public.scheduling_break_tracking (business_id, employee_id, time_clock_id)
  WHERE break_end_at IS NULL;
