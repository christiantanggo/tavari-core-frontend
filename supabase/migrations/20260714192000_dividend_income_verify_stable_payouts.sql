-- Requalify watchlist against ~36-month "same or higher, no skips" rule (as of mid-2026 research)

-- PASS: continuous flat monthly at current rate for 36+ months (or same-or-higher with no cuts/skips)
UPDATE public.div_instruments SET
  expected_monthly_dividend = 0.1257,
  pays_monthly = true,
  variable_distribution = false,
  stable_months = 36,
  disqualified_reason = NULL,
  notes = 'Class A $0.1257 monthly; appears continuous since early 2023',
  updated_at = now()
WHERE ticker = 'FTN';

UPDATE public.div_instruments SET
  expected_monthly_dividend = 0.10,
  pays_monthly = true,
  variable_distribution = false,
  stable_months = 36,
  disqualified_reason = NULL,
  notes = 'Class A $0.10 monthly; Brompton reports full years 2023–2025 at $0.10',
  updated_at = now()
WHERE ticker IN ('LBS', 'SBC');

UPDATE public.div_instruments SET
  expected_monthly_dividend = 0.075,
  pays_monthly = true,
  variable_distribution = false,
  stable_months = 36,
  disqualified_reason = NULL,
  notes = 'Class A $0.075 monthly continuous since Jan 2023 (paused earlier in 2022)',
  updated_at = now()
WHERE ticker = 'LCS';

UPDATE public.div_instruments SET
  expected_monthly_dividend = 0.10,
  pays_monthly = true,
  variable_distribution = false,
  stable_months = 36,
  disqualified_reason = NULL,
  notes = 'Class A monthly; raises Oct 2024 ($0.0667→$0.085) and Jan 2026 ($0.085→$0.10) — same-or-higher with no recent skips',
  updated_at = now()
WHERE ticker = 'PWI';

UPDATE public.div_instruments SET
  expected_monthly_dividend = 0.11335,
  pays_monthly = true,
  variable_distribution = false,
  stable_months = 36,
  disqualified_reason = NULL,
  notes = 'Class A currently $0.11335 (not $0.10); recent history looks continuous — still subject to NAV test',
  updated_at = now()
WHERE ticker = 'FFN';

-- FAIL / caution
UPDATE public.div_instruments SET
  expected_monthly_dividend = 0.10,
  pays_monthly = true,
  variable_distribution = false,
  stable_months = 18,
  disqualified_reason = 'Missed Class A months in 2023 when unit NAV ≤ $15 (e.g. Aug 2023); not a clean 36-month streak',
  notes = 'Paying $0.10 again now, but 2023 annual total was only $0.90',
  updated_at = now()
WHERE ticker = 'DFN';

UPDATE public.div_instruments SET
  expected_monthly_dividend = 0.10,
  pays_monthly = true,
  variable_distribution = false,
  stable_months = 30,
  disqualified_reason = 'Gaps in 2023 (e.g. May–Nov missing on public history before Dec 2023 resume)',
  notes = 'Continuous $0.10 since Dec 2023; target rate unchanged when paid',
  updated_at = now()
WHERE ticker = 'DGS';

UPDATE public.div_instruments SET
  expected_monthly_dividend = 0.10,
  pays_monthly = true,
  variable_distribution = false,
  stable_months = 6,
  disqualified_reason = 'Frequent Class A skips when unit NAV < $15; only ~3 months paid in 2025; Dec 2025 skipped',
  notes = 'Target $0.10 when paid — not reliable monthly income',
  updated_at = now()
WHERE ticker = 'ESP';

UPDATE public.div_instruments SET
  pays_monthly = false,
  stable_months = 0,
  expected_monthly_dividend = NULL,
  disqualified_reason = 'Class A (FTU) has no current monthly distributions; Preferred FTU.PR.B pays instead',
  updated_at = now()
WHERE ticker = 'FTU';

UPDATE public.div_instruments SET
  variable_distribution = true,
  stable_months = 0,
  expected_monthly_dividend = NULL,
  disqualified_reason = 'Variable distributions (tied to share price / NAV formula)',
  updated_at = now()
WHERE ticker = 'BK';

UPDATE public.div_instruments SET
  stable_months = 15,
  disqualified_reason = 'Inception Mar 2025 — under 24/36 month stability requirement',
  updated_at = now()
WHERE ticker = 'CLSA';

UPDATE public.div_instruments SET
  expected_monthly_dividend = NULL,
  stable_months = 12,
  disqualified_reason = 'Preferred ETF — confirm fixed monthly amount; different risk profile than Class A',
  updated_at = now()
WHERE ticker IN ('SPLT', 'PREF');

-- DF / GDV: keep provisional; GDV generally pays $0.10; DF needs deeper check
UPDATE public.div_instruments SET
  expected_monthly_dividend = 0.10,
  stable_months = 24,
  disqualified_reason = 'Needs full month-by-month audit; sister structure to DFN (NAV suspension risk)',
  notes = 'Provisional — verify SEDAR/Quadravest distribution history before treating as qualified',
  updated_at = now()
WHERE ticker = 'DF';

UPDATE public.div_instruments SET
  expected_monthly_dividend = 0.10,
  stable_months = 36,
  disqualified_reason = NULL,
  notes = 'Class A target $0.10; appears in monthly Brompton declarations — confirm no skips on full history',
  updated_at = now()
WHERE ticker = 'GDV';
