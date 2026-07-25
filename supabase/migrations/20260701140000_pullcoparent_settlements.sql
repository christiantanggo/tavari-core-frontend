-- Pull Together: Co-Parent — reimbursements between parents (settlements)

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

DROP POLICY IF EXISTS pullcoparent_settlements_all_member ON public.pullcoparent_settlements;
CREATE POLICY pullcoparent_settlements_all_member ON public.pullcoparent_settlements
  FOR ALL TO authenticated
  USING (public.pullcoparent_is_household_member(household_id))
  WITH CHECK (public.pullcoparent_is_household_member(household_id));
