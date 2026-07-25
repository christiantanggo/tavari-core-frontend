CREATE TABLE IF NOT EXISTS public.mailbox_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.mailbox_folders
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.received_emails
  ADD COLUMN IF NOT EXISTS mailbox_folder_id UUID REFERENCES public.mailbox_folders(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_folders_business_lower_name
  ON public.mailbox_folders (business_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_mailbox_folders_business_sort
  ON public.mailbox_folders (business_id, sort_order, name);

CREATE INDEX IF NOT EXISTS idx_received_emails_mailbox_folder_id
  ON public.received_emails (mailbox_folder_id);

CREATE OR REPLACE FUNCTION public.update_mailbox_folders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mailbox_folders_updated_at ON public.mailbox_folders;
CREATE TRIGGER trg_mailbox_folders_updated_at
BEFORE UPDATE ON public.mailbox_folders
FOR EACH ROW
EXECUTE FUNCTION public.update_mailbox_folders_updated_at();

ALTER TABLE public.mailbox_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view mailbox folders for their business" ON public.mailbox_folders;
CREATE POLICY "Users can view mailbox folders for their business"
  ON public.mailbox_folders FOR SELECT
  USING (
    business_id IN (SELECT business_id FROM public.business_users WHERE user_id = auth.uid())
    OR business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can create mailbox folders for their business" ON public.mailbox_folders;
CREATE POLICY "Users can create mailbox folders for their business"
  ON public.mailbox_folders FOR INSERT
  WITH CHECK (
    business_id IN (SELECT business_id FROM public.business_users WHERE user_id = auth.uid())
    OR business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can update mailbox folders for their business" ON public.mailbox_folders;
CREATE POLICY "Users can update mailbox folders for their business"
  ON public.mailbox_folders FOR UPDATE
  USING (
    business_id IN (SELECT business_id FROM public.business_users WHERE user_id = auth.uid())
    OR business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid())
  )
  WITH CHECK (
    business_id IN (SELECT business_id FROM public.business_users WHERE user_id = auth.uid())
    OR business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can delete mailbox folders for their business" ON public.mailbox_folders;
CREATE POLICY "Users can delete mailbox folders for their business"
  ON public.mailbox_folders FOR DELETE
  USING (
    business_id IN (SELECT business_id FROM public.business_users WHERE user_id = auth.uid())
    OR business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid())
  );

COMMENT ON TABLE public.mailbox_folders IS 'Custom folders for Tavari Inbox messages.';
COMMENT ON COLUMN public.received_emails.mailbox_folder_id IS 'Custom mailbox folder assignment for received messages.';
