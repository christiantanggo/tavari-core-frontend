CREATE OR REPLACE FUNCTION public.ensure_current_mail_billing_record(p_business_id uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_period_start date := date_trunc('month', CURRENT_DATE)::date;
  v_period_end date := (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date;
  v_billing_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_business_id::text || ':' || v_period_start::text));

  SELECT id
  INTO v_billing_id
  FROM public.mail_billing
  WHERE business_id = p_business_id
    AND billing_period_start = v_period_start
    AND billing_period_end = v_period_end
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_billing_id IS NULL THEN
    INSERT INTO public.mail_billing (
      business_id,
      billing_period_start,
      billing_period_end,
      included_emails,
      emails_used,
      overage_emails,
      overage_rate,
      overage_cost,
      total_amount,
      total_cost,
      status
    )
    VALUES (
      p_business_id,
      v_period_start,
      v_period_end,
      5000,
      0,
      0,
      0.0025,
      0,
      0,
      0,
      'active'
    )
    RETURNING id INTO v_billing_id;
  END IF;

  RETURN v_billing_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_mail_billing_send_allowed(
  p_business_id uuid,
  p_email_type text DEFAULT 'marketing'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_billing_id uuid;
  v_billing public.mail_billing%ROWTYPE;
BEGIN
  IF coalesce(p_email_type, 'marketing') = 'transactional' THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'enforced', false,
      'reason', null
    );
  END IF;

  v_billing_id := public.ensure_current_mail_billing_record(p_business_id);

  SELECT *
  INTO v_billing
  FROM public.mail_billing
  WHERE id = v_billing_id;

  IF v_billing.status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'enforced', true,
      'reason', CASE
        WHEN v_billing.status = 'paused' THEN 'Mail billing is paused for this business'
        ELSE 'Mail billing is not active for this business'
      END,
      'status', v_billing.status
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'enforced', true,
    'status', v_billing.status,
    'billing_id', v_billing.id,
    'included_emails', coalesce(v_billing.included_emails, 0),
    'emails_used', coalesce(v_billing.emails_used, 0),
    'overage_emails', coalesce(v_billing.overage_emails, 0),
    'overage_rate', coalesce(v_billing.overage_rate, 0.0025)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_mail_billing_usage(
  p_business_id uuid,
  p_email_type text DEFAULT 'marketing',
  p_email_count integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_billing_id uuid;
  v_billing public.mail_billing%ROWTYPE;
  v_email_count integer := greatest(coalesce(p_email_count, 0), 0);
  v_new_used integer;
  v_new_overage integer;
  v_new_cost numeric;
BEGIN
  IF coalesce(p_email_type, 'marketing') = 'transactional' THEN
    RETURN jsonb_build_object(
      'counted', false,
      'reason', 'transactional_email'
    );
  END IF;

  IF v_email_count = 0 THEN
    RETURN jsonb_build_object(
      'counted', false,
      'reason', 'no_emails'
    );
  END IF;

  v_billing_id := public.ensure_current_mail_billing_record(p_business_id);

  SELECT *
  INTO v_billing
  FROM public.mail_billing
  WHERE id = v_billing_id
  FOR UPDATE;

  IF v_billing.status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object(
      'counted', false,
      'reason', 'billing_not_active',
      'status', v_billing.status
    );
  END IF;

  v_new_used := coalesce(v_billing.emails_used, 0) + v_email_count;
  v_new_overage := greatest(0, v_new_used - coalesce(v_billing.included_emails, 0));
  v_new_cost := v_new_overage * coalesce(v_billing.overage_rate, 0.0025);

  UPDATE public.mail_billing
  SET
    emails_used = v_new_used,
    overage_emails = v_new_overage,
    overage_cost = v_new_cost,
    total_amount = v_new_cost,
    total_cost = v_new_cost,
    updated_at = timezone('utc'::text, now())
  WHERE id = v_billing_id
  RETURNING * INTO v_billing;

  RETURN jsonb_build_object(
    'counted', true,
    'billing_id', v_billing.id,
    'emails_used', v_billing.emails_used,
    'included_emails', v_billing.included_emails,
    'overage_emails', v_billing.overage_emails,
    'overage_cost', v_billing.overage_cost,
    'total_cost', v_billing.total_cost
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_billing_usage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_business_id uuid;
BEGIN
  IF NEW.status = 'sent' AND (TG_OP = 'INSERT' OR coalesce(OLD.status, '') <> 'sent') THEN
    SELECT business_id
    INTO v_business_id
    FROM public.mail_campaigns
    WHERE id = NEW.campaign_id;

    IF v_business_id IS NOT NULL THEN
      PERFORM public.increment_mail_billing_usage(v_business_id, 'marketing', 1);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mail_campaign_sends_billing_usage ON public.mail_campaign_sends;

CREATE TRIGGER trg_mail_campaign_sends_billing_usage
AFTER INSERT OR UPDATE OF status ON public.mail_campaign_sends
FOR EACH ROW
EXECUTE FUNCTION public.update_billing_usage();
