-- Add "other" child want type

ALTER TABLE public.pullcoparent_child_wants
  DROP CONSTRAINT IF EXISTS pullcoparent_child_wants_want_type_check;

ALTER TABLE public.pullcoparent_child_wants
  ADD CONSTRAINT pullcoparent_child_wants_want_type_check
  CHECK (want_type IN ('hangout', 'gift', 'activity', 'other'));

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
    WHEN 'other' THEN 'Request'
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
