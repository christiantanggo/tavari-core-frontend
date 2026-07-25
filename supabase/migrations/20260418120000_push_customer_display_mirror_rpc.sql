-- Single write path for POS → customer display mirror. Server strips sale_complete / receipt_navigation
-- whenever the cart payload has line items so stale completion blobs cannot blank a live cart.

CREATE OR REPLACE FUNCTION public.push_customer_display_mirror (
  p_business_id uuid,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cleaned jsonb;
  cart_raw jsonb;
  cartdoc jsonb;
  n int;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.business_id = p_business_id
      AND bu.user_id = auth.uid ()
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  cleaned := COALESCE(p_payload, '{}'::jsonb);
  cart_raw := cleaned -> 'cart';
  cartdoc := NULL;

  IF cart_raw IS NOT NULL AND jsonb_typeof(cart_raw) <> 'null' THEN
    IF jsonb_typeof(cart_raw) = 'string' THEN
      BEGIN
        cartdoc := (cleaned ->> 'cart')::jsonb;
      EXCEPTION
        WHEN OTHERS THEN
          cartdoc := NULL;
      END;
    ELSIF jsonb_typeof(cart_raw) = 'object' THEN
      cartdoc := cart_raw;
    END IF;
  END IF;

  IF cartdoc IS NOT NULL
  AND cartdoc ? 'cartItems'
  AND jsonb_typeof(cartdoc -> 'cartItems') = 'array' THEN
    n := jsonb_array_length(cartdoc -> 'cartItems');
    IF n > 0 THEN
      cleaned := cleaned - 'sale_complete' - 'receipt_navigation';
    END IF;
  END IF;

  INSERT INTO public.pos_customer_display_mirror (business_id, payload, updated_at)
    VALUES (p_business_id, cleaned, now())
  ON CONFLICT (business_id) DO UPDATE
    SET payload = EXCLUDED.payload,
        updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.push_customer_display_mirror (uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.push_customer_display_mirror (uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.push_customer_display_mirror (uuid, jsonb) IS 'Authenticated POS push for customer display mirror; clears completion keys when cart has items.';
