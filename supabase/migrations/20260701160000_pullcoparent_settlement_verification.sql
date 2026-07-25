-- Settlement verification: sender marks sent → recipient confirms received

ALTER TABLE public.pullcoparent_settlements
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'declined')),
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_expense_id uuid REFERENCES public.pullcoparent_expenses(id) ON DELETE SET NULL;

-- Existing rows (pre-verification) count as confirmed
UPDATE public.pullcoparent_settlements SET status = 'confirmed', confirmed_at = created_at WHERE status = 'pending' AND confirmed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pullcoparent_settlements_status
  ON public.pullcoparent_settlements (household_id, status, payment_date DESC);

-- Replace broad policy with granular rules
DROP POLICY IF EXISTS pullcoparent_settlements_all_member ON public.pullcoparent_settlements;

DROP POLICY IF EXISTS pullcoparent_settlements_select_member ON public.pullcoparent_settlements;
CREATE POLICY pullcoparent_settlements_select_member ON public.pullcoparent_settlements
  FOR SELECT TO authenticated
  USING (public.pullcoparent_is_household_member(household_id));

DROP POLICY IF EXISTS pullcoparent_settlements_insert_member ON public.pullcoparent_settlements;
CREATE POLICY pullcoparent_settlements_insert_member ON public.pullcoparent_settlements
  FOR INSERT TO authenticated
  WITH CHECK (
    public.pullcoparent_is_household_member(household_id)
    AND created_by = auth.uid()
    AND status = 'pending'
  );

DROP POLICY IF EXISTS pullcoparent_settlements_delete_pending_sender ON public.pullcoparent_settlements;
CREATE POLICY pullcoparent_settlements_delete_pending_sender ON public.pullcoparent_settlements
  FOR DELETE TO authenticated
  USING (
    public.pullcoparent_is_household_member(household_id)
    AND status = 'pending'
    AND from_user_id = auth.uid()
  );

-- Confirm / decline via RPC (SECURITY DEFINER)

CREATE OR REPLACE FUNCTION public.pullcoparent_confirm_settlement(p_settlement_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row public.pullcoparent_settlements%ROWTYPE;
  v_from_name text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_row FROM public.pullcoparent_settlements WHERE id = p_settlement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_row.to_user_id <> v_user_id THEN RAISE EXCEPTION 'Only the recipient can confirm'; END IF;
  IF v_row.status <> 'pending' THEN RAISE EXCEPTION 'Payment is not pending'; END IF;

  UPDATE public.pullcoparent_settlements
  SET status = 'confirmed', confirmed_at = now(), confirmed_by = v_user_id
  WHERE id = p_settlement_id;

  SELECT display_name INTO v_from_name FROM public.pullcoparent_profiles WHERE user_id = v_row.from_user_id;

  INSERT INTO public.pullcoparent_notifications (household_id, user_id, type, title, body, link_path, metadata)
  VALUES (
    v_row.household_id,
    v_row.from_user_id,
    'settlement_confirmed',
    'Payment confirmed',
    COALESCE((SELECT display_name FROM public.pullcoparent_profiles WHERE user_id = v_user_id), 'Your co-parent')
      || ' confirmed they received $' || trim(to_char(v_row.amount, '999999990.00')) || '.',
    '/app/expenses',
    jsonb_build_object('settlement_id', v_row.id, 'amount', v_row.amount)
  );

  RETURN v_row.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pullcoparent_decline_settlement(p_settlement_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row public.pullcoparent_settlements%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_row FROM public.pullcoparent_settlements WHERE id = p_settlement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_row.to_user_id <> v_user_id THEN RAISE EXCEPTION 'Only the recipient can decline'; END IF;
  IF v_row.status <> 'pending' THEN RAISE EXCEPTION 'Payment is not pending'; END IF;

  UPDATE public.pullcoparent_settlements
  SET status = 'declined', declined_at = now(), declined_by = v_user_id
  WHERE id = p_settlement_id;

  INSERT INTO public.pullcoparent_notifications (household_id, user_id, type, title, body, link_path, metadata)
  VALUES (
    v_row.household_id,
    v_row.from_user_id,
    'settlement_declined',
    'Payment not received',
    COALESCE((SELECT display_name FROM public.pullcoparent_profiles WHERE user_id = v_user_id), 'Your co-parent')
      || ' did not receive $' || trim(to_char(v_row.amount, '999999990.00')) || '. Follow up outside the app if needed.',
    '/app/expenses',
    jsonb_build_object('settlement_id', v_row.id, 'amount', v_row.amount)
  );

  RETURN v_row.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pullcoparent_confirm_settlement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pullcoparent_decline_settlement(uuid) TO authenticated;
