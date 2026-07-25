-- Partner notifications for grocery, calendar, photos, household, subscription, and profile updates

CREATE OR REPLACE FUNCTION public.pullcoparent_notify_household_members(
  p_household_id uuid,
  p_exclude_user_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_link_path text DEFAULT '/app',
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient uuid;
BEGIN
  IF p_household_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_recipient IN
    SELECT user_id
    FROM public.pullcoparent_household_members
    WHERE household_id = p_household_id
      AND (p_exclude_user_id IS NULL OR user_id <> p_exclude_user_id)
  LOOP
    INSERT INTO public.pullcoparent_notifications (household_id, user_id, type, title, body, link_path, metadata)
    VALUES (p_household_id, v_recipient, p_type, p_title, p_body, p_link_path, p_metadata);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pullcoparent_notify_household_members(uuid, uuid, text, text, text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.pullcoparent_actor_display_name(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(trim(display_name), ''), 'Your partner')
  FROM public.pullcoparent_profiles
  WHERE user_id = p_user_id;
$$;

-- Grocery item added
CREATE OR REPLACE FUNCTION public.pullcoparent_trg_notify_grocery_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_name text;
BEGIN
  v_actor_name := public.pullcoparent_actor_display_name(NEW.created_by);
  PERFORM public.pullcoparent_notify_household_members(
    NEW.household_id,
    NEW.created_by,
    'grocery_item_added',
    'Grocery: ' || NEW.name,
    v_actor_name || ' added "' || NEW.name || '" to the shopping list.',
    '/app/grocery',
    jsonb_build_object('grocery_item_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pullcoparent_notify_grocery_insert ON public.pullcoparent_grocery_items;
CREATE TRIGGER trg_pullcoparent_notify_grocery_insert
AFTER INSERT ON public.pullcoparent_grocery_items
FOR EACH ROW EXECUTE FUNCTION public.pullcoparent_trg_notify_grocery_insert();

-- Calendar event added
CREATE OR REPLACE FUNCTION public.pullcoparent_trg_notify_event_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_name text;
  v_when text;
BEGIN
  v_actor_name := public.pullcoparent_actor_display_name(NEW.created_by);
  v_when := to_char(NEW.starts_at AT TIME ZONE 'UTC', 'Mon DD, YYYY');
  IF NOT NEW.all_day THEN
    v_when := to_char(NEW.starts_at AT TIME ZONE 'UTC', 'Mon DD, YYYY "at" HH12:MI AM');
  END IF;

  PERFORM public.pullcoparent_notify_household_members(
    NEW.household_id,
    NEW.created_by,
    'calendar_event_added',
    'Event: ' || NEW.title,
    v_actor_name || ' added "' || NEW.title || '" on ' || v_when || '.',
    '/app/calendar',
    jsonb_build_object('event_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pullcoparent_notify_event_insert ON public.pullcoparent_events;
CREATE TRIGGER trg_pullcoparent_notify_event_insert
AFTER INSERT ON public.pullcoparent_events
FOR EACH ROW EXECUTE FUNCTION public.pullcoparent_trg_notify_event_insert();

-- Family photo added
CREATE OR REPLACE FUNCTION public.pullcoparent_trg_notify_family_photo_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_name text;
BEGIN
  v_actor_name := public.pullcoparent_actor_display_name(NEW.created_by);
  PERFORM public.pullcoparent_notify_household_members(
    NEW.household_id,
    NEW.created_by,
    'family_photo_added',
    'New family photo',
    v_actor_name || ' added a photo to your home page slideshow.',
    '/app',
    jsonb_build_object('photo_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pullcoparent_notify_family_photo_insert ON public.pullcoparent_family_photos;
CREATE TRIGGER trg_pullcoparent_notify_family_photo_insert
AFTER INSERT ON public.pullcoparent_family_photos
FOR EACH ROW EXECUTE FUNCTION public.pullcoparent_trg_notify_family_photo_insert();

-- Household setup changed
CREATE OR REPLACE FUNCTION public.pullcoparent_trg_notify_household_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_name text;
  v_body text := 'Household settings were updated.';
BEGIN
  IF NEW.name IS NOT DISTINCT FROM OLD.name
     AND NEW.household_mode IS NOT DISTINCT FROM OLD.household_mode
     AND NEW.features IS NOT DISTINCT FROM OLD.features THEN
    RETURN NEW;
  END IF;

  v_actor_name := public.pullcoparent_actor_display_name(auth.uid());
  IF NEW.household_mode IS DISTINCT FROM OLD.household_mode THEN
    v_body := v_actor_name || ' changed the household type.';
  ELSIF NEW.features IS NOT DISTINCT FROM OLD.features THEN
    v_body := v_actor_name || ' updated the household name.';
  ELSE
    v_body := v_actor_name || ' updated household features or settings.';
  END IF;

  PERFORM public.pullcoparent_notify_household_members(
    NEW.id,
    auth.uid(),
    'household_changed',
    'Household updated',
    v_body,
    '/app/household',
    jsonb_build_object('household_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pullcoparent_notify_household_update ON public.pullcoparent_households;
CREATE TRIGGER trg_pullcoparent_notify_household_update
AFTER UPDATE ON public.pullcoparent_households
FOR EACH ROW EXECUTE FUNCTION public.pullcoparent_trg_notify_household_update();

-- Partner profile updated
CREATE OR REPLACE FUNCTION public.pullcoparent_trg_notify_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_name text;
  v_body text := '';
  v_household_id uuid;
BEGIN
  IF NEW.display_name IS NOT DISTINCT FROM OLD.display_name
     AND NEW.phone IS NOT DISTINCT FROM OLD.phone THEN
    RETURN NEW;
  END IF;

  v_actor_name := COALESCE(NULLIF(trim(NEW.display_name), ''), 'Your partner');

  IF NEW.display_name IS DISTINCT FROM OLD.display_name AND NEW.phone IS DISTINCT FROM OLD.phone THEN
    v_body := v_actor_name || ' updated their name and phone number.';
  ELSIF NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    v_body := v_actor_name || ' updated their name.';
  ELSE
    v_body := v_actor_name || ' updated their phone number.';
  END IF;

  FOR v_household_id IN
    SELECT household_id FROM public.pullcoparent_household_members WHERE user_id = NEW.user_id
  LOOP
    PERFORM public.pullcoparent_notify_household_members(
      v_household_id,
      NEW.user_id,
      'partner_profile_updated',
      'Contact info updated',
      v_body,
      '/app/settings',
      jsonb_build_object('user_id', NEW.user_id)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pullcoparent_notify_profile_update ON public.pullcoparent_profiles;
CREATE TRIGGER trg_pullcoparent_notify_profile_update
AFTER UPDATE ON public.pullcoparent_profiles
FOR EACH ROW EXECUTE FUNCTION public.pullcoparent_trg_notify_profile_update();

-- Subscription changed
CREATE OR REPLACE FUNCTION public.pullcoparent_trg_notify_subscription_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_name text;
  v_body text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.product_id IS NOT DISTINCT FROM OLD.product_id
     AND NEW.expires_at IS NOT DISTINCT FROM OLD.expires_at THEN
    RETURN NEW;
  END IF;

  v_actor_name := public.pullcoparent_actor_display_name(NEW.purchased_by_user_id);
  v_body := v_actor_name || ' updated your household subscription (' || COALESCE(NEW.status, 'unknown') || ').';

  PERFORM public.pullcoparent_notify_household_members(
    NEW.household_id,
    NEW.purchased_by_user_id,
    'subscription_changed',
    'Subscription updated',
    v_body,
    '/app/premium',
    jsonb_build_object('subscription_id', NEW.id, 'status', NEW.status)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pullcoparent_notify_subscription_update ON public.pullcoparent_subscriptions;
CREATE TRIGGER trg_pullcoparent_notify_subscription_update
AFTER UPDATE ON public.pullcoparent_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.pullcoparent_trg_notify_subscription_update();

-- Partner contact info for settings (includes email from auth.users)
CREATE OR REPLACE FUNCTION public.pullcoparent_get_household_partners(p_household_id uuid)
RETURNS TABLE(
  user_id uuid,
  display_name text,
  phone text,
  email text,
  role text,
  joined_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.pullcoparent_is_household_member(p_household_id) THEN
    RAISE EXCEPTION 'Not a household member';
  END IF;

  RETURN QUERY
  SELECT
    m.user_id,
    p.display_name,
    p.phone,
    u.email::text,
    m.role::text,
    m.joined_at
  FROM public.pullcoparent_household_members AS m
  LEFT JOIN public.pullcoparent_profiles AS p ON p.user_id = m.user_id
  LEFT JOIN auth.users AS u ON u.id = m.user_id
  WHERE m.household_id = p_household_id
    AND m.user_id <> auth.uid()
  ORDER BY m.joined_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pullcoparent_get_household_partners(uuid) TO authenticated;

-- Realtime for notification badge
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'pullcoparent_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pullcoparent_notifications;
  END IF;
END $$;
