-- Party guest list system (OTWK birthday parties)

CREATE TABLE IF NOT EXISTS public.party_guest_list_settings (
  business_id UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  edit_deadline_days_before_party INT NOT NULL DEFAULT 7,
  default_included_kids INT NOT NULL DEFAULT 12,
  default_included_adults INT NOT NULL DEFAULT 12,
  kids_chair_limit_per_room INT NOT NULL DEFAULT 18,
  post_deadline_contact_text TEXT DEFAULT 'To update your guest list after the deadline, please contact info@offthewallkids.ca or call 519-914-0551.',
  reminder_email_schedule JSONB NOT NULL DEFAULT '[]'::jsonb,
  staff_notification_emails TEXT[] NOT NULL DEFAULT '{}',
  host_portal_intro TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.party_guest_list_settings IS
  'Business-level configuration for party guest lists (deadlines, allotments, reminders).';

CREATE TABLE IF NOT EXISTS public.party_guest_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  booker_phone TEXT NOT NULL,
  booker_customer_id UUID REFERENCES public.pos_loyalty_accounts(id) ON DELETE SET NULL,
  party_date DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'locked')),
  overage_payment TEXT CHECK (overage_payment IN ('host_bill', 'guest_at_gate')),
  submitted_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  settings_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  staff_notified_at TIMESTAMPTZ,
  last_host_edit_after_deadline_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_party_guest_lists_booking_unique
  ON public.party_guest_lists (business_id, booking_id)
  WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_party_guest_lists_business_phone
  ON public.party_guest_lists (business_id, booker_phone);

CREATE INDEX IF NOT EXISTS idx_party_guest_lists_business_date
  ON public.party_guest_lists (business_id, party_date);

CREATE INDEX IF NOT EXISTS idx_party_guest_lists_status
  ON public.party_guest_lists (business_id, status);

COMMENT ON TABLE public.party_guest_lists IS
  'One guest list per party booking (or phone-only legacy list when booking_id is null).';

CREATE TABLE IF NOT EXISTS public.party_guest_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_list_id UUID NOT NULL REFERENCES public.party_guest_lists(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  display_sort_order INT NOT NULL DEFAULT 0,
  guest_type TEXT NOT NULL CHECK (guest_type IN ('child', 'adult')),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  parent_last_name TEXT,
  household_phone TEXT,
  role_tag TEXT NOT NULL DEFAULT 'child'
    CHECK (role_tag IN ('birthday_child', 'child', 'adult', 'non_moving_baby')),
  is_attending BOOLEAN NOT NULL DEFAULT TRUE,
  is_birthday_child BOOLEAN NOT NULL DEFAULT FALSE,
  waiver_signature_id UUID REFERENCES public.waiver_signatures(id) ON DELETE SET NULL,
  waiver_status TEXT NOT NULL DEFAULT 'not_verified'
    CHECK (waiver_status IN ('verified', 'name_mismatch', 'missing', 'expired', 'not_verified')),
  waiver_review_note TEXT,
  expired_waiver_email_sent_at TIMESTAMPTZ,
  checked_in_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'host'
    CHECK (source IN ('host', 'staff', 'walk_in')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_party_guest_entries_list
  ON public.party_guest_entries (guest_list_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_party_guest_entries_checked_in
  ON public.party_guest_entries (guest_list_id)
  WHERE checked_in_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.party_guest_list_reminder_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_list_id UUID NOT NULL REFERENCES public.party_guest_lists(id) ON DELETE CASCADE,
  reminder_key TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (guest_list_id, reminder_key)
);

ALTER TABLE public.party_guest_list_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.party_guest_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.party_guest_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.party_guest_list_reminder_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY party_guest_list_settings_select ON public.party_guest_list_settings
  FOR SELECT USING (
    business_id IN (SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid())
  );

CREATE POLICY party_guest_list_settings_write ON public.party_guest_list_settings
  FOR ALL USING (
    business_id IN (SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid())
  )
  WITH CHECK (
    business_id IN (SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid())
  );

CREATE POLICY party_guest_lists_select ON public.party_guest_lists
  FOR SELECT USING (
    business_id IN (SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid())
  );

CREATE POLICY party_guest_lists_write ON public.party_guest_lists
  FOR ALL USING (
    business_id IN (SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid())
  )
  WITH CHECK (
    business_id IN (SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid())
  );

CREATE POLICY party_guest_entries_select ON public.party_guest_entries
  FOR SELECT USING (
    guest_list_id IN (
      SELECT pgl.id FROM public.party_guest_lists pgl
      WHERE pgl.business_id IN (
        SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
      )
    )
  );

CREATE POLICY party_guest_entries_write ON public.party_guest_entries
  FOR ALL USING (
    guest_list_id IN (
      SELECT pgl.id FROM public.party_guest_lists pgl
      WHERE pgl.business_id IN (
        SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    guest_list_id IN (
      SELECT pgl.id FROM public.party_guest_lists pgl
      WHERE pgl.business_id IN (
        SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
      )
    )
  );

CREATE POLICY party_guest_list_reminder_log_staff ON public.party_guest_list_reminder_log
  FOR ALL USING (
    guest_list_id IN (
      SELECT pgl.id FROM public.party_guest_lists pgl
      WHERE pgl.business_id IN (
        SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
      )
    )
  );

-- Find upcoming bookings for a booker phone (party guest list OTP flow)
CREATE OR REPLACE FUNCTION public.party_guest_list_find_bookings_by_phone(
  p_business_id UUID,
  p_phone_number TEXT
)
RETURNS TABLE (
  booking_id UUID,
  booking_number TEXT,
  booking_date DATE,
  booking_time TIME,
  activity_name TEXT,
  customer_name TEXT,
  guest_list_id UUID,
  guest_list_status TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id AS booking_id,
    b.booking_number,
    b.booking_date,
    b.booking_time,
    COALESCE(ba.activity_name, 'Party') AS activity_name,
    TRIM(COALESCE(pl.customer_name, '')) AS customer_name,
    pgl.id AS guest_list_id,
    pgl.status AS guest_list_status
  FROM public.bookings b
  LEFT JOIN public.booking_activities ba ON ba.id = b.activity_id
  LEFT JOIN public.pos_loyalty_accounts pl ON pl.id = b.customer_id
  LEFT JOIN public.party_guest_lists pgl ON pgl.booking_id = b.id AND pgl.business_id = b.business_id
  WHERE b.business_id = p_business_id
    AND b.booking_date >= CURRENT_DATE
    AND b.status NOT IN ('cancelled', 'completed')
    AND public.waiver_otp_phone_digits(b.customer_phone) = public.waiver_otp_phone_digits(p_phone_number)
    AND length(public.waiver_otp_phone_digits(p_phone_number)) >= 10
  ORDER BY b.booking_date ASC, b.booking_time ASC;
$$;

GRANT EXECUTE ON FUNCTION public.party_guest_list_find_bookings_by_phone(UUID, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.party_guest_list_find_bookings_by_phone IS
  'Public OTP flow: list upcoming bookings for party booker phone.';

-- Seed default settings for OTWK
INSERT INTO public.party_guest_list_settings (business_id)
SELECT id FROM public.businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM public.party_guest_list_settings s WHERE s.business_id = b.id
);
