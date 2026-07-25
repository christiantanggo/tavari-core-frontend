-- Idempotent repair for common pullcoparent schema drift (registered-but-not-applied migrations)

-- Settlements table (if verification ran before base migration)
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

ALTER TABLE public.pullcoparent_settlements
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_expense_id uuid REFERENCES public.pullcoparent_expenses(id) ON DELETE SET NULL;

ALTER TABLE public.pullcoparent_profiles
  ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.pullcoparent_child_wants
  ADD COLUMN IF NOT EXISTS event_time time;

-- Child wants table if missing entirely
CREATE TABLE IF NOT EXISTS public.pullcoparent_child_wants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.pullcoparent_households(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES public.pullcoparent_children(id) ON DELETE CASCADE,
  want_type text NOT NULL DEFAULT 'other',
  title text NOT NULL,
  notes text,
  contact_info text,
  event_date date,
  event_time time,
  estimated_cost numeric(10, 2) CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  document_path text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  decision_note text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pullcoparent_child_wants DROP CONSTRAINT IF EXISTS pullcoparent_child_wants_want_type_check;
ALTER TABLE public.pullcoparent_child_wants
  ADD CONSTRAINT pullcoparent_child_wants_want_type_check
  CHECK (want_type IN ('hangout', 'gift', 'activity', 'other'));

-- Premium check: include trialing (match client hook)
CREATE OR REPLACE FUNCTION public.pullcoparent_household_has_premium(p_household_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pullcoparent_subscriptions s
    WHERE s.household_id = p_household_id
      AND s.status IN ('active', 'trialing')
      AND (s.expires_at IS NULL OR s.expires_at > now())
  );
$$;

-- Push notification device tokens
CREATE TABLE IF NOT EXISTS public.pullcoparent_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL DEFAULT 'ios' CHECK (platform IN ('ios', 'android', 'web')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_push_tokens_user
  ON public.pullcoparent_push_tokens (user_id);

DROP TRIGGER IF EXISTS trg_pullcoparent_push_tokens_updated_at ON public.pullcoparent_push_tokens;
CREATE TRIGGER trg_pullcoparent_push_tokens_updated_at
BEFORE UPDATE ON public.pullcoparent_push_tokens
FOR EACH ROW EXECUTE FUNCTION public.pullcoparent_touch_updated_at();

ALTER TABLE public.pullcoparent_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pullcoparent_push_tokens_own ON public.pullcoparent_push_tokens;
CREATE POLICY pullcoparent_push_tokens_own ON public.pullcoparent_push_tokens
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pullcoparent_push_tokens TO authenticated;

NOTIFY pgrst, 'reload schema';
