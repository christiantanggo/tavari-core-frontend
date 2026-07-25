-- 6-digit pairing codes for POS customer display desktop app (TableSign-style).
-- Staff creates code from web (authenticated); Electron redeems with anon RPC and saves config locally.

CREATE TABLE IF NOT EXISTS public.pos_customer_display_pairing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  code text NOT NULL,
  production_url text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now (),
  CONSTRAINT pos_customer_display_pairing_code_chk CHECK (code ~ '^[0-9]{6}$')
);

CREATE INDEX IF NOT EXISTS pos_customer_display_pairing_expires_idx
  ON public.pos_customer_display_pairing (expires_at);

-- One unused row per code at a time (globally) to avoid ambiguity at redeem.
CREATE UNIQUE INDEX IF NOT EXISTS pos_customer_display_pairing_active_code_uidx
  ON public.pos_customer_display_pairing (code)
  WHERE used_at IS NULL;

ALTER TABLE public.pos_customer_display_pairing ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pos_customer_display_pairing FROM PUBLIC;

COMMENT ON TABLE public.pos_customer_display_pairing IS 'Short-lived codes pairing customer display .exe to a business; redeemed once via anon RPC.';

-- Ensure mirror row exists (read_token) before staff can pair.
CREATE OR REPLACE FUNCTION public.create_customer_display_pairing_code (
  p_business_id uuid,
  p_production_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_expires timestamptz := now() + interval '15 minutes';
  v_code text;
  i int;
BEGIN
  IF NOT EXISTS (
    SELECT
      1
    FROM
      public.business_users bu
    WHERE
      bu.business_id = p_business_id
      AND bu.user_id = auth.uid ()
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  v_url := nullif (trim(p_production_url), '');
  IF v_url IS NULL
  OR length(v_url) > 512 THEN
    RAISE EXCEPTION 'invalid production url';
  END IF;

  INSERT INTO public.pos_customer_display_mirror (business_id, payload, updated_at)
  VALUES (p_business_id, '{}'::jsonb, now())
  ON CONFLICT (business_id)
    DO NOTHING;

  FOR i IN 1..50 LOOP
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    BEGIN
      INSERT INTO public.pos_customer_display_pairing (business_id, code, production_url, expires_at)
        VALUES (p_business_id, v_code, v_url, v_expires);
      RETURN jsonb_build_object(
        'ok', TRUE,
        'code', v_code,
        'expires_at', v_expires
      );
    EXCEPTION
      WHEN unique_violation THEN
        -- rare collision on active code; retry
        NULL;
    END;
  END LOOP;
  RAISE EXCEPTION 'could not allocate pairing code';
END;
$$;

REVOKE ALL ON FUNCTION public.create_customer_display_pairing_code (uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_customer_display_pairing_code (uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.redeem_customer_display_pairing_code (p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  r RECORD;
  v_token uuid;
BEGIN
  IF p_code IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'invalid_code');
  END IF;

  v_code := regexp_replace(trim(p_code), '[^0-9]', '', 'g');
  IF length(v_code) <> 6 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'invalid_code');
  END IF;

  SELECT
    p.id,
    p.business_id,
    p.production_url INTO r
  FROM
    public.pos_customer_display_pairing p
  WHERE
    p.code = v_code
    AND p.used_at IS NULL
    AND p.expires_at > now()
  ORDER BY
    p.created_at DESC
  LIMIT 1
  FOR UPDATE
    SKIP LOCKED;

  IF r.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'not_found_or_expired');
  END IF;

  UPDATE
    public.pos_customer_display_pairing
  SET
    used_at = now()
  WHERE
    id = r.id;

  SELECT
    m.read_token INTO v_token
  FROM
    public.pos_customer_display_mirror m
  WHERE
    m.business_id = r.business_id;

  IF v_token IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'display_not_configured');
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'displayToken', v_token::text,
    'productionUrl', r.production_url,
    'hashRoute', '/customer-display'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_customer_display_pairing_code (text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_customer_display_pairing_code (text) TO anon;
GRANT EXECUTE ON FUNCTION public.redeem_customer_display_pairing_code (text) TO authenticated;
