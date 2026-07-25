-- employee_sin_numbers.employee_id references public.users.id; existing policies only
-- allowed employee_id = auth.uid(). Split auth/profile IDs blocked INSERT/UPDATE.
-- Reuse JWT email match helper from split-identity portal migration.

DROP POLICY IF EXISTS "Employees can view their own SIN" ON public.employee_sin_numbers;
DROP POLICY IF EXISTS "Employees can create their own SIN" ON public.employee_sin_numbers;
DROP POLICY IF EXISTS "Employees can update their own SIN" ON public.employee_sin_numbers;

CREATE POLICY "Employees can view their own SIN"
  ON public.employee_sin_numbers
  FOR SELECT
  TO authenticated
  USING (
    employee_id = (SELECT auth.uid())
    OR public.business_users_row_matches_session_email(employee_id)
  );

CREATE POLICY "Employees can create their own SIN"
  ON public.employee_sin_numbers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    employee_id = (SELECT auth.uid())
    OR public.business_users_row_matches_session_email(employee_id)
  );

CREATE POLICY "Employees can update their own SIN"
  ON public.employee_sin_numbers
  FOR UPDATE
  TO authenticated
  USING (
    employee_id = (SELECT auth.uid())
    OR public.business_users_row_matches_session_email(employee_id)
  )
  WITH CHECK (
    employee_id = (SELECT auth.uid())
    OR public.business_users_row_matches_session_email(employee_id)
  );
