-- Optional phone number on co-parent profile (editable in Settings)

ALTER TABLE public.pullcoparent_profiles
  ADD COLUMN IF NOT EXISTS phone text;
