-- Fix 42P17 infinite recursion on hrpayroll_runs: the prior policy's EXISTS subquery on
-- hrpayroll_entries re-entered RLS in a cycle. Use SECURITY DEFINER + row_security off so
-- the visibility check does not recurse.

CREATE OR REPLACE FUNCTION public.hrpayroll_run_has_visible_entry_for_session(p_run_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.hrpayroll_entries e
    WHERE e.payroll_run_id = p_run_id
      AND (
        e.user_id = (SELECT auth.uid())
        OR public.business_users_row_matches_session_email(e.user_id)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.hrpayroll_run_has_visible_entry_for_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hrpayroll_run_has_visible_entry_for_session(uuid) TO authenticated;

COMMENT ON FUNCTION public.hrpayroll_run_has_visible_entry_for_session(uuid) IS
  'RLS helper: true if an hrpayroll_entries row exists for this run for the current session user (avoids recursive policies).';

DROP POLICY IF EXISTS hrpayroll_runs_select_when_employee_has_entry ON public.hrpayroll_runs;

CREATE POLICY hrpayroll_runs_select_when_employee_has_entry
ON public.hrpayroll_runs
FOR SELECT
TO authenticated
USING (public.hrpayroll_run_has_visible_entry_for_session(id));

COMMENT ON POLICY hrpayroll_runs_select_when_employee_has_entry ON public.hrpayroll_runs IS
  'Employees may read a payroll run row if they have an entry on that run (non-recursive helper).';
