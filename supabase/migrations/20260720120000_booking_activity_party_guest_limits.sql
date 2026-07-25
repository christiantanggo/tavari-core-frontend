-- Optional per-activity party guest list included counts (fallback: party_guest_list_settings defaults)

ALTER TABLE public.booking_activities
  ADD COLUMN IF NOT EXISTS party_included_kids INT,
  ADD COLUMN IF NOT EXISTS party_included_adults INT;

COMMENT ON COLUMN public.booking_activities.party_included_kids IS
  'Optional included children count for party guest list warnings on this booking type. NULL = use business default.';
COMMENT ON COLUMN public.booking_activities.party_included_adults IS
  'Optional included adults count for party guest list warnings on this booking type. NULL = use business default.';
