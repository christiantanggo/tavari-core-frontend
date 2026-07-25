-- Repair: ensure settlements table exists before verification columns/policies.
-- Run if 20260701160000 was applied before 20260701140000 (relation does not exist).

CREATE TABLE IF NOT EXISTS public.pullcoparent_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.pullcoparent_households(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  to_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  amount numeric(10, 2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_user_id <> to_user_id)
);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_settlements_household_date
  ON public.pullcoparent_settlements (household_id, payment_date DESC);

DROP TRIGGER IF EXISTS trg_pullcoparent_settlements_updated_at ON public.pullcoparent_settlements;
CREATE TRIGGER trg_pullcoparent_settlements_updated_at
BEFORE UPDATE ON public.pullcoparent_settlements
FOR EACH ROW EXECUTE FUNCTION public.pullcoparent_touch_updated_at();

ALTER TABLE public.pullcoparent_settlements ENABLE ROW LEVEL SECURITY;

-- Verification columns (no-op if already present)
ALTER TABLE public.pullcoparent_settlements
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_expense_id uuid REFERENCES public.pullcoparent_expenses(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pullcoparent_settlements_status_check'
  ) THEN
    ALTER TABLE public.pullcoparent_settlements
      ADD CONSTRAINT pullcoparent_settlements_status_check
      CHECK (status IN ('pending', 'confirmed', 'declined'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pullcoparent_settlements_status
  ON public.pullcoparent_settlements (household_id, status, payment_date DESC);

DROP POLICY IF EXISTS pullcoparent_settlements_all_member ON public.pullcoparent_settlements;

DROP POLICY IF EXISTS pullcoparent_settlements_select_member ON public.pullcoparent_settlements;
CREATE POLICY pullcoparent_settlements_select_member ON public.pullcoparent_settlements
  FOR SELECT TO authenticated
  USING (public.pullcoparent_is_household_member(household_id));

DROP POLICY IF EXISTS pullcoparent_settlements_insert_member ON public.pullcoparent_settlements;
CREATE POLICY pullcoparent_settlements_insert_member ON public.pullcoparent_settlements
  FOR INSERT TO authenticated
  WITH CHECK (
    public.pullcoparent_is_household_member(household_id)
    AND created_by = auth.uid()
    AND status = 'pending'
  );

DROP POLICY IF EXISTS pullcoparent_settlements_delete_pending_sender ON public.pullcoparent_settlements;
CREATE POLICY pullcoparent_settlements_delete_pending_sender ON public.pullcoparent_settlements
  FOR DELETE TO authenticated
  USING (
    public.pullcoparent_is_household_member(household_id)
    AND status = 'pending'
    AND from_user_id = auth.uid()
  );

GRANT SELECT, INSERT, DELETE ON public.pullcoparent_settlements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pullcoparent_settlements TO service_role;

NOTIFY pgrst, 'reload schema';
