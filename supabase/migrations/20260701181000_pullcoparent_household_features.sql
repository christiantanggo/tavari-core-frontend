-- Household mode (family vs co-parent) and per-household feature toggles

ALTER TABLE public.pullcoparent_households
  ADD COLUMN IF NOT EXISTS household_mode text NOT NULL DEFAULT 'coparent',
  ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '{
    "children": true,
    "calendar": true,
    "expenses": true,
    "custody": true,
    "grocery": true,
    "childWants": true
  }'::jsonb;

ALTER TABLE public.pullcoparent_households
  DROP CONSTRAINT IF EXISTS pullcoparent_households_mode_check;

ALTER TABLE public.pullcoparent_households
  ADD CONSTRAINT pullcoparent_households_mode_check
  CHECK (household_mode IN ('family', 'coparent'));

CREATE OR REPLACE FUNCTION public.pullcoparent_default_features(p_mode text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_mode = 'family' THEN '{
      "children": true,
      "calendar": true,
      "expenses": false,
      "custody": false,
      "grocery": true,
      "childWants": true
    }'::jsonb
    ELSE '{
      "children": true,
      "calendar": true,
      "expenses": true,
      "custody": true,
      "grocery": true,
      "childWants": true
    }'::jsonb
  END;
$$;

CREATE OR REPLACE FUNCTION public.pullcoparent_create_household(
  p_name text DEFAULT 'Our household',
  p_mode text DEFAULT 'coparent',
  p_features jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_household_id uuid;
  v_mode text := COALESCE(NULLIF(trim(p_mode), ''), 'coparent');
  v_features jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_mode NOT IN ('family', 'coparent') THEN
    RAISE EXCEPTION 'Invalid household mode';
  END IF;

  v_features := COALESCE(p_features, public.pullcoparent_default_features(v_mode));

  INSERT INTO public.pullcoparent_households (name, created_by, household_mode, features)
  VALUES (COALESCE(NULLIF(trim(p_name), ''), 'Our household'), v_user_id, v_mode, v_features)
  RETURNING id INTO v_household_id;

  INSERT INTO public.pullcoparent_household_members (household_id, user_id, role)
  VALUES (v_household_id, v_user_id, 'owner');

  RETURN v_household_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pullcoparent_default_features(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pullcoparent_create_household(text, text, jsonb) TO authenticated;
