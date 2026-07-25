-- Optional shift premium for each position (see HR → Shift Premiums)
ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS shift_premium_id UUID REFERENCES public.hr_shift_premiums(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_positions_shift_premium_id ON public.positions(shift_premium_id);

COMMENT ON COLUMN public.positions.shift_premium_id IS 'Optional hr_shift_premiums row; use HR Shift Premiums tab to define rates.';
