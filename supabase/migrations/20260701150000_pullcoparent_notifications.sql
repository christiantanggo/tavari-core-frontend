-- Pull Together: Co-Parent — in-app notifications (expense alerts, etc.)

CREATE TABLE IF NOT EXISTS public.pullcoparent_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.pullcoparent_households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'expense_added',
  title text NOT NULL,
  body text,
  link_path text DEFAULT '/app/expenses',
  related_expense_id uuid REFERENCES public.pullcoparent_expenses(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_notifications_user_unread
  ON public.pullcoparent_notifications (user_id, read_at NULLS FIRST, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_notifications_household
  ON public.pullcoparent_notifications (household_id, created_at DESC);

ALTER TABLE public.pullcoparent_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pullcoparent_notifications_select_own ON public.pullcoparent_notifications;
CREATE POLICY pullcoparent_notifications_select_own ON public.pullcoparent_notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS pullcoparent_notifications_update_own ON public.pullcoparent_notifications;
CREATE POLICY pullcoparent_notifications_update_own ON public.pullcoparent_notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Inserts via service role (edge function) only
