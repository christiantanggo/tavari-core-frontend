-- Shared household grocery list (Settings)

CREATE TABLE IF NOT EXISTS public.pullcoparent_grocery_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.pullcoparent_households(id) ON DELETE CASCADE,
  name text NOT NULL,
  size text,
  store text,
  quantity text,
  is_picked_up boolean NOT NULL DEFAULT false,
  picked_up_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_grocery_items_household
  ON public.pullcoparent_grocery_items (household_id, is_picked_up, created_at DESC);

DROP TRIGGER IF EXISTS trg_pullcoparent_grocery_items_updated_at ON public.pullcoparent_grocery_items;
CREATE TRIGGER trg_pullcoparent_grocery_items_updated_at
BEFORE UPDATE ON public.pullcoparent_grocery_items
FOR EACH ROW EXECUTE FUNCTION public.pullcoparent_touch_updated_at();

ALTER TABLE public.pullcoparent_grocery_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pullcoparent_grocery_items_all_member ON public.pullcoparent_grocery_items;
CREATE POLICY pullcoparent_grocery_items_all_member ON public.pullcoparent_grocery_items
  FOR ALL TO authenticated
  USING (public.pullcoparent_is_household_member(household_id))
  WITH CHECK (public.pullcoparent_is_household_member(household_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pullcoparent_grocery_items TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'pullcoparent_grocery_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pullcoparent_grocery_items;
  END IF;
END $$;
