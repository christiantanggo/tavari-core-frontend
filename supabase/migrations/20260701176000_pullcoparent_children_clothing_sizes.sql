-- Clothing sizes on child profiles (shared between co-parents)

ALTER TABLE public.pullcoparent_children
  ADD COLUMN IF NOT EXISTS clothing_sizes text;
