-- PG cannot use CREATE OR REPLACE to remove parameter defaults from an existing function; drop first.
DO $drop_log_consent$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'log_consent_action'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.fn::text;
  END LOOP;
END
$drop_log_consent$;

CREATE OR REPLACE FUNCTION public.log_consent_action(
  p_business_id uuid,
  p_contact_id uuid,
  p_email_address text,
  p_action text,
  p_consent_source text,
  p_consent_method text,
  p_consent_text text,
  p_ip_address inet,
  p_user_agent text,
  p_additional_data jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamp without time zone := timezone('utc'::text, now());
  v_email text := lower(trim(coalesce(p_email_address, '')));
BEGIN
  INSERT INTO public.mail_consent_log (
    business_id,
    contact_id,
    email_address,
    action,
    consent_source,
    consent_method,
    consent_text,
    ip_address,
    user_agent,
    additional_data
  )
  VALUES (
    p_business_id,
    p_contact_id,
    v_email,
    p_action,
    p_consent_source,
    p_consent_method,
    p_consent_text,
    p_ip_address,
    p_user_agent,
    p_additional_data
  );

  IF p_action IN ('unsubscribe', 'auto_unsubscribe') THEN
    UPDATE public.mail_contacts
    SET
      subscribed = false,
      unsubscribed_at = v_now,
      updated_at = v_now
    WHERE id = p_contact_id
      AND business_id = p_business_id;

    INSERT INTO public.mail_unsubscribes (
      business_id,
      email,
      contact_id,
      unsubscribed_at,
      source,
      ip_address,
      user_agent
    )
    VALUES (
      p_business_id,
      v_email,
      p_contact_id,
      v_now,
      p_consent_source,
      p_ip_address,
      p_user_agent
    )
    ON CONFLICT (business_id, email) DO UPDATE
    SET
      contact_id = excluded.contact_id,
      unsubscribed_at = excluded.unsubscribed_at,
      source = excluded.source,
      ip_address = excluded.ip_address,
      user_agent = excluded.user_agent;
  ELSIF p_action = 'resubscribe' THEN
    UPDATE public.mail_contacts
    SET
      subscribed = true,
      unsubscribed_at = null,
      updated_at = v_now
    WHERE id = p_contact_id
      AND business_id = p_business_id;

    DELETE FROM public.mail_unsubscribes
    WHERE business_id = p_business_id
      AND (email = v_email OR contact_id = p_contact_id);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_consent_action(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  inet,
  text,
  jsonb
) TO anon, authenticated;
