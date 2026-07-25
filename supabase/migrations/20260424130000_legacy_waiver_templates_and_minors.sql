-- Legacy Wallkids (and similar) template text keyed by old template id, plus rich minor rows on legacy_waivers.

CREATE TABLE IF NOT EXISTS public.legacy_waiver_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  source_system text NOT NULL DEFAULT 'wallkids',
  legacy_template_id integer NOT NULL,
  title text NOT NULL DEFAULT 'Legacy template',
  waiver_content text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legacy_waiver_templates_business_source_template_unique UNIQUE (business_id, source_system, legacy_template_id)
);

CREATE INDEX IF NOT EXISTS idx_legacy_waiver_templates_business ON public.legacy_waiver_templates (business_id);

COMMENT ON TABLE public.legacy_waiver_templates IS
  'HTML/text for legacy waiver templates; maps MySQL waiver_template_id from imports.';

COMMENT ON COLUMN public.legacy_waiver_templates.legacy_template_id IS
  'Integer ID from source system (e.g. wallkids.waivers.waiver_template_id).';

ALTER TABLE public.legacy_waivers
ADD COLUMN IF NOT EXISTS legacy_minors jsonb;

COMMENT ON COLUMN public.legacy_waivers.legacy_minors IS
  'Optional JSON array of minors (first_name, last_name, date_of_birth, legacy_customer_id, signature_strokes) from joined import.';

ALTER TABLE public.legacy_waiver_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS legacy_waiver_templates_select ON public.legacy_waiver_templates;
DROP POLICY IF EXISTS legacy_waiver_templates_insert ON public.legacy_waiver_templates;
DROP POLICY IF EXISTS legacy_waiver_templates_update ON public.legacy_waiver_templates;
DROP POLICY IF EXISTS legacy_waiver_templates_delete ON public.legacy_waiver_templates;

CREATE POLICY legacy_waiver_templates_select ON public.legacy_waiver_templates FOR
SELECT
  TO authenticated USING (
    EXISTS (
      SELECT
        1
      FROM
        public.business_users bu
      WHERE
        bu.user_id = auth.uid ()
        AND bu.business_id = legacy_waiver_templates.business_id
    )
    OR EXISTS (
      SELECT
        1
      FROM
        public.user_roles ur
      WHERE
        ur.user_id = auth.uid ()
        AND ur.active = true
        AND ur.business_id = legacy_waiver_templates.business_id
    )
  );

CREATE POLICY legacy_waiver_templates_insert ON public.legacy_waiver_templates FOR INSERT TO authenticated
WITH
  CHECK (
    EXISTS (
      SELECT
        1
      FROM
        public.business_users bu
      WHERE
        bu.user_id = auth.uid ()
        AND bu.business_id = legacy_waiver_templates.business_id
    )
    OR EXISTS (
      SELECT
        1
      FROM
        public.user_roles ur
      WHERE
        ur.user_id = auth.uid ()
        AND ur.active = true
        AND ur.business_id = legacy_waiver_templates.business_id
    )
  );

CREATE POLICY legacy_waiver_templates_update ON public.legacy_waiver_templates FOR
UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT
        1
      FROM
        public.business_users bu
      WHERE
        bu.user_id = auth.uid ()
        AND bu.business_id = legacy_waiver_templates.business_id
    )
    OR EXISTS (
      SELECT
        1
      FROM
        public.user_roles ur
      WHERE
        ur.user_id = auth.uid ()
        AND ur.active = true
        AND ur.business_id = legacy_waiver_templates.business_id
    )
  )
WITH
  CHECK (
    EXISTS (
      SELECT
        1
      FROM
        public.business_users bu
      WHERE
        bu.user_id = auth.uid ()
        AND bu.business_id = legacy_waiver_templates.business_id
    )
    OR EXISTS (
      SELECT
        1
      FROM
        public.user_roles ur
      WHERE
        ur.user_id = auth.uid ()
        AND ur.active = true
        AND ur.business_id = legacy_waiver_templates.business_id
    )
  );

CREATE POLICY legacy_waiver_templates_delete ON public.legacy_waiver_templates FOR DELETE TO authenticated USING (
  EXISTS (
    SELECT
      1
    FROM
      public.business_users bu
    WHERE
      bu.user_id = auth.uid ()
      AND bu.business_id = legacy_waiver_templates.business_id
  )
  OR EXISTS (
    SELECT
      1
    FROM
      public.user_roles ur
    WHERE
      ur.user_id = auth.uid ()
      AND ur.active = true
      AND ur.business_id = legacy_waiver_templates.business_id
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.legacy_waiver_templates TO authenticated;
