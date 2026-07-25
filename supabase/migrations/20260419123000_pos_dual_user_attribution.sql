ALTER TABLE public.pos_sales
  ADD COLUMN IF NOT EXISTS login_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS operator_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS login_user_name TEXT,
  ADD COLUMN IF NOT EXISTS operator_user_name TEXT;

ALTER TABLE public.pos_payments
  ADD COLUMN IF NOT EXISTS login_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS operator_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS login_user_name TEXT,
  ADD COLUMN IF NOT EXISTS operator_user_name TEXT;

ALTER TABLE public.pos_receipts
  ADD COLUMN IF NOT EXISTS login_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS operator_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS login_user_name TEXT,
  ADD COLUMN IF NOT EXISTS operator_user_name TEXT;

CREATE INDEX IF NOT EXISTS idx_pos_sales_login_user_id
  ON public.pos_sales (login_user_id)
  WHERE login_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pos_sales_operator_user_id
  ON public.pos_sales (operator_user_id)
  WHERE operator_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pos_payments_login_user_id
  ON public.pos_payments (login_user_id)
  WHERE login_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pos_payments_operator_user_id
  ON public.pos_payments (operator_user_id)
  WHERE operator_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pos_receipts_login_user_id
  ON public.pos_receipts (login_user_id)
  WHERE login_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pos_receipts_operator_user_id
  ON public.pos_receipts (operator_user_id)
  WHERE operator_user_id IS NOT NULL;

UPDATE public.pos_sales AS s
SET
  login_user_id = COALESCE(s.login_user_id, s.user_id),
  operator_user_id = COALESCE(s.operator_user_id, s.user_id),
  login_user_name = COALESCE(NULLIF(BTRIM(s.login_user_name), ''), NULLIF(BTRIM(u.full_name), ''), NULLIF(BTRIM(u.email), '')),
  operator_user_name = COALESCE(NULLIF(BTRIM(s.operator_user_name), ''), NULLIF(BTRIM(u.full_name), ''), NULLIF(BTRIM(u.email), ''))
FROM public.users AS u
WHERE s.user_id = u.id
  AND (
    s.login_user_id IS NULL OR
    s.operator_user_id IS NULL OR
    NULLIF(BTRIM(s.login_user_name), '') IS NULL OR
    NULLIF(BTRIM(s.operator_user_name), '') IS NULL
  );

UPDATE public.pos_payments AS p
SET
  login_user_id = COALESCE(p.login_user_id, p.processed_by),
  operator_user_id = COALESCE(p.operator_user_id, p.processed_by),
  login_user_name = COALESCE(NULLIF(BTRIM(p.login_user_name), ''), NULLIF(BTRIM(u.full_name), ''), NULLIF(BTRIM(u.email), '')),
  operator_user_name = COALESCE(NULLIF(BTRIM(p.operator_user_name), ''), NULLIF(BTRIM(u.full_name), ''), NULLIF(BTRIM(u.email), ''))
FROM public.users AS u
WHERE p.processed_by = u.id
  AND (
    p.login_user_id IS NULL OR
    p.operator_user_id IS NULL OR
    NULLIF(BTRIM(p.login_user_name), '') IS NULL OR
    NULLIF(BTRIM(p.operator_user_name), '') IS NULL
  );

UPDATE public.pos_receipts AS r
SET
  login_user_name = COALESCE(NULLIF(BTRIM(r.login_user_name), ''), NULLIF(BTRIM(r.employee_name), '')),
  operator_user_name = COALESCE(NULLIF(BTRIM(r.operator_user_name), ''), NULLIF(BTRIM(r.employee_name), ''))
WHERE NULLIF(BTRIM(r.login_user_name), '') IS NULL
   OR NULLIF(BTRIM(r.operator_user_name), '') IS NULL;
