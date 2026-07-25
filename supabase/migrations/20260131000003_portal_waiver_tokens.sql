-- Portal waiver tokens: allow booking portal to pass customer + participants to waiver flow
-- so user doesn't re-enter phone/OTP or participant info (single-use, short-lived token).

-- Table: one-time tokens for "Complete waivers" from booking portal
CREATE TABLE IF NOT EXISTS portal_waiver_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  customer_id UUID NOT NULL REFERENCES pos_loyalty_accounts(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  return_url TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_waiver_tokens_token ON portal_waiver_tokens(token) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_portal_waiver_tokens_expires ON portal_waiver_tokens(expires_at);

COMMENT ON TABLE portal_waiver_tokens IS 'Single-use tokens for waiver flow from booking portal; resolves to customer + participants.';

-- RPC: Create a portal waiver token (called by booking portal when user clicks "Complete waivers")
CREATE OR REPLACE FUNCTION public.bookings_create_portal_waiver_token(
  p_customer_id UUID,
  p_business_id UUID,
  p_return_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token UUID;
  v_row portal_waiver_tokens%ROWTYPE;
BEGIN
  -- Validate: customer must belong to business (same as bookings_get_portal_participants)
  IF NOT EXISTS (
    SELECT 1 FROM pos_loyalty_accounts
    WHERE id = p_customer_id AND business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Invalid customer or business';
  END IF;

  INSERT INTO portal_waiver_tokens (customer_id, business_id, return_url)
  VALUES (p_customer_id, p_business_id, p_return_url)
  RETURNING token INTO v_token;

  RETURN jsonb_build_object('token', v_token);
END;
$$;

COMMENT ON FUNCTION public.bookings_create_portal_waiver_token IS 'Create single-use token for waiver flow from booking portal; returns token for URL.';

GRANT EXECUTE ON FUNCTION public.bookings_create_portal_waiver_token(UUID, UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.bookings_create_portal_waiver_token(UUID, UUID, TEXT) TO authenticated;

-- RPC: Resolve portal token and return customer + participants (called by waiver flow on load)
-- Returns: customer_id, phone_number, email, return_url, participants (array of {id, first_name, last_name, date_of_birth, participant_type, is_account_owner})
CREATE OR REPLACE FUNCTION public.waiver_resolve_portal_token(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row portal_waiver_tokens%ROWTYPE;
  v_customer_email TEXT;
  v_customer_phone TEXT;
  v_participants JSONB := '[]'::jsonb;
  v_part RECORD;
BEGIN
  SELECT * INTO v_row
  FROM portal_waiver_tokens
  WHERE token = p_token
    AND used_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Invalid or expired token');
  END IF;

  -- Mark token used immediately (single-use)
  UPDATE portal_waiver_tokens SET used_at = now() WHERE token = p_token;

  -- Customer contact from pos_loyalty_accounts (id = customer_id, business_id)
  SELECT customer_email, customer_phone INTO v_customer_email, v_customer_phone
  FROM pos_loyalty_accounts
  WHERE id = v_row.customer_id AND business_id = v_row.business_id;

  -- Participants: from waiver_participants for this customer/business (same as bookings_get_portal_participants)
  FOR v_part IN
    SELECT id, first_name, last_name, date_of_birth, participant_type, is_account_owner
    FROM waiver_participants
    WHERE customer_id = v_row.customer_id
      AND business_id = v_row.business_id
      AND COALESCE(is_active, true) = true
    ORDER BY is_account_owner DESC NULLS LAST, created_at ASC
  LOOP
    v_participants := v_participants || jsonb_build_object(
      'id', v_part.id,
      'first_name', v_part.first_name,
      'last_name', v_part.last_name,
      'date_of_birth', v_part.date_of_birth,
      'participant_type', COALESCE(v_part.participant_type, CASE WHEN v_part.is_account_owner THEN 'primary' ELSE 'additional_adult' END),
      'is_account_owner', COALESCE(v_part.is_account_owner, false)
    );
  END LOOP;

  -- If no rows from waiver_participants, try booking_customer_participants (portal may have only that)
  -- booking_customer_participants has no participant_type; derive from is_account_owner
  IF jsonb_array_length(v_participants) = 0 THEN
    FOR v_part IN
      SELECT id, first_name, last_name, date_of_birth, is_account_owner
      FROM booking_customer_participants
      WHERE customer_id = v_row.customer_id
        AND business_id = v_row.business_id
        AND COALESCE(is_active, true) = true
      ORDER BY is_account_owner DESC NULLS LAST, created_at ASC
    LOOP
      v_participants := v_participants || jsonb_build_object(
        'id', v_part.id,
        'first_name', v_part.first_name,
        'last_name', v_part.last_name,
        'date_of_birth', v_part.date_of_birth,
        'participant_type', CASE WHEN COALESCE(v_part.is_account_owner, false) THEN 'primary' ELSE 'additional_adult' END,
        'is_account_owner', COALESCE(v_part.is_account_owner, false)
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'customer_id', v_row.customer_id,
    'business_id', v_row.business_id,
    'phone_number', v_customer_phone,
    'email', v_customer_email,
    'return_url', v_row.return_url,
    'participants', v_participants
  );
END;
$$;

COMMENT ON FUNCTION public.waiver_resolve_portal_token IS 'Resolve portal waiver token; returns customer + participants for pre-fill. Single-use.';

GRANT EXECUTE ON FUNCTION public.waiver_resolve_portal_token(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.waiver_resolve_portal_token(UUID) TO authenticated;
