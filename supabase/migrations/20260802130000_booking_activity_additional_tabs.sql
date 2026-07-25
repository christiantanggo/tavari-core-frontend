-- Configurable additional tabs on booking activities (content blocks + reminders).
-- Cake receipts become an activity-configured tab (seeded for party activities).

CREATE TABLE IF NOT EXISTS public.booking_activity_tabs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES public.booking_activities(id) ON DELETE CASCADE,
  tab_key TEXT NOT NULL,
  label TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  audience TEXT NOT NULL DEFAULT 'both'
    CHECK (audience IN ('staff', 'customer', 'both')),
  content_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  reminders JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (activity_id, tab_key)
);

CREATE INDEX IF NOT EXISTS idx_booking_activity_tabs_activity
  ON public.booking_activity_tabs (activity_id, display_order)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_booking_activity_tabs_business
  ON public.booking_activity_tabs (business_id);

COMMENT ON TABLE public.booking_activity_tabs IS
  'Configurable additional booking detail/manage tabs per activity (headers, text, links, lists, file uploads, reminders).';

ALTER TABLE public.booking_activity_tabs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS booking_activity_tabs_staff_all ON public.booking_activity_tabs;
CREATE POLICY booking_activity_tabs_staff_all ON public.booking_activity_tabs
  FOR ALL USING (
    business_id IN (
      SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS booking_activity_tabs_anon_select ON public.booking_activity_tabs;
CREATE POLICY booking_activity_tabs_anon_select ON public.booking_activity_tabs
  FOR SELECT TO anon, authenticated
  USING (is_active = true);

-- Simple per-booking checklist / list items for list content blocks
CREATE TABLE IF NOT EXISTS public.booking_activity_tab_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  tab_id UUID NOT NULL REFERENCES public.booking_activity_tabs(id) ON DELETE CASCADE,
  list_key TEXT NOT NULL DEFAULT 'default',
  label TEXT NOT NULL,
  is_done BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_source TEXT NOT NULL DEFAULT 'staff'
    CHECK (created_source IN ('staff', 'customer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_booking_activity_tab_list_items_booking
  ON public.booking_activity_tab_list_items (booking_id, tab_id, list_key, sort_order);

ALTER TABLE public.booking_activity_tab_list_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS booking_activity_tab_list_items_staff ON public.booking_activity_tab_list_items;
CREATE POLICY booking_activity_tab_list_items_staff ON public.booking_activity_tab_list_items
  FOR ALL USING (
    business_id IN (
      SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
    )
  );

-- Reminder send log (idempotency)
CREATE TABLE IF NOT EXISTS public.booking_activity_tab_reminder_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  tab_id UUID NOT NULL REFERENCES public.booking_activity_tabs(id) ON DELETE CASCADE,
  reminder_key TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (booking_id, tab_id, reminder_key)
);

CREATE INDEX IF NOT EXISTS idx_booking_activity_tab_reminder_log_booking
  ON public.booking_activity_tab_reminder_log (booking_id, sent_at DESC);

ALTER TABLE public.booking_activity_tab_reminder_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS booking_activity_tab_reminder_log_staff ON public.booking_activity_tab_reminder_log;
CREATE POLICY booking_activity_tab_reminder_log_staff ON public.booking_activity_tab_reminder_log
  FOR ALL USING (
    business_id IN (
      SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
    )
  );

-- Seed Cake receipts tab onto birthday party + private facility activities that have no tabs yet
INSERT INTO public.booking_activity_tabs (
  business_id,
  activity_id,
  tab_key,
  label,
  display_order,
  is_active,
  audience,
  content_blocks,
  reminders
)
SELECT
  a.business_id,
  a.id,
  'cake-receipts',
  'Cake receipts',
  0,
  true,
  'both',
  jsonb_build_array(
    jsonb_build_object(
      'id', 'hdr-cake',
      'type', 'header',
      'text', 'Cake receipts'
    ),
    jsonb_build_object(
      'id', 'txt-cake',
      'type', 'text',
      'body', 'Upload a photo or PDF of your cake purchase receipt so our team can verify it before the party.'
    ),
    jsonb_build_object(
      'id', 'upload-cake',
      'type', 'file_upload',
      'upload_key', 'cake_receipts',
      'label', 'Upload cake receipt',
      'accept', 'image/*,application/pdf',
      'max_files', 10
    )
  ),
  jsonb_build_object(
    'customer', jsonb_build_array(
      jsonb_build_object(
        'id', 'cust-cake-3d',
        'enabled', true,
        'days_before', 3,
        'send_hour', 10,
        'subject', 'Reminder: upload your cake receipt',
        'body', 'Please upload your cake receipt for {{activity_name}} on {{booking_date}} from your manage booking page.'
      )
    ),
    'staff', jsonb_build_array(
      jsonb_build_object(
        'id', 'staff-cake-1d',
        'enabled', true,
        'days_before', 1,
        'send_hour', 9,
        'emails', '[]'::jsonb,
        'subject', 'Cake receipt missing: {{booking_number}}',
        'body', '{{activity_name}} on {{booking_date}} still has no cake receipt uploaded.'
      )
    )
  )
FROM public.booking_activities a
INNER JOIN public.booking_types t ON t.id = a.type_id
WHERE t.type_key IN ('birthday_party', 'private_facility_rental')
  AND a.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.booking_activity_tabs bat
    WHERE bat.activity_id = a.id AND bat.tab_key = 'cake-receipts'
  );
