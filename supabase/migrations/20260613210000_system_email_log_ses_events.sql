-- Correlate SES SNS events (bounce, complaint, delivery, reject) to system_email_log rows
-- so Tavari can show recipient-side outcomes and reasons (error_message + metadata).

ALTER TABLE public.system_email_log
  DROP CONSTRAINT IF EXISTS system_email_log_status_check;

ALTER TABLE public.system_email_log
  ADD CONSTRAINT system_email_log_status_check
  CHECK (status IN (
    'queued',
    'sent',
    'failed',
    'blocked',
    'suppressed',
    'unsubscribed',
    'bounced',
    'complained',
    'delivered',
    'rejected'
  ));

ALTER TABLE public.system_email_log
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_system_email_log_ses_message_id
  ON public.system_email_log (ses_message_id)
  WHERE ses_message_id IS NOT NULL;

COMMENT ON COLUMN public.system_email_log.delivered_at IS
  'When SES reported successful handoff to recipient MX (Delivery event), if configured.';

CREATE OR REPLACE FUNCTION public.system_email_log_apply_ses_event(
  p_ses_message_id text,
  p_recipient_email text,
  p_status text,
  p_error_message text DEFAULT NULL,
  p_event_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm_id text;
  v_rec text;
  v_updated integer := 0;
BEGIN
  v_norm_id := trim(both '<>' FROM coalesce(p_ses_message_id, ''));
  v_rec := lower(trim(coalesce(p_recipient_email, '')));

  IF length(v_norm_id) = 0 OR length(v_rec) = 0 THEN
    RETURN 0;
  END IF;

  IF p_status NOT IN ('bounced', 'complained', 'delivered', 'rejected') THEN
    RETURN 0;
  END IF;

  UPDATE public.system_email_log s
  SET
    status = CASE
      WHEN p_status = 'delivered' THEN 'delivered'
      WHEN p_status IN ('bounced', 'complained', 'rejected') THEN p_status
      ELSE s.status
    END,
    error_message = CASE
      WHEN p_status = 'delivered' AND p_error_message IS NOT NULL THEN p_error_message
      WHEN p_status IN ('bounced', 'complained', 'rejected') AND p_error_message IS NOT NULL
        THEN p_error_message
      WHEN p_status IN ('bounced', 'complained', 'rejected') AND p_error_message IS NULL
        THEN s.error_message
      ELSE s.error_message
    END,
    delivered_at = CASE
      WHEN p_status = 'delivered' AND s.status = 'sent' THEN timezone('utc'::text, now())
      ELSE s.delivered_at
    END,
    metadata = coalesce(s.metadata, '{}'::jsonb) || coalesce(p_event_metadata, '{}'::jsonb)
  WHERE coalesce(s.ses_message_id, '') IN (v_norm_id, '<' || v_norm_id || '>')
    AND (
      lower(trim(coalesce(s.recipient_email, ''))) = v_rec
      OR v_rec = ANY (SELECT lower(trim(t)) FROM unnest(coalesce(s.to_addresses, ARRAY[]::text[])) AS t)
    )
    AND (
      (p_status IN ('bounced', 'complained', 'rejected') AND s.status NOT IN ('bounced', 'complained', 'rejected'))
      OR (p_status = 'delivered' AND s.status = 'sent')
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.system_email_log_apply_ses_event(text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.system_email_log_apply_ses_event(text, text, text, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.system_email_log_apply_ses_event(text, text, text, text, jsonb) IS
  'Apply SES bounce/complaint/delivery/reject outcome to matching system_email_log row(s) by ses_message_id and recipient.';
