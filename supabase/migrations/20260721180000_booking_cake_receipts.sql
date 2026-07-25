-- Party booking cake receipt uploads (customer portal + staff dashboard)

CREATE TABLE IF NOT EXISTS public.booking_cake_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_source TEXT NOT NULL DEFAULT 'staff'
    CHECK (uploaded_source IN ('staff', 'customer')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_booking_cake_receipts_booking
  ON public.booking_cake_receipts (booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_cake_receipts_business
  ON public.booking_cake_receipts (business_id, created_at DESC);

COMMENT ON TABLE public.booking_cake_receipts IS
  'Cake purchase receipts uploaded by party hosts or staff for a booking.';

ALTER TABLE public.booking_cake_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS booking_cake_receipts_staff_select ON public.booking_cake_receipts;
CREATE POLICY booking_cake_receipts_staff_select ON public.booking_cake_receipts
  FOR SELECT USING (
    business_id IN (
      SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS booking_cake_receipts_staff_write ON public.booking_cake_receipts;
CREATE POLICY booking_cake_receipts_staff_write ON public.booking_cake_receipts
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

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'booking-cake-receipts',
  'booking-cake-receipts',
  false,
  10485760,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Booking cake receipts staff read" ON storage.objects;
CREATE POLICY "Booking cake receipts staff read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'booking-cake-receipts'
  AND (storage.foldername(name))[1]::uuid IN (
    SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Booking cake receipts staff insert" ON storage.objects;
CREATE POLICY "Booking cake receipts staff insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'booking-cake-receipts'
  AND (storage.foldername(name))[1]::uuid IN (
    SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Booking cake receipts staff delete" ON storage.objects;
CREATE POLICY "Booking cake receipts staff delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'booking-cake-receipts'
  AND (storage.foldername(name))[1]::uuid IN (
    SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
  )
);
