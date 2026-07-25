-- Extra child profile fields for co-parent handoffs (medical, food/drink preferences)

ALTER TABLE public.pullcoparent_children
  ADD COLUMN IF NOT EXISTS medical_info text,
  ADD COLUMN IF NOT EXISTS food_preferences text,
  ADD COLUMN IF NOT EXISTS drink_preferences text;
