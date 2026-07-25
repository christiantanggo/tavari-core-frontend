-- Link imported legacy_waivers signers to pos_loyalty_accounts (same portal customer pattern as new waivers).
-- Requires a normalizable phone (>=10 digits after waiver_otp_phone_digits) — same as bookings_create_or_get_portal_customer.

ALTER TABLE public.legacy_waivers
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.pos_loyalty_accounts (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_legacy_waivers_pos_customer
  ON public.legacy_waivers (customer_id)
  WHERE customer_id IS NOT NULL;

COMMENT ON COLUMN public.legacy_waivers.customer_id IS
  'POS / portal loyalty account for this signer when creatable from phone (bookings_create_or_get_portal_customer).';

-- Recreate (idempotent) because return type / body change.
DROP FUNCTION IF EXISTS public.legacy_waivers_link_or_create_pos_customers (uuid, integer);

CREATE OR REPLACE FUNCTION public.legacy_waivers_link_or_create_pos_customers (
  p_business_id uuid,
  p_max_rows integer DEFAULT 2000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_max integer;
  v_processed integer := 0;
  v_linked integer := 0;
  v_skipped integer := 0;
  r public.legacy_waivers%ROWTYPE;
  v_cust public.pos_loyalty_accounts%ROWTYPE;
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'p_business_id is required';
  END IF;

  v_business_id := p_business_id;
  v_max := GREATEST(1, LEAST(COALESCE(p_max_rows, 2000), 20000));

  IF NOT (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
        AND bu.business_id = v_business_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.business_id = v_business_id
    )
  ) THEN
    RAISE EXCEPTION 'not authorized for this business';
  END IF;

  FOR r IN
    SELECT lw.*
    FROM public.legacy_waivers lw
    WHERE lw.business_id = v_business_id
      AND lw.deleted_at IS NULL
      AND lw.customer_id IS NULL
    ORDER BY lw.signed_at DESC NULLS LAST, lw.imported_at DESC NULLS LAST, lw.id
    LIMIT v_max
  LOOP
    v_processed := v_processed + 1;
    BEGIN
      SELECT * INTO v_cust
      FROM public.bookings_create_or_get_portal_customer (
        r.business_id,
        r.phone,
        r.email,
        r.first_name,
        r.last_name,
        NULL::text
      )
      LIMIT 1;

      IF v_cust.id IS NOT NULL THEN
        UPDATE public.legacy_waivers
        SET customer_id = v_cust.id
        WHERE id = r.id;

        v_linked := v_linked + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object (
    'processed', v_processed,
    'linked', v_linked,
    'skipped', v_skipped
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.legacy_waivers_link_or_create_pos_customers (uuid, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.legacy_waivers_link_or_create_pos_customers (uuid, integer) FROM PUBLIC;
