-- Annual camper registration form template (one per business) + portal submit RPC.

CREATE TABLE IF NOT EXISTS public.camper_registration_form_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  form_title TEXT NOT NULL DEFAULT 'Annual Camper Registration',
  form_intro TEXT,
  expiry_days INTEGER NOT NULL DEFAULT 365,
  fields_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT camper_registration_form_templates_business_unique UNIQUE (business_id)
);

CREATE INDEX IF NOT EXISTS idx_camper_registration_form_templates_business
  ON public.camper_registration_form_templates (business_id)
  WHERE is_active = true;

ALTER TABLE public.camper_registration_form_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "camper_registration_form_templates_staff_all" ON public.camper_registration_form_templates;
CREATE POLICY "camper_registration_form_templates_staff_all"
  ON public.camper_registration_form_templates
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

DROP POLICY IF EXISTS "camper_registration_form_templates_portal_read" ON public.camper_registration_form_templates;
CREATE POLICY "camper_registration_form_templates_portal_read"
  ON public.camper_registration_form_templates
  FOR SELECT
  USING (is_active = true);

CREATE OR REPLACE FUNCTION public.bookings_get_portal_camper_registration_template(
  p_business_id UUID
)
RETURNS TABLE (
  id UUID,
  business_id UUID,
  form_title TEXT,
  form_intro TEXT,
  expiry_days INTEGER,
  fields_config JSONB,
  is_active BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.business_id,
    t.form_title,
    t.form_intro,
    t.expiry_days,
    t.fields_config,
    t.is_active
  FROM public.camper_registration_form_templates t
  WHERE t.business_id = p_business_id
    AND t.is_active = true
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.bookings_get_portal_camper_registration_template(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.bookings_submit_portal_camper_registration(
  p_business_id UUID,
  p_customer_id UUID,
  p_participant_id UUID,
  p_booking_customer_participant_id UUID,
  p_first_name TEXT,
  p_last_name TEXT,
  p_date_of_birth DATE,
  p_form_data JSONB,
  p_authorized_pickups JSONB,
  p_medical_summary JSONB,
  p_signature_image_url TEXT,
  p_signature_data JSONB,
  p_signed_by_name TEXT,
  p_signed_by_relationship TEXT,
  p_expiry_days INTEGER DEFAULT 365
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expiry_days INTEGER;
  v_signed_at TIMESTAMPTZ := now();
  v_expires_at TIMESTAMPTZ;
  v_document_id UUID;
BEGIN
  IF p_business_id IS NULL OR p_customer_id IS NULL THEN
    RAISE EXCEPTION 'business_id and customer_id are required';
  END IF;

  IF COALESCE(trim(p_first_name), '') = '' OR COALESCE(trim(p_last_name), '') = '' THEN
    RAISE EXCEPTION 'Camper first and last name are required';
  END IF;

  IF COALESCE(trim(p_signed_by_name), '') = '' THEN
    RAISE EXCEPTION 'Guardian signature name is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pos_loyalty_accounts la
    WHERE la.id = p_customer_id AND la.business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Customer account not found for this business';
  END IF;

  v_expiry_days := GREATEST(COALESCE(p_expiry_days, 365), 1);
  v_expires_at := v_signed_at + (v_expiry_days || ' days')::interval;

  INSERT INTO public.camper_registration_documents (
    business_id,
    customer_id,
    participant_id,
    booking_customer_participant_id,
    first_name,
    last_name,
    date_of_birth,
    form_data,
    authorized_pickups,
    medical_summary,
    signature_image_url,
    signature_data,
    signed_by_name,
    signed_by_relationship,
    signed_at,
    expires_at,
    is_valid,
    source,
    created_at,
    updated_at
  )
  VALUES (
    p_business_id,
    p_customer_id,
    NULLIF(p_participant_id, NULL),
    NULLIF(p_booking_customer_participant_id, NULL),
    trim(p_first_name),
    trim(p_last_name),
    p_date_of_birth,
    COALESCE(p_form_data, '{}'::jsonb),
    COALESCE(p_authorized_pickups, '[]'::jsonb),
    COALESCE(p_medical_summary, '{}'::jsonb),
    NULLIF(trim(p_signature_image_url), ''),
    p_signature_data,
    trim(p_signed_by_name),
    NULLIF(trim(p_signed_by_relationship), ''),
    v_signed_at,
    v_expires_at,
    true,
    'portal',
    v_signed_at,
    v_signed_at
  )
  RETURNING id INTO v_document_id;

  RETURN v_document_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bookings_submit_portal_camper_registration(
  UUID, UUID, UUID, UUID, TEXT, TEXT, DATE, JSONB, JSONB, JSONB, TEXT, JSONB, TEXT, TEXT, INTEGER
) TO anon, authenticated;
