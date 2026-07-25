-- Fix: gen_random_bytes() requires pgcrypto; some projects do not have it enabled.
-- Recreate invite-token RPC using only gen_random_uuid().

CREATE OR REPLACE FUNCTION public.reputation_create_invite_token(
  p_business_id UUID,
  p_contact_normalized TEXT,
  p_channel TEXT DEFAULT 'email',
  p_source TEXT DEFAULT 'manual',
  p_ttl_days INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm TEXT;
  v_ch TEXT;
  v_day DATE;
  v_secret TEXT;
  v_id UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  IF NOT public.reputation_user_can_access_business(p_business_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.reputation_settings WHERE business_id = p_business_id) THEN
    INSERT INTO public.reputation_settings (business_id) VALUES (p_business_id);
  END IF;

  v_norm := lower(trim(coalesce(p_contact_normalized, '')));
  IF v_norm = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_contact');
  END IF;

  v_ch := lower(trim(coalesce(p_channel, 'email')));
  IF v_ch NOT IN ('email', 'sms') THEN
    v_ch := 'email';
  END IF;

  v_day := (timezone('utc', now()))::date;

  IF EXISTS (
    SELECT 1 FROM public.reputation_contact_opt_out
    WHERE business_id = p_business_id AND contact_normalized = v_norm
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'opted_out');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reputation_daily_invite_cap
    WHERE business_id = p_business_id
      AND contact_normalized = v_norm
      AND invite_day = v_day
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'daily_cap');
  END IF;

  v_secret := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  v_expires := timezone('utc', now()) + (make_interval(days => greatest(1, coalesce(p_ttl_days, 30))));

  INSERT INTO public.reputation_invite_tokens (secret, business_id, contact_normalized, source, expires_at)
  VALUES (v_secret, p_business_id, v_norm, coalesce(nullif(trim(p_source),''), 'manual'), v_expires)
  RETURNING id INTO v_id;

  INSERT INTO public.reputation_daily_invite_cap (business_id, contact_normalized, invite_day, channel)
  VALUES (p_business_id, v_norm, v_day, v_ch)
  ON CONFLICT (business_id, contact_normalized, invite_day) DO NOTHING;

  INSERT INTO public.reputation_events (business_id, event_type, payload)
  VALUES (p_business_id, 'invite_created', jsonb_build_object('channel', v_ch));

  RETURN jsonb_build_object(
    'ok', true,
    'token_id', v_id,
    'secret', v_secret,
    'expires_at', v_expires
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reputation_create_invite_token(UUID, TEXT, TEXT, TEXT, INTEGER) TO authenticated;
