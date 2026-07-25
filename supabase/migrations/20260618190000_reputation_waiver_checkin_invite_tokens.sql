-- Personal single-use review invite per waiver check-in (identifies guest on low-star feedback).

CREATE UNIQUE INDEX IF NOT EXISTS reputation_invite_tokens_waiver_checkin_id_unique
  ON public.reputation_invite_tokens ((metadata->>'waiver_check_in_id'))
  WHERE source = 'waiver_check_in'
    AND coalesce(metadata->>'waiver_check_in_id', '') <> '';

CREATE OR REPLACE FUNCTION public.reputation_create_waiver_checkin_invite(
  p_business_id UUID,
  p_contact_email TEXT,
  p_check_in_id UUID,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm TEXT;
  v_secret TEXT;
  v_id UUID;
  v_expires TIMESTAMPTZ;
  v_existing RECORD;
  v_meta JSONB;
BEGIN
  IF p_business_id IS NULL OR p_check_in_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_params');
  END IF;

  v_norm := lower(trim(coalesce(p_contact_email, '')));
  IF v_norm = '' OR position('@' in v_norm) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_contact');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.reputation_settings WHERE business_id = p_business_id) THEN
    INSERT INTO public.reputation_settings (business_id) VALUES (p_business_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reputation_contact_opt_out
    WHERE business_id = p_business_id AND contact_normalized = v_norm
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'opted_out');
  END IF;

  SELECT t.id, t.secret, t.expires_at
  INTO v_existing
  FROM public.reputation_invite_tokens t
  WHERE t.business_id = p_business_id
    AND t.source = 'waiver_check_in'
    AND t.metadata->>'waiver_check_in_id' = p_check_in_id::text
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'token_id', v_existing.id,
      'secret', v_existing.secret,
      'expires_at', v_existing.expires_at,
      'reused', true
    );
  END IF;

  v_meta := coalesce(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'waiver_check_in_id', p_check_in_id::text,
      'contact_email', v_norm
    );

  v_secret := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_expires := timezone('utc', now()) + make_interval(days => 90);

  INSERT INTO public.reputation_invite_tokens (
    secret,
    business_id,
    contact_normalized,
    source,
    expires_at,
    metadata,
    delivered_at
  )
  VALUES (
    v_secret,
    p_business_id,
    v_norm,
    'waiver_check_in',
    v_expires,
    v_meta,
    timezone('utc', now())
  )
  RETURNING id INTO v_id;

  INSERT INTO public.reputation_events (business_id, event_type, payload)
  VALUES (
    p_business_id,
    'waiver_checkin_invite_created',
    jsonb_build_object(
      'token_id', v_id,
      'check_in_id', p_check_in_id,
      'contact', v_norm
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'token_id', v_id,
    'secret', v_secret,
    'expires_at', v_expires,
    'reused', false
  );
END;
$$;

COMMENT ON FUNCTION public.reputation_create_waiver_checkin_invite(UUID, TEXT, UUID, JSONB) IS
  'Service/edge: one personal review invite per waiver check-in. Skips daily cap; stores guest metadata for follow-up.';

REVOKE ALL ON FUNCTION public.reputation_create_waiver_checkin_invite(UUID, TEXT, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reputation_create_waiver_checkin_invite(UUID, TEXT, UUID, JSONB) TO service_role;
