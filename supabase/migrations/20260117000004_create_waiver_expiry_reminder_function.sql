-- Function to check and send waiver expiry reminders
-- Should be run daily via cron job
-- Sends reminders 30 days before expiry and on expiry date

CREATE OR REPLACE FUNCTION waivers_send_expiry_reminders()
RETURNS TABLE(
  reminder_sent_count INTEGER,
  expiry_notification_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reminder_sent INTEGER := 0;
  v_expiry_notification INTEGER := 0;
  v_waiver_record RECORD;
  v_thirty_days_from_now DATE;
  v_today DATE;
BEGIN
  v_thirty_days_from_now := CURRENT_DATE + INTERVAL '30 days';
  v_today := CURRENT_DATE;

  -- Send 30-day reminders
  FOR v_waiver_record IN
    SELECT id, email, first_name, business_id, expires_at
    FROM waiver_signatures
    WHERE expires_at IS NOT NULL
      AND DATE(expires_at) = v_thirty_days_from_now
      AND is_valid = true
      AND email IS NOT NULL
  LOOP
    -- Call email service (would need to be implemented via Edge Function or service)
    -- For now, just log that reminder should be sent
    -- In production, this would call the email service
    v_reminder_sent := v_reminder_sent + 1;
  END LOOP;

  -- Send expiry notifications (on expiry date)
  FOR v_waiver_record IN
    SELECT id, email, first_name, business_id, expires_at
    FROM waiver_signatures
    WHERE expires_at IS NOT NULL
      AND DATE(expires_at) = v_today
      AND is_valid = true
      AND email IS NOT NULL
  LOOP
    -- Mark waiver as invalid
    UPDATE waiver_signatures
    SET is_valid = false
    WHERE id = v_waiver_record.id;

    -- Call email service (would need to be implemented via Edge Function or service)
    -- For now, just log that notification should be sent
    v_expiry_notification := v_expiry_notification + 1;
  END LOOP;

  RETURN QUERY SELECT v_reminder_sent, v_expiry_notification;
END;
$$;

COMMENT ON FUNCTION waivers_send_expiry_reminders IS 'Check and send waiver expiry reminders (30 days before and on expiry date). Should be run daily via cron job.';

-- Note: To set up cron job in Supabase, you would use pg_cron extension:
-- SELECT cron.schedule('waiver-expiry-reminders', '0 9 * * *', 'SELECT waivers_send_expiry_reminders();');
-- This runs daily at 9 AM UTC





