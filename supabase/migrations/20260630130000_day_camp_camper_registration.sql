-- Day camp annual camper registration.
-- This is intentionally separate from waiver_signatures: the combined annual
-- registration/medical form expires independently per child and can be missing
-- without blocking payment.

ALTER TABLE public.booking_types
  ADD COLUMN IF NOT EXISTS requires_camper_registration BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.booking_activities
  ADD COLUMN IF NOT EXISTS requires_camper_registration BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.booking_activities.requires_camper_registration IS
  'When true, selected participants need a current annual camper registration before attendance/check-in.';

CREATE TABLE IF NOT EXISTS public.camper_registration_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.pos_loyalty_accounts(id) ON DELETE SET NULL,
  participant_id UUID REFERENCES public.waiver_participants(id) ON DELETE SET NULL,
  booking_customer_participant_id UUID REFERENCES public.booking_customer_participants(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  date_of_birth DATE,
  form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  authorized_pickups JSONB NOT NULL DEFAULT '[]'::jsonb,
  medical_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  signature_image_url TEXT,
  signature_data JSONB,
  signed_by_name TEXT,
  signed_by_relationship TEXT,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '365 days'),
  is_valid BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL DEFAULT 'portal' CHECK (source IN ('portal', 'staff', 'kiosk', 'import')),
  imported_file_url TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_camper_registration_business_customer
  ON public.camper_registration_documents (business_id, customer_id, is_valid, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_camper_registration_participant
  ON public.camper_registration_documents (business_id, participant_id, expires_at DESC)
  WHERE participant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_camper_registration_booking_participant
  ON public.camper_registration_documents (business_id, booking_customer_participant_id, expires_at DESC)
  WHERE booking_customer_participant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_camper_registration_identity
  ON public.camper_registration_documents (
    business_id,
    lower(first_name),
    lower(last_name),
    date_of_birth,
    expires_at DESC
  );

ALTER TABLE public.booking_participants
  ADD COLUMN IF NOT EXISTS camper_registration_document_id UUID REFERENCES public.camper_registration_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS camper_registration_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (camper_registration_status IN ('valid', 'expired', 'not_required', 'missing')),
  ADD COLUMN IF NOT EXISTS check_in_signature_url TEXT,
  ADD COLUMN IF NOT EXISTS check_in_signature_data JSONB,
  ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checked_out_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS check_out_signature_url TEXT,
  ADD COLUMN IF NOT EXISTS check_out_signature_data JSONB,
  ADD COLUMN IF NOT EXISTS released_to_name TEXT,
  ADD COLUMN IF NOT EXISTS pickup_id_verified BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_booking_participants_camper_registration
  ON public.booking_participants (camper_registration_document_id)
  WHERE camper_registration_document_id IS NOT NULL;

ALTER TABLE public.camper_registration_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "camper_registration_documents_staff_select" ON public.camper_registration_documents;
CREATE POLICY "camper_registration_documents_staff_select"
  ON public.camper_registration_documents
  FOR SELECT
  USING (
    business_id IN (
      SELECT ur.business_id FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND COALESCE(ur.active, true) = true
    )
    OR business_id IN (
      SELECT bu.business_id FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "camper_registration_documents_staff_write" ON public.camper_registration_documents;
CREATE POLICY "camper_registration_documents_staff_write"
  ON public.camper_registration_documents
  FOR ALL
  USING (
    business_id IN (
      SELECT ur.business_id FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND COALESCE(ur.active, true) = true
    )
    OR business_id IN (
      SELECT bu.business_id FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT ur.business_id FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND COALESCE(ur.active, true) = true
    )
    OR business_id IN (
      SELECT bu.business_id FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.bookings_get_portal_camper_registrations(
  p_business_id UUID,
  p_customer_id UUID
)
RETURNS TABLE (
  id UUID,
  business_id UUID,
  customer_id UUID,
  participant_id UUID,
  booking_customer_participant_id UUID,
  first_name TEXT,
  last_name TEXT,
  date_of_birth DATE,
  medical_summary JSONB,
  authorized_pickups JSONB,
  signed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  is_valid BOOLEAN,
  source TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    crd.id,
    crd.business_id,
    crd.customer_id,
    crd.participant_id,
    crd.booking_customer_participant_id,
    crd.first_name,
    crd.last_name,
    crd.date_of_birth,
    crd.medical_summary,
    crd.authorized_pickups,
    crd.signed_at,
    crd.expires_at,
    crd.is_valid,
    crd.source
  FROM public.camper_registration_documents crd
  WHERE crd.business_id = p_business_id
    AND crd.customer_id = p_customer_id
  ORDER BY crd.expires_at DESC, crd.signed_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.bookings_get_portal_camper_registrations(UUID, UUID) TO anon, authenticated;
