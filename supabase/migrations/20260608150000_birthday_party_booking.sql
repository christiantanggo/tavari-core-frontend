-- Birthday party booking: participant roles on bookings + ensure default category per business.

ALTER TABLE public.booking_participants
  ADD COLUMN IF NOT EXISTS party_role text;

COMMENT ON COLUMN public.booking_participants.party_role IS
  'For party bookings: host_adult | birthday_child. NULL for standard per-person bookings.';

CREATE INDEX IF NOT EXISTS idx_booking_participants_party_role
  ON public.booking_participants (booking_id, party_role)
  WHERE party_role IS NOT NULL;

-- Seed Birthday Party category for all businesses that do not have one yet.
INSERT INTO public.booking_types (
  business_id,
  type_name,
  type_key,
  display_name,
  description,
  requires_waiver,
  requires_payment,
  session_rules,
  is_active
)
SELECT
  b.id,
  'Birthday Party',
  'birthday_party',
  'Birthday Party',
  'Party room bookings — one space per time slot with host and birthday child roles.',
  true,
  true,
  jsonb_build_object(
    'party_booking', true,
    'require_birthday_child', true,
    'default_spaces_per_slot', 1
  ),
  true
FROM public.businesses b
WHERE NOT EXISTS (
  SELECT 1
  FROM public.booking_types bt
  WHERE bt.business_id = b.id
    AND bt.type_key = 'birthday_party'
);
