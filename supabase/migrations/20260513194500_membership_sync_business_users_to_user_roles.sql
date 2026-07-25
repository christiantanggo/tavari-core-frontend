-- Keep public.user_roles in sync whenever public.business_users changes.
-- Dashboard login and most permission checks rely on active user_roles; this prevents
-- "membership" from silently existing only in business_users (e.g. failed client upsert).

-- One row per (user, business) for ON CONFLICT in triggers (no duplicates in prod at time of migration).
CREATE UNIQUE INDEX IF NOT EXISTS business_users_user_id_business_id_uidx
  ON public.business_users (user_id, business_id);

CREATE OR REPLACE FUNCTION public.sync_user_roles_from_business_users_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text;
BEGIN
  IF NEW.user_id IS NULL OR NEW.business_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Re-entrancy guard when user_roles trigger writes back to business_users
  IF COALESCE(current_setting('app.membership_sync_lock', true), '') = '1' THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.membership_sync_lock', '1', true);

  r := lower(trim(both from coalesce(NEW.role, 'employee')));
  IF r NOT IN ('customer', 'employee', 'keyholder', 'manager', 'admin', 'owner') THEN
    r := 'employee';
  END IF;

  INSERT INTO public.user_roles (user_id, business_id, role, active, custom_permissions)
  VALUES (NEW.user_id, NEW.business_id, r, true, '{}'::jsonb)
  ON CONFLICT (user_id, business_id)
  DO UPDATE SET
    role = EXCLUDED.role,
    active = true;

  PERFORM set_config('app.membership_sync_lock', '', true);
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('app.membership_sync_lock', '', true);
    RAISE;
END;
$$;

COMMENT ON FUNCTION public.sync_user_roles_from_business_users_row() IS
  'Upserts user_roles when business_users is inserted or updated so login/permissions always see membership.';

DROP TRIGGER IF EXISTS trg_sync_user_roles_from_business_users ON public.business_users;

CREATE TRIGGER trg_sync_user_roles_from_business_users
  AFTER INSERT OR UPDATE OF user_id, business_id, role
  ON public.business_users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_roles_from_business_users_row();

COMMENT ON TRIGGER trg_sync_user_roles_from_business_users ON public.business_users IS
  'Ensures user_roles row exists and stays aligned with business_users.role.';

REVOKE ALL ON FUNCTION public.sync_user_roles_from_business_users_row() FROM PUBLIC;
