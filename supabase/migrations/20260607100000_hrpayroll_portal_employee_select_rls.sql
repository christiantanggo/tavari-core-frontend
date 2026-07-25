-- Employee portal loads pay statements by joining hrpayroll_entries to hrpayroll_runs.
-- Many environments allow managers to read runs by business_id, but employees could not
-- SELECT hrpayroll_runs rows directly — so prefetching runs returned 0 rows under RLS while
-- notifications (service role) still saw data.
--
-- Uses public.business_users_row_matches_session_email from 20260602121500 so split
-- auth.users.id vs public.users.id accounts still work.

ALTER TABLE IF EXISTS public.hrpayroll_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.hrpayroll_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hrpayroll_entries_select_authenticated_own_row ON public.hrpayroll_entries;

CREATE POLICY hrpayroll_entries_select_authenticated_own_row
ON public.hrpayroll_entries
FOR SELECT
TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR public.business_users_row_matches_session_email(user_id)
);

COMMENT ON POLICY hrpayroll_entries_select_authenticated_own_row ON public.hrpayroll_entries IS
  'Employees may read their own payroll entry rows (JWT email matches public.users profile).';

-- Avoid 42P17 infinite recursion: inline EXISTS on hrpayroll_entries re-enters RLS.
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
  'RLS helper: true if an hrpayroll_entries row exists for this run for the session user.';

DROP POLICY IF EXISTS hrpayroll_runs_select_when_employee_has_entry ON public.hrpayroll_runs;

CREATE POLICY hrpayroll_runs_select_when_employee_has_entry
ON public.hrpayroll_runs
FOR SELECT
TO authenticated
USING (public.hrpayroll_run_has_visible_entry_for_session(id));

COMMENT ON POLICY hrpayroll_runs_select_when_employee_has_entry ON public.hrpayroll_runs IS
  'Employees may read a payroll run row if they have an entry on that run (non-recursive helper).';
