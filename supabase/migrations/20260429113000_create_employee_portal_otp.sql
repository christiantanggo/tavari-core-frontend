CREATE TABLE IF NOT EXISTS public.employee_portal_otp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  email text NOT NULL,
  otp_code text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  verified_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  is_used boolean NOT NULL DEFAULT false,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_portal_otp_lookup
  ON public.employee_portal_otp (phone_number, otp_code, expires_at, is_used)
  WHERE is_used = false;

CREATE INDEX IF NOT EXISTS idx_employee_portal_otp_employee_created
  ON public.employee_portal_otp (employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_employee_portal_otp_expires
  ON public.employee_portal_otp (expires_at, is_used);

ALTER TABLE public.employee_portal_otp ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers can view employee portal OTP logs" ON public.employee_portal_otp;

CREATE POLICY "Managers can view employee portal OTP logs"
  ON public.employee_portal_otp
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = employee_portal_otp.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.business_users bu
      JOIN public.users u ON u.id = bu.user_id
      WHERE bu.business_id = employee_portal_otp.business_id
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
        AND bu.role IN ('owner', 'manager', 'admin', 'hr_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.business_id = employee_portal_otp.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
        AND ur.role IN ('owner', 'manager', 'admin')
    )
  );

CREATE OR REPLACE FUNCTION public.employee_portal_phone_digits(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) = 11
      AND left(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') from 2)
    ELSE regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
  END;
$$;

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
    AND coalesce(trim(u.email), '') <> ''
    AND coalesce(lower(u.employment_status), '') NOT IN ('inactive')
    AND coalesce(lower(u.status), '') NOT IN ('inactive')
    AND coalesce(lower(bu.role), '') IN ('employee', 'staff', 'worker', 'owner', 'manager', 'admin', 'hr_admin')
  ORDER BY u.id, bu.business_id, bu.created_at DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.employee_portal_phone_digits(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_portal_find_employee_by_phone(text) TO anon, authenticated;

COMMENT ON TABLE public.employee_portal_otp IS 'One-time login codes for employee portal phone + email verification.';
COMMENT ON FUNCTION public.employee_portal_find_employee_by_phone(text) IS 'Find employee portal login candidates by normalized employee phone number.';
