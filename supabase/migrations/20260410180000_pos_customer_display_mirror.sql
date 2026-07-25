-- POS customer display mirror: sync register (browser) to desktop customer display app via Supabase.
-- Anonymous pull uses read_token (unguessable UUID). Staff push via RLS (business_users).

CREATE TABLE IF NOT EXISTS public.pos_customer_display_mirror (
  business_id uuid PRIMARY KEY REFERENCES public.businesses (id) ON DELETE CASCADE,
  read_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid (),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_customer_display_mirror_updated_at_idx
  ON public.pos_customer_display_mirror (updated_at DESC);

ALTER TABLE public.pos_customer_display_mirror ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pos_customer_display_mirror_business_users_all"
  ON public.pos_customer_display_mirror;

CREATE POLICY "pos_customer_display_mirror_business_users_all"
  ON public.pos_customer_display_mirror
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = pos_customer_display_mirror.business_id
        AND bu.user_id = auth.uid ()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = pos_customer_display_mirror.business_id
        AND bu.user_id = auth.uid ()
    )
  );

COMMENT ON TABLE public.pos_customer_display_mirror IS 'Live JSON snapshot for customer-facing display; read_token allows anon RPC pull for Electron app.';

-- Anon-safe pull for customer display .exe (token acts as secret).
CREATE OR REPLACE FUNCTION public.get_customer_display_state (p_token uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    jsonb_build_object(
      'business_id', m.business_id,
      'payload', COALESCE(m.payload, '{}'::jsonb),
      'updated_at', m.updated_at
    )
  FROM public.pos_customer_display_mirror m
  WHERE m.read_token = p_token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_customer_display_state (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_display_state (uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_customer_display_state (uuid) TO authenticated;

-- Regenerate token if leaked (authenticated business member only).
CREATE OR REPLACE FUNCTION public.regenerate_customer_display_read_token (p_business_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_t uuid := gen_random_uuid ();
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.business_id = p_business_id
      AND bu.user_id = auth.uid ()
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  INSERT INTO public.pos_customer_display_mirror (business_id, read_token, payload, updated_at)
  VALUES (p_business_id, new_t, '{}'::jsonb, now())
  ON CONFLICT (business_id) DO UPDATE
    SET read_token = new_t,
        updated_at = now();

  RETURN new_t;
END;
$$;

REVOKE ALL ON FUNCTION public.regenerate_customer_display_read_token (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regenerate_customer_display_read_token (uuid) TO authenticated;
