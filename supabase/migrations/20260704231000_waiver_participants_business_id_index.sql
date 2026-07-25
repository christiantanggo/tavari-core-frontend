CREATE INDEX IF NOT EXISTS idx_waiver_participants_business_id
  ON public.waiver_participants (business_id)
  WHERE business_id IS NOT NULL;
