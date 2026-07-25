CREATE OR REPLACE FUNCTION public.employee_portal_find_employee_by_phone(p_phone text)
RETURNS TABLE (
  employee_id uuid,
  email text,
  full_name text,
  first_name text,
  last_name text,
  phone text,
  employment_status text,
  termination_date date,
  business_id uuid,
  business_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (u.id, bu.business_id)
    u.id AS employee_id,
    u.email,
    u.full_name,
    u.first_name,
    u.last_name,
    u.phone,
    u.employment_status,
    u.termination_date,
    bu.business_id,
    b.name AS business_name
  FROM public.users u
  JOIN public.business_users bu ON bu.user_id = u.id
  LEFT JOIN public.businesses b ON b.id = bu.business_id
  WHERE public.employee_portal_phone_digits(u.phone) = public.employee_portal_phone_digits(p_phone)
    AND length(public.employee_portal_phone_digits(p_phone)) >= 10
    AND coalesce(lower(u.employment_status), '') NOT IN ('inactive')
    AND coalesce(lower(u.status), '') NOT IN ('inactive')
    AND coalesce(lower(bu.role), '') IN ('employee', 'staff', 'worker', 'owner', 'manager', 'admin', 'hr_admin')
  ORDER BY u.id, bu.business_id, bu.created_at DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.employee_portal_find_employee_by_phone(text) TO anon, authenticated;
