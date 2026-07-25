-- Optional POS ticket mapping for party guest list overage pricing shown to hosts

ALTER TABLE public.party_guest_list_settings
  ADD COLUMN IF NOT EXISTS extra_child_inventory_item_id UUID REFERENCES public.pos_inventory(id) ON DELETE SET NULL;

ALTER TABLE public.party_guest_list_settings
  ADD COLUMN IF NOT EXISTS extra_adult_inventory_item_id UUID REFERENCES public.pos_inventory(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.party_guest_list_settings.extra_child_inventory_item_id IS
  'POS ticket used to price extra children beyond the party package (fallback: match Ages 2-17 / Gen Admission 2-17 by name)';
COMMENT ON COLUMN public.party_guest_list_settings.extra_adult_inventory_item_id IS
  'POS ticket used to price extra adults beyond the party package (fallback: match Additional Adult(s) by name)';
