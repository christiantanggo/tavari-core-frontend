-- Employment lifecycle is per-business (business_users), not global (users).
-- Same email may be terminated at business A and owner at business B.

ALTER TABLE public.business_users
  ADD COLUMN IF NOT EXISTS employment_status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS termination_date date;

COMMENT ON COLUMN public.business_users.employment_status IS
  'Employment lifecycle at this business only. Not shared across other Tavari businesses.';
COMMENT ON COLUMN public.business_users.termination_date IS
  'Termination date at this business only.';

-- Backfill from legacy global users row; privileged roles stay active at each business.
UPDATE public.business_users bu
SET
  employment_status = CASE
    WHEN bu.role IN ('owner', 'admin', 'manager') THEN 'active'
    ELSE COALESCE(NULLIF(trim(u.employment_status), ''), 'active')
  END,
  termination_date = CASE
    WHEN bu.role IN ('owner', 'admin', 'manager') THEN NULL
    ELSE u.termination_date
  END
FROM public.users u
WHERE u.id = bu.user_id
  AND bu.employment_status IS NULL;

UPDATE public.business_users
SET employment_status = 'active'
WHERE employment_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_business_users_employment_status
  ON public.business_users (business_id, employment_status);
