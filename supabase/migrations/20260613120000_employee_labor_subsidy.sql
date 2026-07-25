-- Per-employee labor subsidy settings (manager dashboard reporting only — not payroll).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS labor_subsidy_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS labor_subsidy_partner TEXT,
  ADD COLUMN IF NOT EXISTS labor_subsidy_wage_cap NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS labor_subsidy_max_hours_per_week NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS labor_subsidy_start_date DATE,
  ADD COLUMN IF NOT EXISTS labor_subsidy_end_date DATE;

COMMENT ON COLUMN public.users.labor_subsidy_enabled IS
  'When true, manager dashboard labor % can exclude subsidized base wage (reporting only, not payroll).';
COMMENT ON COLUMN public.users.labor_subsidy_partner IS
  'Subsidy partner label, e.g. YMCA.';
COMMENT ON COLUMN public.users.labor_subsidy_wage_cap IS
  'Hourly base wage amount covered by subsidy (premiums above this cap still count toward labor).';
COMMENT ON COLUMN public.users.labor_subsidy_max_hours_per_week IS
  'Max subsidized hours per Sun–Sat week.';
COMMENT ON COLUMN public.users.labor_subsidy_start_date IS
  'First date subsidy applies (inclusive).';
COMMENT ON COLUMN public.users.labor_subsidy_end_date IS
  'Last date subsidy applies (inclusive).';
