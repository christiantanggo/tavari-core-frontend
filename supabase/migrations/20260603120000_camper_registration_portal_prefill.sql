-- Allow customer portal to load an existing registration for form prefill on update.

CREATE OR REPLACE FUNCTION public.bookings_get_portal_camper_registration_prefill(
  p_business_id UUID,
  p_customer_id UUID,
  p_participant_id UUID DEFAULT NULL,
  p_booking_customer_participant_id UUID DEFAULT NULL,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL,
  p_date_of_birth DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.camper_registration_documents%ROWTYPE;
  v_fn TEXT := lower(trim(coalesce(p_first_name, '')));
  v_ln TEXT := lower(trim(coalesce(p_last_name, '')));
BEGIN
  IF p_business_id IS NULL OR p_customer_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pos_loyalty_accounts la
    WHERE la.id = p_customer_id AND la.business_id = p_business_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_doc
  FROM public.camper_registration_documents crd
  WHERE crd.business_id = p_business_id
    AND crd.customer_id = p_customer_id
    AND (
      (p_participant_id IS NOT NULL AND crd.participant_id = p_participant_id)
      OR (
        p_booking_customer_participant_id IS NOT NULL
        AND crd.booking_customer_participant_id = p_booking_customer_participant_id
      )
      OR (
        v_fn <> ''
        AND v_ln <> ''
        AND lower(trim(crd.first_name)) = v_fn
        AND lower(trim(crd.last_name)) = v_ln
        AND (p_date_of_birth IS NULL OR crd.date_of_birth = p_date_of_birth)
      )
    )
  ORDER BY crd.is_valid DESC, crd.expires_at DESC NULLS LAST, crd.signed_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_doc.id,
    'form_data', v_doc.form_data,
    'medical_summary', v_doc.medical_summary,
    'authorized_pickups', v_doc.authorized_pickups,
    'signed_by_name', v_doc.signed_by_name,
    'signed_by_relationship', v_doc.signed_by_relationship,
    'signature_image_url', v_doc.signature_image_url,
    'signature_data', v_doc.signature_data,
    'signed_at', v_doc.signed_at,
    'expires_at', v_doc.expires_at,
    'is_valid', v_doc.is_valid
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bookings_get_portal_camper_registration_prefill(
  UUID, UUID, UUID, UUID, TEXT, TEXT, DATE
) TO anon, authenticated;
