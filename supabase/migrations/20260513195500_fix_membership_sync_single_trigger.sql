-- Step 1 (membership): one canonical trigger already existed — sync_business_users_to_user_roles → sync_user_roles().
-- We had added a second trigger; remove it and harden sync_user_roles() so INSERT/UPDATE never fails the
-- user_roles role CHECK (e.g. hr_admin) and always sets custom_permissions for new rows.

CREATE UNIQUE INDEX IF NOT EXISTS business_users_user_id_business_id_uidx
  ON public.business_users (user_id, business_id);

DROP TRIGGER IF EXISTS trg_sync_user_roles_from_business_users ON public.business_users;
DROP FUNCTION IF EXISTS public.sync_user_roles_from_business_users_row();

CREATE OR REPLACE FUNCTION public.sync_user_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r text;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    r := lower(trim(both from coalesce(NEW.role, 'employee')));
    IF r NOT IN ('customer', 'employee', 'keyholder', 'manager', 'admin', 'owner') THEN
      r := 'employee';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS NULL OR NEW.business_id IS NULL THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.user_roles (user_id, business_id, role, active, created_at, custom_permissions)
    VALUES (
      NEW.user_id,
      NEW.business_id,
      r,
      true,
      COALESCE(NEW.created_at, now()),
      '{}'::jsonb
    )
    ON CONFLICT (user_id, business_id)
    DO UPDATE SET
      role = EXCLUDED.role,
      active = true;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS NULL OR NEW.business_id IS NULL THEN
      RETURN NEW;
    END IF;
    UPDATE public.user_roles
    SET role = r, active = true
    WHERE user_id = NEW.user_id AND business_id = NEW.business_id;
    IF NOT FOUND THEN
      INSERT INTO public.user_roles (user_id, business_id, role, active, created_at, custom_permissions)
      VALUES (NEW.user_id, NEW.business_id, r, true, now(), '{}'::jsonb)
      ON CONFLICT (user_id, business_id)
      DO UPDATE SET role = EXCLUDED.role, active = true;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.user_roles
    SET active = false
    WHERE user_id = OLD.user_id AND business_id = OLD.business_id;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.sync_user_roles() IS
  'Keeps user_roles aligned with business_users; maps non-canonical roles to employee for user_roles CHECK.';
