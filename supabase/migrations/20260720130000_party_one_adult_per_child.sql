-- 1 free adult per child on guest list (optional business + per-activity override)

ALTER TABLE public.party_guest_list_settings
  ADD COLUMN IF NOT EXISTS one_adult_per_child_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.party_guest_list_settings.one_adult_per_child_enabled IS
  'When true, each child on the guest list includes 1 free adult; included adult count is max(package included adults, child count).';

ALTER TABLE public.booking_activities
  ADD COLUMN IF NOT EXISTS party_one_adult_per_child BOOLEAN;

COMMENT ON COLUMN public.booking_activities.party_one_adult_per_child IS
  'Override business one_adult_per_child_enabled for this booking type. NULL = use business default.';
