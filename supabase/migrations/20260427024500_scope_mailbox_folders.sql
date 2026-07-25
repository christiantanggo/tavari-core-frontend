ALTER TABLE public.mailbox_folders
  ADD COLUMN IF NOT EXISTS mailbox_id UUID REFERENCES public.mailboxes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS system_mailbox_address TEXT;

DROP INDEX IF EXISTS idx_mailbox_folders_business_lower_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_folders_business_mailbox_lower_name
  ON public.mailbox_folders (business_id, mailbox_id, lower(name))
  WHERE mailbox_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_folders_business_system_lower_name
  ON public.mailbox_folders (business_id, lower(system_mailbox_address), lower(name))
  WHERE system_mailbox_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mailbox_folders_business_mailbox_sort
  ON public.mailbox_folders (business_id, mailbox_id, sort_order, name)
  WHERE mailbox_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mailbox_folders_business_system_sort
  ON public.mailbox_folders (business_id, system_mailbox_address, sort_order, name)
  WHERE system_mailbox_address IS NOT NULL;

COMMENT ON COLUMN public.mailbox_folders.mailbox_id IS 'Mailbox this custom folder belongs to.';
COMMENT ON COLUMN public.mailbox_folders.system_mailbox_address IS 'System mailbox address this custom folder belongs to, such as noreply@tavarios.ca.';
