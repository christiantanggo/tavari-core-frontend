-- Pull Together: Co-Parent — initial schema (pullcoparent_*)
-- Household-scoped co-parenting: calendar, expenses, invites

-- ---------------------------------------------------------------------------
-- Trigger helper (no table deps)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pullcoparent_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pullcoparent_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_profiles_user_id
  ON public.pullcoparent_profiles (user_id);

DROP TRIGGER IF EXISTS trg_pullcoparent_profiles_updated_at ON public.pullcoparent_profiles;
CREATE TRIGGER trg_pullcoparent_profiles_updated_at
BEFORE UPDATE ON public.pullcoparent_profiles
FOR EACH ROW EXECUTE FUNCTION public.pullcoparent_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Households
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pullcoparent_households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Our household',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_households_created_by
  ON public.pullcoparent_households (created_by);

DROP TRIGGER IF EXISTS trg_pullcoparent_households_updated_at ON public.pullcoparent_households;
CREATE TRIGGER trg_pullcoparent_households_updated_at
BEFORE UPDATE ON public.pullcoparent_households
FOR EACH ROW EXECUTE FUNCTION public.pullcoparent_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.pullcoparent_household_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.pullcoparent_households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'parent' CHECK (role IN ('owner', 'parent')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_household_members_user
  ON public.pullcoparent_household_members (user_id, household_id);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_household_members_household
  ON public.pullcoparent_household_members (household_id, user_id);

-- ---------------------------------------------------------------------------
-- Subscriptions (household-scoped — one sub covers both parents)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pullcoparent_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.pullcoparent_households(id) ON DELETE CASCADE,
  purchased_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  revenuecat_app_user_id text,
  product_id text,
  status text NOT NULL DEFAULT 'expired' CHECK (status IN ('active', 'expired', 'cancelled', 'trialing')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id)
);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_subscriptions_household
  ON public.pullcoparent_subscriptions (household_id, status);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_subscriptions_purchaser
  ON public.pullcoparent_subscriptions (purchased_by_user_id);

DROP TRIGGER IF EXISTS trg_pullcoparent_subscriptions_updated_at ON public.pullcoparent_subscriptions;
CREATE TRIGGER trg_pullcoparent_subscriptions_updated_at
BEFORE UPDATE ON public.pullcoparent_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.pullcoparent_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Invites
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pullcoparent_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.pullcoparent_households(id) ON DELETE CASCADE,
  invite_code text NOT NULL,
  invited_email text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invite_code)
);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_invites_household
  ON public.pullcoparent_invites (household_id, status);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_invites_code
  ON public.pullcoparent_invites (invite_code) WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_pullcoparent_invites_updated_at ON public.pullcoparent_invites;
CREATE TRIGGER trg_pullcoparent_invites_updated_at
BEFORE UPDATE ON public.pullcoparent_invites
FOR EACH ROW EXECUTE FUNCTION public.pullcoparent_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Children
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pullcoparent_children (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.pullcoparent_households(id) ON DELETE CASCADE,
  name text NOT NULL,
  date_of_birth date,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_children_household
  ON public.pullcoparent_children (household_id);

DROP TRIGGER IF EXISTS trg_pullcoparent_children_updated_at ON public.pullcoparent_children;
CREATE TRIGGER trg_pullcoparent_children_updated_at
BEFORE UPDATE ON public.pullcoparent_children
FOR EACH ROW EXECUTE FUNCTION public.pullcoparent_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Custody patterns & events
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pullcoparent_custody_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.pullcoparent_households(id) ON DELETE CASCADE,
  name text NOT NULL,
  pattern_type text NOT NULL DEFAULT 'weekly' CHECK (pattern_type IN ('weekly', 'custom')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_custody_patterns_household
  ON public.pullcoparent_custody_patterns (household_id, is_active);

DROP TRIGGER IF EXISTS trg_pullcoparent_custody_patterns_updated_at ON public.pullcoparent_custody_patterns;
CREATE TRIGGER trg_pullcoparent_custody_patterns_updated_at
BEFORE UPDATE ON public.pullcoparent_custody_patterns
FOR EACH ROW EXECUTE FUNCTION public.pullcoparent_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.pullcoparent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.pullcoparent_households(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  event_type text NOT NULL DEFAULT 'other' CHECK (event_type IN ('custody', 'handoff', 'appointment', 'other')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  assigned_parent_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  child_id uuid REFERENCES public.pullcoparent_children(id) ON DELETE SET NULL,
  custody_pattern_id uuid REFERENCES public.pullcoparent_custody_patterns(id) ON DELETE SET NULL,
  recurrence_rule text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_events_household_starts
  ON public.pullcoparent_events (household_id, starts_at);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_events_type
  ON public.pullcoparent_events (household_id, event_type, starts_at);

DROP TRIGGER IF EXISTS trg_pullcoparent_events_updated_at ON public.pullcoparent_events;
CREATE TRIGGER trg_pullcoparent_events_updated_at
BEFORE UPDATE ON public.pullcoparent_events
FOR EACH ROW EXECUTE FUNCTION public.pullcoparent_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pullcoparent_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.pullcoparent_households(id) ON DELETE CASCADE,
  amount numeric(10, 2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'USD',
  category text NOT NULL DEFAULT 'other',
  description text,
  paid_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  split_type text NOT NULL DEFAULT 'equal' CHECK (split_type IN ('equal', 'custom', 'full')),
  split_percent_a numeric(5, 2),
  split_percent_b numeric(5, 2),
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  receipt_url text,
  child_id uuid REFERENCES public.pullcoparent_children(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_expenses_household_date
  ON public.pullcoparent_expenses (household_id, expense_date DESC);

DROP TRIGGER IF EXISTS trg_pullcoparent_expenses_updated_at ON public.pullcoparent_expenses;
CREATE TRIGGER trg_pullcoparent_expenses_updated_at
BEFORE UPDATE ON public.pullcoparent_expenses
FOR EACH ROW EXECUTE FUNCTION public.pullcoparent_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helper functions (after tables exist)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pullcoparent_user_household_ids(p_user_id uuid DEFAULT auth.uid())
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT household_id
  FROM public.pullcoparent_household_members
  WHERE user_id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION public.pullcoparent_is_household_member(p_household_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pullcoparent_household_members
    WHERE household_id = p_household_id
      AND user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.pullcoparent_is_household_owner(p_household_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pullcoparent_household_members
    WHERE household_id = p_household_id
      AND user_id = p_user_id
      AND role = 'owner'
  );
$$;

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
      AND s.status = 'active'
      AND (s.expires_at IS NULL OR s.expires_at > now())
  );
$$;

-- ---------------------------------------------------------------------------
-- RPC: create household + owner membership
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pullcoparent_create_household(p_name text DEFAULT 'Our household')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_household_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.pullcoparent_households (name, created_by)
  VALUES (COALESCE(NULLIF(trim(p_name), ''), 'Our household'), v_user_id)
  RETURNING id INTO v_household_id;

  INSERT INTO public.pullcoparent_household_members (household_id, user_id, role)
  VALUES (v_household_id, v_user_id, 'owner');

  RETURN v_household_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: accept invite by 6-digit code
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pullcoparent_accept_invite(p_invite_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_invite public.pullcoparent_invites%ROWTYPE;
  v_member_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_invite
  FROM public.pullcoparent_invites
  WHERE invite_code = upper(trim(p_invite_code))
    AND status = 'pending'
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired invite code';
  END IF;

  IF public.pullcoparent_is_household_member(v_invite.household_id, v_user_id) THEN
    UPDATE public.pullcoparent_invites
    SET status = 'accepted', accepted_by = v_user_id, accepted_at = now()
    WHERE id = v_invite.id;
    RETURN v_invite.household_id;
  END IF;

  SELECT count(*) INTO v_member_count
  FROM public.pullcoparent_household_members
  WHERE household_id = v_invite.household_id;

  IF v_member_count >= 2 THEN
    RAISE EXCEPTION 'This household already has two parents';
  END IF;

  INSERT INTO public.pullcoparent_household_members (household_id, user_id, role)
  VALUES (v_invite.household_id, v_user_id, 'parent');

  UPDATE public.pullcoparent_invites
  SET status = 'accepted', accepted_by = v_user_id, accepted_at = now()
  WHERE id = v_invite.id;

  RETURN v_invite.household_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: generate invite code
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pullcoparent_create_invite(
  p_household_id uuid,
  p_invited_email text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_code text;
  v_attempts integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.pullcoparent_is_household_member(p_household_id, v_user_id) THEN
    RAISE EXCEPTION 'Not a member of this household';
  END IF;

  LOOP
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    v_attempts := v_attempts + 1;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.pullcoparent_invites WHERE invite_code = v_code);
    IF v_attempts > 20 THEN
      RAISE EXCEPTION 'Could not generate unique invite code';
    END IF;
  END LOOP;

  INSERT INTO public.pullcoparent_invites (household_id, invite_code, invited_email, created_by)
  VALUES (p_household_id, v_code, NULLIF(trim(p_invited_email), ''), v_user_id);

  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pullcoparent_create_household(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pullcoparent_accept_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pullcoparent_create_invite(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pullcoparent_household_has_premium(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.pullcoparent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pullcoparent_households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pullcoparent_household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pullcoparent_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pullcoparent_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pullcoparent_children ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pullcoparent_custody_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pullcoparent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pullcoparent_expenses ENABLE ROW LEVEL SECURITY;

-- Profiles
DROP POLICY IF EXISTS pullcoparent_profiles_select_own ON public.pullcoparent_profiles;
CREATE POLICY pullcoparent_profiles_select_own ON public.pullcoparent_profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS pullcoparent_profiles_insert_own ON public.pullcoparent_profiles;
CREATE POLICY pullcoparent_profiles_insert_own ON public.pullcoparent_profiles
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS pullcoparent_profiles_update_own ON public.pullcoparent_profiles;
CREATE POLICY pullcoparent_profiles_update_own ON public.pullcoparent_profiles
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS pullcoparent_profiles_delete_own ON public.pullcoparent_profiles;
CREATE POLICY pullcoparent_profiles_delete_own ON public.pullcoparent_profiles
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Households
DROP POLICY IF EXISTS pullcoparent_households_select_member ON public.pullcoparent_households;
CREATE POLICY pullcoparent_households_select_member ON public.pullcoparent_households
  FOR SELECT TO authenticated
  USING (public.pullcoparent_is_household_member(id));

DROP POLICY IF EXISTS pullcoparent_households_update_member ON public.pullcoparent_households;
CREATE POLICY pullcoparent_households_update_member ON public.pullcoparent_households
  FOR UPDATE TO authenticated
  USING (public.pullcoparent_is_household_member(id))
  WITH CHECK (public.pullcoparent_is_household_member(id));

DROP POLICY IF EXISTS pullcoparent_households_insert_authenticated ON public.pullcoparent_households;
CREATE POLICY pullcoparent_households_insert_authenticated ON public.pullcoparent_households
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

-- Household members
DROP POLICY IF EXISTS pullcoparent_members_select_household ON public.pullcoparent_household_members;
CREATE POLICY pullcoparent_members_select_household ON public.pullcoparent_household_members
  FOR SELECT TO authenticated
  USING (public.pullcoparent_is_household_member(household_id));

DROP POLICY IF EXISTS pullcoparent_members_delete_self ON public.pullcoparent_household_members;
CREATE POLICY pullcoparent_members_delete_self ON public.pullcoparent_household_members
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Subscriptions (household members read; writes via service role / webhook)
DROP POLICY IF EXISTS pullcoparent_subscriptions_select_member ON public.pullcoparent_subscriptions;
CREATE POLICY pullcoparent_subscriptions_select_member ON public.pullcoparent_subscriptions
  FOR SELECT TO authenticated
  USING (public.pullcoparent_is_household_member(household_id));

-- Invites
DROP POLICY IF EXISTS pullcoparent_invites_select_member ON public.pullcoparent_invites;
CREATE POLICY pullcoparent_invites_select_member ON public.pullcoparent_invites
  FOR SELECT TO authenticated
  USING (
    public.pullcoparent_is_household_member(household_id)
    OR (status = 'pending' AND expires_at > now())
  );

DROP POLICY IF EXISTS pullcoparent_invites_insert_member ON public.pullcoparent_invites;
CREATE POLICY pullcoparent_invites_insert_member ON public.pullcoparent_invites
  FOR INSERT TO authenticated
  WITH CHECK (
    public.pullcoparent_is_household_member(household_id)
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS pullcoparent_invites_update_member ON public.pullcoparent_invites;
CREATE POLICY pullcoparent_invites_update_member ON public.pullcoparent_invites
  FOR UPDATE TO authenticated
  USING (public.pullcoparent_is_household_member(household_id))
  WITH CHECK (public.pullcoparent_is_household_member(household_id));

-- Children
DROP POLICY IF EXISTS pullcoparent_children_all_member ON public.pullcoparent_children;
CREATE POLICY pullcoparent_children_all_member ON public.pullcoparent_children
  FOR ALL TO authenticated
  USING (public.pullcoparent_is_household_member(household_id))
  WITH CHECK (public.pullcoparent_is_household_member(household_id));

-- Custody patterns
DROP POLICY IF EXISTS pullcoparent_patterns_all_member ON public.pullcoparent_custody_patterns;
CREATE POLICY pullcoparent_patterns_all_member ON public.pullcoparent_custody_patterns
  FOR ALL TO authenticated
  USING (public.pullcoparent_is_household_member(household_id))
  WITH CHECK (public.pullcoparent_is_household_member(household_id));

-- Events
DROP POLICY IF EXISTS pullcoparent_events_all_member ON public.pullcoparent_events;
CREATE POLICY pullcoparent_events_all_member ON public.pullcoparent_events
  FOR ALL TO authenticated
  USING (public.pullcoparent_is_household_member(household_id))
  WITH CHECK (public.pullcoparent_is_household_member(household_id));

-- Expenses
DROP POLICY IF EXISTS pullcoparent_expenses_all_member ON public.pullcoparent_expenses;
CREATE POLICY pullcoparent_expenses_all_member ON public.pullcoparent_expenses
  FOR ALL TO authenticated
  USING (public.pullcoparent_is_household_member(household_id))
  WITH CHECK (public.pullcoparent_is_household_member(household_id));
