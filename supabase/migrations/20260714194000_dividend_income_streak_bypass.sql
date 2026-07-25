-- Manual override: treat streak as acceptable for ranking despite stable_months / streak notes

ALTER TABLE public.div_instruments
  ADD COLUMN IF NOT EXISTS streak_bypass BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.div_instruments.streak_bypass IS
  'When true, skip streak/stable_months disqualification and include in Best Buy ranking if price + monthly div exist.';
