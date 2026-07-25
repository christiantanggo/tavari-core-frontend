-- Backfill hrpayroll_entries.business_id from the parent payroll run, and keep it in sync going forward.

UPDATE public.hrpayroll_entries e
SET
  business_id = r.business_id,
  updated_at = timezone('utc', now())
FROM public.hrpayroll_runs r
WHERE e.payroll_run_id = r.id
  AND e.business_id IS NULL
  AND r.business_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_hrpayroll_entry_business_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.business_id IS NULL AND NEW.payroll_run_id IS NOT NULL THEN
    SELECT r.business_id
    INTO NEW.business_id
    FROM public.hrpayroll_runs r
    WHERE r.id = NEW.payroll_run_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hrpayroll_entries_set_business_id ON public.hrpayroll_entries;

CREATE TRIGGER trg_hrpayroll_entries_set_business_id
BEFORE INSERT OR UPDATE OF payroll_run_id, business_id
ON public.hrpayroll_entries
FOR EACH ROW
EXECUTE FUNCTION public.set_hrpayroll_entry_business_id();

COMMENT ON FUNCTION public.set_hrpayroll_entry_business_id() IS
  'Copies hrpayroll_runs.business_id onto hrpayroll_entries when the entry business_id is null.';
