-- When a camp registration is re-submitted, invalidate prior matching docs
-- so the family does not accumulate duplicate "current" forms.

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
  v_first_name TEXT := trim(COALESCE(p_first_name, ''));
  v_last_name TEXT := trim(COALESCE(p_last_name, ''));
BEGIN
  IF p_business_id IS NULL OR p_customer_id IS NULL THEN
    RAISE EXCEPTION 'business_id and customer_id are required';
  END IF;

  IF v_first_name = '' OR v_last_name = '' THEN
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

  -- Supersede prior valid docs for the same camper under this customer account.
  UPDATE public.camper_registration_documents d
  SET
    is_valid = false,
    updated_at = v_signed_at
  WHERE d.business_id = p_business_id
    AND d.customer_id = p_customer_id
    AND d.is_valid = true
    AND (
      (p_participant_id IS NOT NULL AND d.participant_id = p_participant_id)
      OR (
        p_booking_customer_participant_id IS NOT NULL
        AND d.booking_customer_participant_id = p_booking_customer_participant_id
      )
      OR (
        lower(trim(d.first_name)) = lower(v_first_name)
        AND lower(trim(d.last_name)) = lower(v_last_name)
        AND (
          p_date_of_birth IS NULL
          OR d.date_of_birth IS NULL
          OR d.date_of_birth = p_date_of_birth
        )
      )
    );

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
    v_first_name,
    v_last_name,
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

COMMENT ON FUNCTION public.bookings_submit_portal_camper_registration IS
  'Portal camp registration submit. Invalidates prior matching valid docs, then inserts the new form.';
