-- Saved Dividend Income projection scenarios (per personal business)

CREATE TABLE IF NOT EXISTS public.div_projection_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);

CREATE INDEX IF NOT EXISTS idx_div_projection_scenarios_business
  ON public.div_projection_scenarios (business_id, updated_at DESC);

ALTER TABLE public.div_projection_scenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS div_projection_scenarios_select ON public.div_projection_scenarios;
CREATE POLICY div_projection_scenarios_select
  ON public.div_projection_scenarios FOR SELECT TO authenticated
  USING (public.div_is_business_member(business_id));

DROP POLICY IF EXISTS div_projection_scenarios_insert ON public.div_projection_scenarios;
CREATE POLICY div_projection_scenarios_insert
  ON public.div_projection_scenarios FOR INSERT TO authenticated
  WITH CHECK (public.div_is_business_manager(business_id));

DROP POLICY IF EXISTS div_projection_scenarios_update ON public.div_projection_scenarios;
CREATE POLICY div_projection_scenarios_update
  ON public.div_projection_scenarios FOR UPDATE TO authenticated
  USING (public.div_is_business_manager(business_id))
  WITH CHECK (public.div_is_business_manager(business_id));

DROP POLICY IF EXISTS div_projection_scenarios_delete ON public.div_projection_scenarios;
CREATE POLICY div_projection_scenarios_delete
  ON public.div_projection_scenarios FOR DELETE TO authenticated
  USING (public.div_is_business_manager(business_id));
