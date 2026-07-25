-- Imported waiver rows from pre-Tavari systems (e.g. MySQL `wallkids.waivers`).
-- Read/merged in the app with public.waiver_signatures; not used for new signings.

CREATE TABLE IF NOT EXISTS public.legacy_waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  source_system text NOT NULL DEFAULT 'wallkids',
  legacy_row_id bigint,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  date_of_birth date,
  signature_strokes text,
  notes text,
  info text,
  num_minors integer NOT NULL DEFAULT 0,
  legacy_user_id integer,
  legacy_location_id integer,
  legacy_waiver_template_id integer,
  legacy_customer_id integer,
  signed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legacy_waivers_business_legacy_id_unique UNIQUE (business_id, legacy_row_id)
);

CREATE INDEX IF NOT EXISTS idx_legacy_waivers_business_signed
  ON public.legacy_waivers (business_id, signed_at DESC NULLS LAST);

COMMENT ON TABLE public.legacy_waivers IS
  'Historical waivers imported from other systems. Shown in dashboard with Tavari waivers.';

ALTER TABLE public.legacy_waivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS legacy_waivers_select_business ON public.legacy_waivers;
DROP POLICY IF EXISTS legacy_waivers_insert_business ON public.legacy_waivers;
DROP POLICY IF EXISTS legacy_waivers_update_business ON public.legacy_waivers;
DROP POLICY IF EXISTS legacy_waivers_delete_business ON public.legacy_waivers;

CREATE POLICY legacy_waivers_select_business
  ON public.legacy_waivers
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
        AND bu.business_id = legacy_waivers.business_id
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.business_id = legacy_waivers.business_id
    )
  );

CREATE POLICY legacy_waivers_insert_business
  ON public.legacy_waivers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
        AND bu.business_id = legacy_waivers.business_id
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.business_id = legacy_waivers.business_id
    )
  );

CREATE POLICY legacy_waivers_update_business
  ON public.legacy_waivers
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
        AND bu.business_id = legacy_waivers.business_id
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.business_id = legacy_waivers.business_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
        AND bu.business_id = legacy_waivers.business_id
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.business_id = legacy_waivers.business_id
    )
  );

CREATE POLICY legacy_waivers_delete_business
  ON public.legacy_waivers
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
        AND bu.business_id = legacy_waivers.business_id
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.business_id = legacy_waivers.business_id
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.legacy_waivers TO authenticated;
