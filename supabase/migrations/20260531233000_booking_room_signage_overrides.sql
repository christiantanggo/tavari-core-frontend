-- Booking room/resource assignment + signage override support.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS duration_minutes integer,
  ADD COLUMN IF NOT EXISTS extended_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS booking_end_time time without time zone,
  ADD COLUMN IF NOT EXISTS extension_reason text,
  ADD COLUMN IF NOT EXISTS extended_at timestamptz,
  ADD COLUMN IF NOT EXISTS extended_by uuid;

CREATE TABLE IF NOT EXISTS public.booking_resource_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  category_id text NOT NULL,
  resource_id text NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('schedule', 'manual', 'override')),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (booking_id, category_id, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_resource_assignments_business
  ON public.booking_resource_assignments(business_id);

CREATE INDEX IF NOT EXISTS idx_booking_resource_assignments_booking
  ON public.booking_resource_assignments(booking_id);

CREATE INDEX IF NOT EXISTS idx_booking_resource_assignments_resource
  ON public.booking_resource_assignments(business_id, category_id, resource_id);

ALTER TABLE public.booking_resource_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_resource_assignments_select" ON public.booking_resource_assignments;
DROP POLICY IF EXISTS "booking_resource_assignments_insert" ON public.booking_resource_assignments;
DROP POLICY IF EXISTS "booking_resource_assignments_update" ON public.booking_resource_assignments;
DROP POLICY IF EXISTS "booking_resource_assignments_delete" ON public.booking_resource_assignments;

CREATE POLICY "booking_resource_assignments_select"
  ON public.booking_resource_assignments
  FOR SELECT
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id));

CREATE POLICY "booking_resource_assignments_insert"
  ON public.booking_resource_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_digital_signage_business_member(business_id));

CREATE POLICY "booking_resource_assignments_update"
  ON public.booking_resource_assignments
  FOR UPDATE
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id))
  WITH CHECK (public.is_digital_signage_business_member(business_id));

CREATE POLICY "booking_resource_assignments_delete"
  ON public.booking_resource_assignments
  FOR DELETE
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id));

CREATE TABLE IF NOT EXISTS public.booking_time_extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  previous_end_time time without time zone,
  new_end_time time without time zone NOT NULL,
  added_minutes integer NOT NULL DEFAULT 0,
  extension_type text NOT NULL DEFAULT 'courtesy' CHECK (extension_type IN ('paid', 'courtesy', 'operational')),
  reason text,
  amount_charged numeric(10, 2),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_booking_time_extensions_booking
  ON public.booking_time_extensions(booking_id, created_at DESC);

ALTER TABLE public.booking_time_extensions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_time_extensions_select" ON public.booking_time_extensions;
DROP POLICY IF EXISTS "booking_time_extensions_insert" ON public.booking_time_extensions;

CREATE POLICY "booking_time_extensions_select"
  ON public.booking_time_extensions
  FOR SELECT
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id));

CREATE POLICY "booking_time_extensions_insert"
  ON public.booking_time_extensions
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_digital_signage_business_member(business_id));

CREATE OR REPLACE FUNCTION public.replace_booking_resource_assignments(
  booking_uuid uuid,
  business_uuid uuid,
  assignments jsonb DEFAULT '[]'::jsonb,
  assignment_source text DEFAULT 'manual'
)
RETURNS void AS $$
DECLARE
  item jsonb;
BEGIN
  IF jsonb_typeof(assignments) <> 'array' THEN
    RAISE EXCEPTION 'assignments must be an array';
  END IF;

  IF assignment_source NOT IN ('schedule', 'manual', 'override') THEN
    RAISE EXCEPTION 'invalid assignment source';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.id = booking_uuid
      AND b.business_id = business_uuid
      AND public.is_digital_signage_business_member(b.business_id)
  ) THEN
    RAISE EXCEPTION 'Booking not found or access denied';
  END IF;

  DELETE FROM public.booking_resource_assignments
  WHERE booking_id = booking_uuid
    AND business_id = business_uuid;

  FOR item IN SELECT * FROM jsonb_array_elements(assignments)
  LOOP
    IF NULLIF(item->>'categoryId', '') IS NULL OR NULLIF(item->>'resourceId', '') IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.booking_resource_assignments (
      business_id,
      booking_id,
      category_id,
      resource_id,
      source,
      notes,
      created_by
    )
    VALUES (
      business_uuid,
      booking_uuid,
      item->>'categoryId',
      item->>'resourceId',
      assignment_source,
      NULLIF(item->>'notes', ''),
      auth.uid()
    )
    ON CONFLICT (booking_id, category_id, resource_id) DO UPDATE
      SET source = EXCLUDED.source,
          notes = EXCLUDED.notes,
          updated_at = timezone('utc'::text, now());
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.extend_booking_time(
  booking_uuid uuid,
  business_uuid uuid,
  added_minutes_param integer,
  extension_type_param text DEFAULT 'courtesy',
  reason_param text DEFAULT NULL,
  amount_charged_param numeric DEFAULT NULL
)
RETURNS public.bookings AS $$
DECLARE
  b public.bookings;
  duration_minutes_val integer;
  previous_end time without time zone;
  new_end time without time zone;
BEGIN
  IF added_minutes_param IS NULL OR added_minutes_param = 0 THEN
    RAISE EXCEPTION 'added_minutes must not be zero';
  END IF;

  IF extension_type_param NOT IN ('paid', 'courtesy', 'operational') THEN
    RAISE EXCEPTION 'invalid extension type';
  END IF;

  SELECT *
  INTO b
  FROM public.bookings
  WHERE id = booking_uuid
    AND business_id = business_uuid
    AND public.is_digital_signage_business_member(business_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found or access denied';
  END IF;

  SELECT COALESCE(b.duration_minutes, a.duration_minutes, 60)
  INTO duration_minutes_val
  FROM public.booking_activities a
  WHERE a.id = b.activity_id;

  previous_end := COALESCE(
    b.booking_end_time,
    (b.booking_time + make_interval(mins => duration_minutes_val + COALESCE(b.extended_minutes, 0)))::time
  );
  new_end := (previous_end + make_interval(mins => added_minutes_param))::time;

  UPDATE public.bookings
  SET duration_minutes = COALESCE(duration_minutes, duration_minutes_val),
      extended_minutes = COALESCE(extended_minutes, 0) + added_minutes_param,
      booking_end_time = new_end,
      extension_reason = reason_param,
      extended_at = timezone('utc'::text, now()),
      extended_by = auth.uid(),
      updated_at = timezone('utc'::text, now())
  WHERE id = booking_uuid
    AND business_id = business_uuid
  RETURNING * INTO b;

  INSERT INTO public.booking_time_extensions (
    business_id,
    booking_id,
    previous_end_time,
    new_end_time,
    added_minutes,
    extension_type,
    reason,
    amount_charged,
    created_by
  )
  VALUES (
    business_uuid,
    booking_uuid,
    previous_end,
    new_end,
    added_minutes_param,
    extension_type_param,
    reason_param,
    amount_charged_param,
    auth.uid()
  );

  RETURN b;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.replace_booking_resource_assignments(uuid, uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.extend_booking_time(uuid, uuid, integer, text, text, numeric) TO authenticated;
