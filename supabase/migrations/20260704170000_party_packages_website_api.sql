-- Website-oriented birthday party packages (tavari-api-party-packages).

ALTER TABLE public.booking_activities
  ADD COLUMN IF NOT EXISTS website_show_party_package BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS website_food_credit NUMERIC,
  ADD COLUMN IF NOT EXISTS website_highlighted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS website_sort_order INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS website_package_inclusions JSONB;

COMMENT ON COLUMN public.booking_activities.website_show_party_package IS
  'When true, this bookable activity is returned by tavari-api-party-packages for external websites.';
COMMENT ON COLUMN public.booking_activities.website_food_credit IS
  'Concession food credit in dollars for website package display (e.g. 50 for $50 credit).';
COMMENT ON COLUMN public.booking_activities.website_highlighted IS
  'Highlight this tier on external website package grids.';
COMMENT ON COLUMN public.booking_activities.website_sort_order IS
  'Sort order for website party package listings (lower first).';
COMMENT ON COLUMN public.booking_activities.website_package_inclusions IS
  'Optional JSON array of inclusion lines for website display; auto-built when null.';

ALTER TABLE public.pos_inventory
  ADD COLUMN IF NOT EXISTS website_show_party_package BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.pos_inventory.website_show_party_package IS
  'When true, this inventory-only package (e.g. private rental) is returned by tavari-api-party-packages.';

CREATE INDEX IF NOT EXISTS idx_booking_activities_website_party_package
  ON public.booking_activities (business_id, website_show_party_package)
  WHERE website_show_party_package = true AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_pos_inventory_website_party_package
  ON public.pos_inventory (business_id, website_show_party_package)
  WHERE website_show_party_package = true AND is_active = true;
