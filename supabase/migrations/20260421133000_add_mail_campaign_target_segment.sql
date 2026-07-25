ALTER TABLE public.mail_campaigns
  ADD COLUMN IF NOT EXISTS target_segment uuid REFERENCES public.mail_contact_segments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mail_campaigns_target_segment
  ON public.mail_campaigns(target_segment);
