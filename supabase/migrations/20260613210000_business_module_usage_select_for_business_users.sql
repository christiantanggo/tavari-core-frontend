-- Employee portal reads business_module_usage (e.g. module_key = 'scheduling') to show
-- Schedule, Clock, Availability, etc. The prior SELECT policy only allowed Tavari internal
-- staff (tavari_employees) or dashboard roles (user_roles), so regular employees in
-- business_users could not see enabled modules even when activated for their business.

DROP POLICY IF EXISTS "Employees can view module usage" ON public.business_module_usage;

CREATE POLICY "Employees can view module usage"
ON public.business_module_usage FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.tavari_employees te
    WHERE te.user_id = auth.uid()
      AND te.is_active = true
  )
  OR business_id IN (
    SELECT ur.business_id
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'admin', 'manager')
      AND ur.active = true
  )
  OR business_id IN (
    SELECT bu.business_id
    FROM public.business_users bu
    WHERE bu.user_id = auth.uid()
  )
  OR business_id IN (
    SELECT bu.business_id
    FROM public.business_users bu
    INNER JOIN public.users u ON u.id = bu.user_id
    WHERE lower(trim(coalesce(u.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
      AND coalesce(auth.jwt() ->> 'email', '') <> ''
  )
);
