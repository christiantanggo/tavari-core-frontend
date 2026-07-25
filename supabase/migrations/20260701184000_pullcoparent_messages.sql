-- Household direct messages between parents

CREATE TABLE IF NOT EXISTS public.pullcoparent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.pullcoparent_households(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(trim(body)) > 0 AND char_length(body) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_messages_household_created
  ON public.pullcoparent_messages (household_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.pullcoparent_message_read_state (
  household_id uuid NOT NULL REFERENCES public.pullcoparent_households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);

ALTER TABLE public.pullcoparent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pullcoparent_message_read_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pullcoparent_messages_select_member ON public.pullcoparent_messages;
CREATE POLICY pullcoparent_messages_select_member ON public.pullcoparent_messages
  FOR SELECT TO authenticated
  USING (public.pullcoparent_is_household_member(household_id));

DROP POLICY IF EXISTS pullcoparent_messages_insert_member ON public.pullcoparent_messages;
CREATE POLICY pullcoparent_messages_insert_member ON public.pullcoparent_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.pullcoparent_is_household_member(household_id)
    AND sender_user_id = auth.uid()
  );

DROP POLICY IF EXISTS pullcoparent_message_read_state_select_own ON public.pullcoparent_message_read_state;
CREATE POLICY pullcoparent_message_read_state_select_own ON public.pullcoparent_message_read_state
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.pullcoparent_is_household_member(household_id));

DROP POLICY IF EXISTS pullcoparent_message_read_state_upsert_own ON public.pullcoparent_message_read_state;
CREATE POLICY pullcoparent_message_read_state_upsert_own ON public.pullcoparent_message_read_state
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.pullcoparent_is_household_member(household_id));

DROP POLICY IF EXISTS pullcoparent_message_read_state_update_own ON public.pullcoparent_message_read_state;
CREATE POLICY pullcoparent_message_read_state_update_own ON public.pullcoparent_message_read_state
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.pullcoparent_is_household_member(household_id))
  WITH CHECK (user_id = auth.uid() AND public.pullcoparent_is_household_member(household_id));

GRANT SELECT, INSERT ON public.pullcoparent_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.pullcoparent_message_read_state TO authenticated;

CREATE OR REPLACE FUNCTION public.pullcoparent_unread_message_count(p_household_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.pullcoparent_messages AS m
  WHERE m.household_id = p_household_id
    AND m.sender_user_id <> auth.uid()
    AND public.pullcoparent_is_household_member(p_household_id)
    AND m.created_at > COALESCE(
      (
        SELECT rs.last_read_at
        FROM public.pullcoparent_message_read_state AS rs
        WHERE rs.household_id = p_household_id
          AND rs.user_id = auth.uid()
      ),
      '1970-01-01'::timestamptz
    );
$$;

GRANT EXECUTE ON FUNCTION public.pullcoparent_unread_message_count(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pullcoparent_mark_messages_read(p_household_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.pullcoparent_is_household_member(p_household_id) THEN
    RAISE EXCEPTION 'Not a household member';
  END IF;

  INSERT INTO public.pullcoparent_message_read_state (household_id, user_id, last_read_at)
  VALUES (p_household_id, auth.uid(), now())
  ON CONFLICT (household_id, user_id)
  DO UPDATE SET last_read_at = EXCLUDED.last_read_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pullcoparent_mark_messages_read(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pullcoparent_trg_notify_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_name text;
  v_preview text;
BEGIN
  v_actor_name := public.pullcoparent_actor_display_name(NEW.sender_user_id);
  v_preview := left(trim(NEW.body), 120);
  IF char_length(trim(NEW.body)) > 120 THEN
    v_preview := v_preview || '…';
  END IF;

  PERFORM public.pullcoparent_notify_household_members(
    NEW.household_id,
    NEW.sender_user_id,
    'message_received',
    'New message',
    v_actor_name || ': ' || v_preview,
    '/app/messages',
    jsonb_build_object('message_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pullcoparent_notify_message_insert ON public.pullcoparent_messages;
CREATE TRIGGER trg_pullcoparent_notify_message_insert
AFTER INSERT ON public.pullcoparent_messages
FOR EACH ROW EXECUTE FUNCTION public.pullcoparent_trg_notify_message_insert();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'pullcoparent_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pullcoparent_messages;
  END IF;
END $$;
