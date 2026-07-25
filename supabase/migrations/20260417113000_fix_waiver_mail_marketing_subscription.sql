CREATE OR REPLACE FUNCTION public.sync_waiver_mail_contact(
  p_business_id uuid,
  p_waiver_id uuid,
  p_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_waiver RECORD;
  v_contact RECORD;
  v_contact_id uuid;
  v_email text;
  v_ip_address inet := null;
  v_now timestamp without time zone := timezone('utc'::text, now());
  v_marketing_opt_in boolean := false;
  v_marketing_declined boolean := false;
  v_has_marketing_choice boolean := false;
  v_auto_click_marketing boolean := true;
BEGIN
  SELECT *
  INTO v_waiver
  FROM public.waiver_signatures
  WHERE id = p_waiver_id
    AND business_id = p_business_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Waiver % not found for business %', p_waiver_id, p_business_id;
  END IF;

  v_email := lower(trim(coalesce(nullif(p_email, ''), nullif(v_waiver.email, ''))));

  IF v_email IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object(
      'synced', false,
      'reason', 'missing_email',
      'contact_id', null,
      'marketing_opt_in', false,
      'marketing_declined', false,
      'has_marketing_choice', false
    );
  END IF;

  BEGIN
    v_ip_address := nullif(trim(coalesce((to_jsonb(v_waiver) ->> 'ip_address'), '')), '')::inet;
  EXCEPTION
    WHEN OTHERS THEN
      v_ip_address := null;
  END;

  SELECT
    bool_or(lower(coalesce(consent_type, '')) = 'marketing'),
    bool_or(lower(coalesce(consent_type, '')) = 'marketing' AND coalesce(consent_given, false)),
    bool_or(lower(coalesce(consent_type, '')) = 'marketing' AND NOT coalesce(consent_given, false))
  INTO
    v_has_marketing_choice,
    v_marketing_opt_in,
    v_marketing_declined
  FROM public.waiver_consents
  WHERE waiver_id = p_waiver_id;

  SELECT
    CASE
      WHEN lower(trim(both '"' from coalesce(setting_value::text, ''))) IN ('false', '0', 'no', 'off') THEN false
      ELSE true
    END
  INTO v_auto_click_marketing
  FROM public.waiver_settings
  WHERE business_id = p_business_id
    AND setting_key = 'auto_click_marketing'
    AND is_global = true
  ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1;

  -- Prefer the explicit waiver record when it exists, then fall back to the business setting.
  -- This covers flows where the waiver record captured marketing_opt_in but the audit row is
  -- missing, while still preserving the kiosk default-on behavior.
  IF NOT v_has_marketing_choice
     AND coalesce((to_jsonb(v_waiver) ->> 'marketing_opt_in')::boolean, false) THEN
    v_marketing_opt_in := true;
  ELSIF NOT v_has_marketing_choice AND v_auto_click_marketing AND NOT v_marketing_declined THEN
    v_marketing_opt_in := true;
  END IF;

  SELECT *
  INTO v_contact
  FROM public.mail_contacts
  WHERE business_id = p_business_id
    AND lower(email) = v_email
  ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.mail_contacts
    SET
      first_name = coalesce(v_waiver.first_name, first_name),
      last_name = coalesce(v_waiver.last_name, last_name),
      phone = coalesce(v_waiver.phone_number, phone),
      source = coalesce(source, 'waiver'),
      consent_source = CASE
        WHEN v_marketing_opt_in OR v_marketing_declined THEN 'waiver'
        ELSE consent_source
      END,
      consent_timestamp = CASE
        WHEN v_marketing_opt_in OR v_marketing_declined THEN coalesce(consent_timestamp, v_now)
        ELSE consent_timestamp
      END,
      consent_ip_address = CASE
        WHEN v_marketing_opt_in OR v_marketing_declined THEN coalesce(v_ip_address, consent_ip_address)
        ELSE consent_ip_address
      END,
      consent_user_agent = CASE
        WHEN v_marketing_opt_in OR v_marketing_declined THEN coalesce(v_waiver.user_agent, consent_user_agent)
        ELSE consent_user_agent
      END,
      consent_method = CASE
        WHEN v_marketing_opt_in AND v_has_marketing_choice THEN 'express'
        WHEN v_marketing_opt_in THEN 'implied'
        WHEN v_marketing_declined THEN 'express'
        ELSE consent_method
      END,
      consent_text = CASE
        WHEN v_marketing_opt_in AND v_has_marketing_choice THEN 'Marketing consent granted during waiver signing.'
        WHEN v_marketing_opt_in THEN 'Marketing consent applied from waiver settings during waiver signing.'
        WHEN v_marketing_declined THEN 'Marketing consent declined during waiver signing.'
        ELSE consent_text
      END,
      subscribed = CASE
        WHEN v_marketing_opt_in THEN true
        WHEN v_marketing_declined THEN false
        ELSE subscribed
      END,
      unsubscribed_at = CASE
        WHEN v_marketing_opt_in THEN null
        WHEN v_marketing_declined THEN v_now
        ELSE unsubscribed_at
      END,
      updated_at = v_now
    WHERE id = v_contact.id
    RETURNING id INTO v_contact_id;
  ELSE
    INSERT INTO public.mail_contacts (
      business_id,
      first_name,
      last_name,
      email,
      phone,
      subscribed,
      unsubscribed_at,
      source,
      consent_source,
      consent_timestamp,
      consent_ip_address,
      consent_user_agent,
      consent_method,
      consent_text,
      created_at,
      updated_at
    )
    VALUES (
      p_business_id,
      v_waiver.first_name,
      v_waiver.last_name,
      v_email,
      v_waiver.phone_number,
      CASE
        WHEN v_marketing_declined THEN false
        WHEN v_marketing_opt_in THEN true
        ELSE false
      END,
      CASE WHEN v_marketing_declined THEN v_now ELSE null END,
      'waiver',
      CASE
        WHEN v_marketing_opt_in OR v_marketing_declined THEN 'waiver'
        ELSE null
      END,
      CASE
        WHEN v_marketing_opt_in OR v_marketing_declined THEN v_now
        ELSE null
      END,
      v_ip_address,
      v_waiver.user_agent,
      CASE
        WHEN v_marketing_opt_in AND v_has_marketing_choice THEN 'express'
        WHEN v_marketing_opt_in THEN 'implied'
        WHEN v_marketing_declined THEN 'express'
        ELSE null
      END,
      CASE
        WHEN v_marketing_opt_in AND v_has_marketing_choice THEN 'Marketing consent granted during waiver signing.'
        WHEN v_marketing_opt_in THEN 'Marketing consent applied from waiver settings during waiver signing.'
        WHEN v_marketing_declined THEN 'Marketing consent declined during waiver signing.'
        ELSE null
      END,
      v_now,
      v_now
    )
    RETURNING id INTO v_contact_id;
  END IF;

  IF v_marketing_opt_in THEN
    DELETE FROM public.mail_unsubscribes
    WHERE business_id = p_business_id
      AND (lower(email) = v_email OR contact_id = v_contact_id);

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
      v_contact_id,
      v_email,
      'subscribed',
      'waiver',
      'signed_waiver',
      'Marketing consent granted during waiver signing.',
      v_ip_address,
      v_waiver.user_agent,
      jsonb_build_object(
        'waiver_id', p_waiver_id,
        'consent_type', 'marketing',
        'consent_given', true
      )
    );
  ELSIF v_marketing_declined THEN
    DELETE FROM public.mail_unsubscribes
    WHERE business_id = p_business_id
      AND (lower(email) = v_email OR contact_id = v_contact_id);

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
      v_contact_id,
      v_now,
      'waiver',
      v_ip_address,
      v_waiver.user_agent
    );

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
      v_contact_id,
      v_email,
      'unsubscribed',
      'waiver',
      'signed_waiver',
      'Marketing consent declined during waiver signing.',
      v_ip_address,
      v_waiver.user_agent,
      jsonb_build_object(
        'waiver_id', p_waiver_id,
        'consent_type', 'marketing',
        'consent_given', false
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'synced', true,
    'contact_id', v_contact_id,
    'email', v_email,
    'marketing_opt_in', v_marketing_opt_in,
    'marketing_declined', v_marketing_declined,
    'has_marketing_choice', v_has_marketing_choice
  );
END;
$$;
