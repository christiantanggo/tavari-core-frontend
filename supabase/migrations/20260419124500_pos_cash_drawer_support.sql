ALTER TABLE public.pos_settings
  ADD COLUMN IF NOT EXISTS drawer_manager_pin_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS drawer_open_reasons TEXT[] NOT NULL DEFAULT ARRAY['No Sale', 'Change Request', 'Till Check', 'Manager Request', 'Refund', 'Other'],
  ADD COLUMN IF NOT EXISTS default_float_amount NUMERIC(10,2) NOT NULL DEFAULT 200.00,
  ADD COLUMN IF NOT EXISTS max_drawer_variance NUMERIC(10,2) NOT NULL DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS require_manager_pin_for_variance BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.pos_drawers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  terminal_id TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  opened_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  closed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  manager_approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  manager_override_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  starting_cash NUMERIC(10,2) NOT NULL DEFAULT 0,
  expected_cash NUMERIC(10,2),
  actual_cash NUMERIC(10,2),
  variance NUMERIC(10,2),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  open_reason TEXT,
  open_notes TEXT,
  close_notes TEXT,
  notes TEXT,
  manager_approval_required BOOLEAN NOT NULL DEFAULT false,
  manager_override_required BOOLEAN NOT NULL DEFAULT false,
  requires_recount BOOLEAN NOT NULL DEFAULT false,
  cash_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pos_drawers_business_opened_at
  ON public.pos_drawers (business_id, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_drawers_business_terminal
  ON public.pos_drawers (business_id, terminal_id);

CREATE INDEX IF NOT EXISTS idx_pos_drawers_open_sessions
  ON public.pos_drawers (business_id, terminal_id)
  WHERE closed_at IS NULL;

ALTER TABLE public.pos_drawers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_drawers_select_by_business ON public.pos_drawers;
CREATE POLICY pos_drawers_select_by_business
  ON public.pos_drawers
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = pos_drawers.business_id
        AND bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS pos_drawers_insert_by_business ON public.pos_drawers;
CREATE POLICY pos_drawers_insert_by_business
  ON public.pos_drawers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = pos_drawers.business_id
        AND bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS pos_drawers_update_by_business ON public.pos_drawers;
CREATE POLICY pos_drawers_update_by_business
  ON public.pos_drawers
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = pos_drawers.business_id
        AND bu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = pos_drawers.business_id
        AND bu.user_id = auth.uid()
    )
  );
