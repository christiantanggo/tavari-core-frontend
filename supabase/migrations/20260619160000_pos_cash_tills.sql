-- Cash tills for daily deposit counts (separate from kitchen/POS stations)
CREATE TABLE IF NOT EXISTS public.pos_cash_tills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  float_amount numeric(10, 2) NOT NULL DEFAULT 200.00,
  pos_terminal_id text NULL,
  sort_order integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS pos_cash_tills_business_id_idx
  ON public.pos_cash_tills (business_id);

CREATE INDEX IF NOT EXISTS pos_cash_tills_business_active_sort_idx
  ON public.pos_cash_tills (business_id, is_active, sort_order);

ALTER TABLE public.pos_cash_tills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can access cash tills for their business" ON public.pos_cash_tills;
CREATE POLICY "Users can access cash tills for their business"
  ON public.pos_cash_tills
  FOR ALL
  USING (
    business_id IN (
      SELECT user_roles.business_id
      FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.active = true
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT user_roles.business_id
      FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.active = true
    )
  );

COMMENT ON TABLE public.pos_cash_tills IS 'Physical cash tills counted during daily deposit (may optionally link to a POS terminal for expected totals).';
COMMENT ON COLUMN public.pos_cash_tills.pos_terminal_id IS 'Optional pos_sales.terminal_id used to calculate expected cash for this till.';
