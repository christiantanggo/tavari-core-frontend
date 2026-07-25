-- Shift lead chain: management blocks key premiums; keys resolved by display_order among shift_lead_eligible positions
ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS is_management boolean NOT NULL DEFAULT false;

ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS shift_lead_eligible boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.positions.is_management IS 'When someone is scheduled/clocked as this position, counts as management on site for shift-lead rules.';
COMMENT ON COLUMN public.positions.shift_lead_eligible IS 'Eligible for shift-lead premium priority chain when no management is working those roles.';
