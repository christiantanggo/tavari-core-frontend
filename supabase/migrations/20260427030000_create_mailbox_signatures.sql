CREATE TABLE IF NOT EXISTS public.mailbox_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  html_content TEXT NOT NULL DEFAULT '',
  text_content TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  assigned_user_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  apply_mode TEXT NOT NULL DEFAULT 'all' CHECK (apply_mode IN ('all', 'new_only', 'replies_only', 'forwards_only', 'manual')),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_mailbox_signatures_business_id
  ON public.mailbox_signatures (business_id);

CREATE INDEX IF NOT EXISTS idx_mailbox_signatures_assigned_user_ids
  ON public.mailbox_signatures USING GIN (assigned_user_ids);

CREATE OR REPLACE FUNCTION public.update_mailbox_signatures_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mailbox_signatures_updated_at ON public.mailbox_signatures;
CREATE TRIGGER trg_mailbox_signatures_updated_at
BEFORE UPDATE ON public.mailbox_signatures
FOR EACH ROW
EXECUTE FUNCTION public.update_mailbox_signatures_updated_at();

ALTER TABLE public.mailbox_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view mailbox signatures for their business" ON public.mailbox_signatures;
CREATE POLICY "Users can view mailbox signatures for their business"
  ON public.mailbox_signatures FOR SELECT
  USING (
    business_id IN (SELECT business_id FROM public.business_users WHERE user_id = auth.uid())
    OR business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can manage mailbox signatures for their business" ON public.mailbox_signatures;
CREATE POLICY "Users can manage mailbox signatures for their business"
  ON public.mailbox_signatures FOR ALL
  USING (
    business_id IN (SELECT business_id FROM public.business_users WHERE user_id = auth.uid())
    OR business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid())
  )
  WITH CHECK (
    business_id IN (SELECT business_id FROM public.business_users WHERE user_id = auth.uid())
    OR business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid())
  );

COMMENT ON TABLE public.mailbox_signatures IS 'Reusable email signatures for Tavari Inbox mailbox sending.';
COMMENT ON COLUMN public.mailbox_signatures.assigned_user_ids IS 'Users this signature applies to. Empty means available as a default/fallback.';
COMMENT ON COLUMN public.mailbox_signatures.apply_mode IS 'When to apply the signature: all, new_only, replies_only, forwards_only, or manual.';
