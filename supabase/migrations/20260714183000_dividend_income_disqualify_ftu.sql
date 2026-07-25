-- FTU Class A is not currently paying monthly distributions (Preferred FTU.PR.B only).
-- https://www.quadravest.com/ftu-distributions

UPDATE public.div_instruments
SET
  expected_monthly_dividend = NULL,
  pays_monthly = false,
  stable_months = 0,
  variable_distribution = false,
  disqualified_reason = 'Class A (FTU) has no current monthly distributions; Preferred FTU.PR.B pays instead',
  updated_at = now()
WHERE ticker = 'FTU';
