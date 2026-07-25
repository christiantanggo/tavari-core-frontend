-- Older employees were provisioned with placeholder auth emails (@tanggo.ca) while
-- public.users kept personal emails. Sync auth.users.email to public.users.email when IDs match.

UPDATE auth.users au
SET
  email = lower(trim(u.email)),
  email_change = lower(trim(u.email)),
  email_change_confirm_status = 0,
  updated_at = now()
FROM public.users u
WHERE au.id = u.id
  AND lower(trim(au.email)) <> lower(trim(u.email))
  AND u.email NOT LIKE '%test%';

-- scheduling_time_off: allow portal access when JWT email matches public.users.id
DROP POLICY IF EXISTS "Scheduling time off select access" ON public.scheduling_time_off;
DROP POLICY IF EXISTS "Scheduling time off insert access" ON public.scheduling_time_off;

CREATE POLICY "Scheduling time off select access"
  ON public.scheduling_time_off
  FOR SELECT
  TO authenticated
  USING (
    employee_id = (SELECT auth.uid())
    OR public.business_users_row_matches_session_email(employee_id)
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_time_off.business_id
        AND (
          bu.user_id = (SELECT auth.uid())
          OR public.business_users_row_matches_session_email(bu.user_id)
        )
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_time_off.business_id
        AND (
          ur.user_id = (SELECT auth.uid())
          OR public.business_users_row_matches_session_email(ur.user_id)
        )
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );

CREATE POLICY "Scheduling time off insert access"
  ON public.scheduling_time_off
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      requested_by = (SELECT auth.uid())
      OR public.business_users_row_matches_session_email(requested_by)
    )
    AND (
      employee_id = (SELECT auth.uid())
      OR public.business_users_row_matches_session_email(employee_id)
      OR EXISTS (
        SELECT 1
        FROM public.business_users bu
        WHERE bu.business_id = scheduling_time_off.business_id
          AND (
            bu.user_id = (SELECT auth.uid())
            OR public.business_users_row_matches_session_email(bu.user_id)
          )
          AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
      )
      OR EXISTS (
        SELECT 1
        FROM public.user_roles ur
        WHERE ur.business_id = scheduling_time_off.business_id
          AND (
            ur.user_id = (SELECT auth.uid())
            OR public.business_users_row_matches_session_email(ur.user_id)
          )
          AND ur.active = true
          AND ur.role IN ('owner', 'manager', 'admin')
      )
    )
  );

-- scheduling_availability: same portal email-match pattern
DROP POLICY IF EXISTS "Scheduling availability select access" ON public.scheduling_availability;
DROP POLICY IF EXISTS "Scheduling availability insert access" ON public.scheduling_availability;

CREATE POLICY "Scheduling availability select access"
  ON public.scheduling_availability
  FOR SELECT
  TO authenticated
  USING (
    employee_id = (SELECT auth.uid())
    OR public.business_users_row_matches_session_email(employee_id)
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_availability.business_id
        AND (
          bu.user_id = (SELECT auth.uid())
          OR public.business_users_row_matches_session_email(bu.user_id)
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_availability.business_id
        AND (
          ur.user_id = (SELECT auth.uid())
          OR public.business_users_row_matches_session_email(ur.user_id)
        )
        AND ur.active = true
    )
  );

CREATE POLICY "Scheduling availability insert access"
  ON public.scheduling_availability
  FOR INSERT
  TO authenticated
  WITH CHECK (
    employee_id = (SELECT auth.uid())
    OR public.business_users_row_matches_session_email(employee_id)
    OR requested_by = (SELECT auth.uid())
    OR public.business_users_row_matches_session_email(requested_by)
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = scheduling_availability.business_id
        AND (
          bu.user_id = (SELECT auth.uid())
          OR public.business_users_row_matches_session_email(bu.user_id)
        )
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = scheduling_availability.business_id
        AND (
          ur.user_id = (SELECT auth.uid())
          OR public.business_users_row_matches_session_email(ur.user_id)
        )
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );
