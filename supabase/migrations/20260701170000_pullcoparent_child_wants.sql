-- Pull Together: Co-Parent — child wants (hangout, gift, activity) with co-parent approval

CREATE TABLE IF NOT EXISTS public.pullcoparent_child_wants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.pullcoparent_households(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES public.pullcoparent_children(id) ON DELETE CASCADE,
  want_type text NOT NULL CHECK (want_type IN ('hangout', 'gift', 'activity')),
  title text NOT NULL,
  notes text,
  contact_info text,
  event_date date,
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

CREATE INDEX IF NOT EXISTS idx_pullcoparent_child_wants_household
  ON public.pullcoparent_child_wants (household_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_child_wants_child
  ON public.pullcoparent_child_wants (child_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_pullcoparent_child_wants_updated_at ON public.pullcoparent_child_wants;
CREATE TRIGGER trg_pullcoparent_child_wants_updated_at
BEFORE UPDATE ON public.pullcoparent_child_wants
FOR EACH ROW EXECUTE FUNCTION public.pullcoparent_touch_updated_at();

ALTER TABLE public.pullcoparent_child_wants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pullcoparent_child_wants_select_member ON public.pullcoparent_child_wants;
CREATE POLICY pullcoparent_child_wants_select_member ON public.pullcoparent_child_wants
  FOR SELECT TO authenticated
  USING (public.pullcoparent_is_household_member(household_id));

DROP POLICY IF EXISTS pullcoparent_child_wants_insert_member ON public.pullcoparent_child_wants;
CREATE POLICY pullcoparent_child_wants_insert_member ON public.pullcoparent_child_wants
  FOR INSERT TO authenticated
  WITH CHECK (
    public.pullcoparent_is_household_member(household_id)
    AND created_by = auth.uid()
    AND status = 'pending'
  );

DROP POLICY IF EXISTS pullcoparent_child_wants_update_pending_creator ON public.pullcoparent_child_wants;
CREATE POLICY pullcoparent_child_wants_update_pending_creator ON public.pullcoparent_child_wants
  FOR UPDATE TO authenticated
  USING (
    public.pullcoparent_is_household_member(household_id)
    AND status = 'pending'
    AND created_by = auth.uid()
  )
  WITH CHECK (
    public.pullcoparent_is_household_member(household_id)
    AND status = 'pending'
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS pullcoparent_child_wants_delete_pending_creator ON public.pullcoparent_child_wants;
CREATE POLICY pullcoparent_child_wants_delete_pending_creator ON public.pullcoparent_child_wants
  FOR DELETE TO authenticated
  USING (
    public.pullcoparent_is_household_member(household_id)
    AND status = 'pending'
    AND created_by = auth.uid()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pullcoparent_child_wants TO authenticated;

-- Notify co-parent(s) when a want is submitted
CREATE OR REPLACE FUNCTION public.pullcoparent_notify_child_want(p_want_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row public.pullcoparent_child_wants%ROWTYPE;
  v_child_name text;
  v_creator_name text;
  v_recipient uuid;
  v_type_label text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_row FROM public.pullcoparent_child_wants WHERE id = p_want_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF v_row.created_by <> v_user_id THEN RAISE EXCEPTION 'Only the submitter can notify'; END IF;
  IF v_row.status <> 'pending' THEN RETURN; END IF;

  SELECT name INTO v_child_name FROM public.pullcoparent_children WHERE id = v_row.child_id;
  SELECT display_name INTO v_creator_name FROM public.pullcoparent_profiles WHERE user_id = v_row.created_by;

  v_type_label := CASE v_row.want_type
    WHEN 'hangout' THEN 'Hangout request'
    WHEN 'gift' THEN 'Gift request'
    WHEN 'activity' THEN 'Activity request'
    ELSE 'Request'
  END;

  FOR v_recipient IN
    SELECT user_id FROM public.pullcoparent_household_members
    WHERE household_id = v_row.household_id AND user_id <> v_row.created_by
  LOOP
    INSERT INTO public.pullcoparent_notifications (household_id, user_id, type, title, body, link_path, metadata)
    VALUES (
      v_row.household_id,
      v_recipient,
      'child_want_pending',
      v_type_label || ': ' || v_row.title,
      COALESCE(v_creator_name, 'Your co-parent') || ' submitted a request for ' || COALESCE(v_child_name, 'your child') || '.',
      '/app/wants?review=' || v_row.id::text,
      jsonb_build_object('want_id', v_row.id, 'child_id', v_row.child_id, 'want_type', v_row.want_type)
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pullcoparent_notify_child_want(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pullcoparent_approve_child_want(p_want_id uuid, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row public.pullcoparent_child_wants%ROWTYPE;
  v_decider_name text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_row FROM public.pullcoparent_child_wants WHERE id = p_want_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT public.pullcoparent_is_household_member(v_row.household_id) THEN RAISE EXCEPTION 'Not a household member'; END IF;
  IF v_row.created_by = v_user_id THEN RAISE EXCEPTION 'You cannot approve your own request'; END IF;
  IF v_row.status <> 'pending' THEN RAISE EXCEPTION 'Request is not pending'; END IF;

  UPDATE public.pullcoparent_child_wants
  SET status = 'approved', decided_by = v_user_id, decided_at = now(), decision_note = NULLIF(trim(p_note), '')
  WHERE id = p_want_id;

  SELECT display_name INTO v_decider_name FROM public.pullcoparent_profiles WHERE user_id = v_user_id;

  INSERT INTO public.pullcoparent_notifications (household_id, user_id, type, title, body, link_path, metadata)
  VALUES (
    v_row.household_id,
    v_row.created_by,
    'child_want_approved',
    'Approved: ' || v_row.title,
    COALESCE(v_decider_name, 'Your co-parent') || ' approved this request.',
    '/app/wants',
    jsonb_build_object('want_id', v_row.id)
  );

  RETURN v_row.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pullcoparent_decline_child_want(p_want_id uuid, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row public.pullcoparent_child_wants%ROWTYPE;
  v_decider_name text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_row FROM public.pullcoparent_child_wants WHERE id = p_want_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT public.pullcoparent_is_household_member(v_row.household_id) THEN RAISE EXCEPTION 'Not a household member'; END IF;
  IF v_row.created_by = v_user_id THEN RAISE EXCEPTION 'You cannot decline your own request'; END IF;
  IF v_row.status <> 'pending' THEN RAISE EXCEPTION 'Request is not pending'; END IF;

  UPDATE public.pullcoparent_child_wants
  SET status = 'declined', decided_by = v_user_id, decided_at = now(), decision_note = NULLIF(trim(p_note), '')
  WHERE id = p_want_id;

  SELECT display_name INTO v_decider_name FROM public.pullcoparent_profiles WHERE user_id = v_user_id;

  INSERT INTO public.pullcoparent_notifications (household_id, user_id, type, title, body, link_path, metadata)
  VALUES (
    v_row.household_id,
    v_row.created_by,
    'child_want_declined',
    'Declined: ' || v_row.title,
    COALESCE(v_decider_name, 'Your co-parent') || ' declined this request.'
      || CASE WHEN NULLIF(trim(p_note), '') IS NOT NULL THEN ' Note: ' || trim(p_note) ELSE '' END,
    '/app/wants',
    jsonb_build_object('want_id', v_row.id)
  );

  RETURN v_row.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pullcoparent_approve_child_want(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pullcoparent_decline_child_want(uuid, text) TO authenticated;
