-- Bookings hardening and self-service support
-- Align versioned schema with the live bookings module and add public self-service management tokens.

-- ============================================
-- BOOKINGS STATUS / CHECK-IN
-- ============================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bookings_status_check'
      AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE public.bookings DROP CONSTRAINT bookings_status_check;
  END IF;

  ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_status_check
    CHECK (status IN ('pending', 'confirmed', 'checked_in', 'cancelled', 'completed', 'no_show'));
END $$;

-- ============================================
-- BOOKING PARTICIPANTS TABLE ALIGNMENT
-- ============================================
ALTER TABLE public.booking_participants
  ADD COLUMN IF NOT EXISTS participant_id UUID,
  ADD COLUMN IF NOT EXISTS inventory_item_id UUID;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.booking_participants ALTER COLUMN first_name DROP NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  BEGIN
    ALTER TABLE public.booking_participants ALTER COLUMN last_name DROP NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'booking_customer_participants'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_participants_participant_id_fkey'
      AND conrelid = 'public.booking_participants'::regclass
  ) THEN
    ALTER TABLE public.booking_participants
      ADD CONSTRAINT booking_participants_participant_id_fkey
      FOREIGN KEY (participant_id)
      REFERENCES public.booking_customer_participants(id)
      ON DELETE SET NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'pos_inventory'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_participants_inventory_item_id_fkey'
      AND conrelid = 'public.booking_participants'::regclass
  ) THEN
    ALTER TABLE public.booking_participants
      ADD CONSTRAINT booking_participants_inventory_item_id_fkey
      FOREIGN KEY (inventory_item_id)
      REFERENCES public.pos_inventory(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_booking_participants_participant_id
  ON public.booking_participants(participant_id)
  WHERE participant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_participants_inventory_item_id
  ON public.booking_participants(inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;

-- ============================================
-- CONCURRENCY-SAFE BOOKING NUMBERS
-- ============================================
CREATE OR REPLACE FUNCTION public.generate_booking_number(business_uuid UUID)
RETURNS TEXT AS $$
DECLARE
  business_prefix TEXT;
  next_number INTEGER;
BEGIN
  business_prefix := SUBSTRING(business_uuid::TEXT, 1, 8);

  PERFORM pg_advisory_xact_lock(hashtext(business_uuid::TEXT), 0);

  SELECT COALESCE(
    MAX(NULLIF(SPLIT_PART(booking_number, '-', 3), '')::INTEGER),
    0
  ) + 1
  INTO next_number
  FROM public.bookings
  WHERE business_id = business_uuid
    AND booking_number LIKE 'BK-' || business_prefix || '-%';

  RETURN 'BK-' || business_prefix || '-' || LPAD(next_number::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.generate_booking_number(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_booking_number(UUID) TO anon;

CREATE OR REPLACE FUNCTION public.update_session_capacity()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    IF NEW.session_id IS NOT NULL THEN
      UPDATE public.booking_sessions
      SET current_bookings = (
        SELECT COUNT(*)
        FROM public.bookings
        WHERE session_id = NEW.session_id
          AND status IN ('pending', 'confirmed', 'checked_in')
      )
      WHERE id = NEW.session_id;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.session_id IS NOT NULL THEN
      UPDATE public.booking_sessions
      SET current_bookings = (
        SELECT COUNT(*)
        FROM public.bookings
        WHERE session_id = OLD.session_id
          AND status IN ('pending', 'confirmed', 'checked_in')
      )
      WHERE id = OLD.session_id;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PORTAL PARTICIPANTS RPCS
-- ============================================
ALTER TABLE public.waiver_participants
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.pos_loyalty_accounts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_account_owner BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.waiver_participants ALTER COLUMN waiver_id DROP NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
END $$;

CREATE INDEX IF NOT EXISTS idx_waiver_participants_customer_business
  ON public.waiver_participants(customer_id, business_id)
  WHERE customer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.bookings_get_portal_participants(p_customer_id UUID, p_business_id UUID)
RETURNS SETOF public.waiver_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.pos_loyalty_accounts
    WHERE id = p_customer_id AND business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Invalid customer or business';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.waiver_participants
  WHERE customer_id = p_customer_id
    AND business_id = p_business_id
    AND COALESCE(is_active, true) = true
  ORDER BY is_account_owner DESC NULLS LAST, created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.bookings_add_portal_participant(
  p_customer_id UUID,
  p_business_id UUID,
  p_first_name TEXT,
  p_last_name TEXT,
  p_date_of_birth DATE DEFAULT NULL,
  p_participant_type TEXT DEFAULT 'additional_adult'
)
RETURNS SETOF public.waiver_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.pos_loyalty_accounts
    WHERE id = p_customer_id AND business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Invalid customer or business';
  END IF;

  RETURN QUERY
  INSERT INTO public.waiver_participants (
    customer_id,
    business_id,
    participant_type,
    first_name,
    last_name,
    date_of_birth,
    is_active,
    is_account_owner,
    waiver_id
  )
  VALUES (
    p_customer_id,
    p_business_id,
    COALESCE(NULLIF(TRIM(p_participant_type), ''), 'additional_adult'),
    p_first_name,
    p_last_name,
    p_date_of_birth,
    true,
    false,
    NULL
  )
  RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.bookings_upsert_portal_participant_owner(
  p_customer_id UUID,
  p_business_id UUID,
  p_first_name TEXT,
  p_last_name TEXT,
  p_date_of_birth DATE DEFAULT NULL
)
RETURNS SETOF public.waiver_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.waiver_participants;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.pos_loyalty_accounts
    WHERE id = p_customer_id AND business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Invalid customer or business';
  END IF;

  UPDATE public.waiver_participants
  SET first_name = p_first_name,
      last_name = p_last_name,
      date_of_birth = p_date_of_birth,
      updated_at = now()
  WHERE customer_id = p_customer_id
    AND business_id = p_business_id
    AND is_account_owner = true
    AND COALESCE(is_active, true) = true
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN NEXT v_row;
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO public.waiver_participants (
    customer_id,
    business_id,
    participant_type,
    first_name,
    last_name,
    date_of_birth,
    is_active,
    is_account_owner,
    waiver_id
  )
  VALUES (
    p_customer_id,
    p_business_id,
    'primary',
    p_first_name,
    p_last_name,
    p_date_of_birth,
    true,
    true,
    NULL
  )
  RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.bookings_update_portal_participant(
  p_customer_id UUID,
  p_business_id UUID,
  p_participant_id UUID,
  p_first_name TEXT,
  p_last_name TEXT,
  p_date_of_birth DATE DEFAULT NULL
)
RETURNS SETOF public.waiver_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.pos_loyalty_accounts
    WHERE id = p_customer_id AND business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Invalid customer or business';
  END IF;

  RETURN QUERY
  UPDATE public.waiver_participants
  SET first_name = p_first_name,
      last_name = p_last_name,
      date_of_birth = p_date_of_birth,
      updated_at = now()
  WHERE id = p_participant_id
    AND customer_id = p_customer_id
    AND business_id = p_business_id
  RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.bookings_delete_portal_participant(
  p_customer_id UUID,
  p_business_id UUID,
  p_participant_id UUID
)
RETURNS SETOF public.waiver_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.pos_loyalty_accounts
    WHERE id = p_customer_id AND business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Invalid customer or business';
  END IF;

  RETURN QUERY
  UPDATE public.waiver_participants
  SET is_active = false,
      updated_at = now()
  WHERE id = p_participant_id
    AND customer_id = p_customer_id
    AND business_id = p_business_id
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bookings_get_portal_participants(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bookings_add_portal_participant(UUID, UUID, TEXT, TEXT, DATE, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bookings_upsert_portal_participant_owner(UUID, UUID, TEXT, TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bookings_update_portal_participant(UUID, UUID, UUID, TEXT, TEXT, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bookings_delete_portal_participant(UUID, UUID, UUID) TO anon, authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'booking_customer_participants'
  ) THEN
    DROP POLICY IF EXISTS booking_customer_participants_select_anon_portal ON public.booking_customer_participants;
    CREATE POLICY booking_customer_participants_select_anon_portal
      ON public.booking_customer_participants
      FOR SELECT
      TO anon
      USING (customer_id IS NOT NULL AND business_id IS NOT NULL);
  END IF;
END $$;

-- ============================================
-- BOOKING SELF-SERVICE TOKENS
-- ============================================
CREATE TABLE IF NOT EXISTS public.booking_self_service_tokens (
  token TEXT PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_self_service_tokens_booking_id
  ON public.booking_self_service_tokens(booking_id);

CREATE INDEX IF NOT EXISTS idx_booking_self_service_tokens_active
  ON public.booking_self_service_tokens(business_id, booking_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.booking_self_service_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access booking_self_service_tokens" ON public.booking_self_service_tokens;
CREATE POLICY "Service role full access booking_self_service_tokens"
  ON public.booking_self_service_tokens
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
