-- Employee display numbers: backfill missing values and auto-assign on new public.users rows.
-- public.users.id is the canonical profile key; auth.users.id should match for new onboarding
-- (handled in app edge functions / RPC when auth is created first). This migration only
-- addresses NULL/blank employee_number for people linked to a business.

CREATE SEQUENCE IF NOT EXISTS public.employee_display_number_seq;

SELECT setval(
  'public.employee_display_number_seq',
  COALESCE(
    (
      SELECT MAX((regexp_match(COALESCE(u.employee_number, ''), '([0-9]+)$'))[1]::bigint)
      FROM public.users u
      WHERE u.employee_number IS NOT NULL
        AND btrim(u.employee_number::text) <> ''
        AND (regexp_match(COALESCE(u.employee_number, ''), '([0-9]+)$'))[1] IS NOT NULL
    ),
    0
  ),
  true
);

UPDATE public.users u
SET employee_number = 'EMP' || lpad(nextval('public.employee_display_number_seq')::text, 8, '0')
WHERE (u.employee_number IS NULL OR btrim(u.employee_number::text) = '')
  AND EXISTS (SELECT 1 FROM public.business_users bu WHERE bu.user_id = u.id);

CREATE OR REPLACE FUNCTION public.users_assign_employee_number_if_missing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.employee_number IS NULL OR btrim(COALESCE(NEW.employee_number::text, '')) = '' THEN
    NEW.employee_number := 'EMP' || lpad(nextval('public.employee_display_number_seq')::text, 8, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_assign_employee_number_before_write ON public.users;

CREATE TRIGGER users_assign_employee_number_before_write
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.users_assign_employee_number_if_missing();

COMMENT ON FUNCTION public.users_assign_employee_number_if_missing() IS
  'Fills employee_number when missing so HR lists and editors always have a stable display id.';

COMMENT ON SEQUENCE public.employee_display_number_seq IS
  'Monotonic suffix source for default EMP######## employee numbers.';
