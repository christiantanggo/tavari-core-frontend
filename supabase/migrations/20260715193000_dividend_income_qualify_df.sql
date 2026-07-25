-- DF was held out with a provisional manual disqualify flag despite a 24-month streak.
-- Clear that flag so the streak-based qualification path can approve it.

UPDATE public.div_instruments
SET
  disqualified_reason = NULL,
  notes = 'Class A monthly target $0.10. Recent streak meets 24 months; public history shows earlier skips (e.g. mid-2024 and 2022-2023 gap). Same NAV unit-threshold suspension risk as sister funds.',
  updated_at = now()
WHERE ticker = 'DF';
