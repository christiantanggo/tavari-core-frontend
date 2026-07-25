-- Weight logs per pet (chart on pet profile).
CREATE TABLE IF NOT EXISTS public.pullpets_weight_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES public.pullpets_pets(id) ON DELETE CASCADE,
  weight numeric(8, 2) NOT NULL CHECK (weight > 0),
  unit text NOT NULL DEFAULT 'lb' CHECK (unit IN ('lb', 'kg')),
  logged_at date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pet_id, logged_at)
);

CREATE INDEX IF NOT EXISTS idx_pullpets_weight_logs_pet_date
  ON public.pullpets_weight_logs (pet_id, logged_at DESC);

ALTER TABLE public.pullpets_weight_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pullpets_weight_logs_owner ON public.pullpets_weight_logs;
CREATE POLICY pullpets_weight_logs_owner ON public.pullpets_weight_logs
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.pullpets_is_pet_owner(pet_id))
  WITH CHECK (user_id = auth.uid() AND public.pullpets_is_pet_owner(pet_id));

DROP POLICY IF EXISTS pullpets_weight_logs_helper_select ON public.pullpets_weight_logs;
CREATE POLICY pullpets_weight_logs_helper_select ON public.pullpets_weight_logs
  FOR SELECT TO authenticated
  USING (public.pullpets_helper_can_access_pet(pet_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pullpets_weight_logs TO authenticated;
