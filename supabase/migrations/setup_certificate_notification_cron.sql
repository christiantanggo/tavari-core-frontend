-- Setup pg_cron to run certificate expiration notifications daily
-- This checks for expiring certificates and sends notification emails

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the certificate expiration notification check to run daily at 8:00 AM
-- Note: This assumes you have a Supabase Edge Function endpoint
-- Adjust the URL and schedule as needed

-- Option 1: If using Supabase Edge Function (recommended)
-- You'll need to call the edge function via HTTP
-- This requires setting up a webhook or using Supabase's scheduled functions

-- Option 2: Create a database function that can be called by pg_cron
-- This function will check for expiring certificates and log them
-- The actual email sending should be handled by an Edge Function or external service

CREATE OR REPLACE FUNCTION check_certificate_expirations()
RETURNS TABLE (
  employee_id UUID,
  employee_email TEXT,
  employee_name TEXT,
  certificate_id UUID,
  certificate_name TEXT,
  expiry_date DATE,
  days_until_expiry INTEGER,
  business_id UUID,
  business_name TEXT,
  notification_emails TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  WITH expiring_certs AS (
    SELECT 
      ec.id as cert_id,
      ec.employee_id,
      ec.expiry_date,
      hc.id as cert_type_id,
      hc.name as cert_name,
      hc.notify_days_before_expiry,
      hc.notify_on_expiry_date,
      hc.notification_recipient_emails,
      b.id as business_id,
      b.business_name,
      u.email as employee_email,
      u.full_name as employee_name,
      CURRENT_DATE as today
    FROM employee_certificates ec
    INNER JOIN hr_certificates hc ON ec.certificate_id = hc.id
    INNER JOIN businesses b ON hc.business_id = b.id
    INNER JOIN users u ON ec.employee_id = u.id
    WHERE ec.status = 'active'
      AND ec.expiry_date IS NOT NULL
      AND hc.is_active = true
      AND hc.enable_notifications = true
      AND ec.expiry_date >= CURRENT_DATE
      AND (
        -- Within notification window
        (ec.expiry_date - CURRENT_DATE) <= (hc.notify_days_before_expiry)
        OR
        -- On expiry date if enabled
        (hc.notify_on_expiry_date AND ec.expiry_date = CURRENT_DATE)
      )
  )
  SELECT 
    ec.employee_id,
    ec.employee_email,
    ec.employee_name,
    ec.cert_id,
    ec.cert_name,
    ec.expiry_date,
    (ec.expiry_date - ec.today)::INTEGER as days_until_expiry,
    ec.business_id,
    ec.business_name,
    COALESCE(ec.notification_recipient_emails, ARRAY[]::TEXT[]) as notification_emails
  FROM expiring_certs ec;
END;
$$ LANGUAGE plpgsql;

-- Create a table to track sent notifications (to avoid duplicate emails)
CREATE TABLE IF NOT EXISTS certificate_notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_certificate_id UUID NOT NULL REFERENCES employee_certificates(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL, -- 'before_expiry' or 'on_expiry'
  notification_date DATE NOT NULL,
  days_before_expiry INTEGER,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email_recipients TEXT[] NOT NULL,
  email_sent BOOLEAN DEFAULT false,
  email_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cert_notification_log_cert 
ON certificate_notification_log(employee_certificate_id, notification_date);

-- Function to check if notification was already sent today
CREATE OR REPLACE FUNCTION was_notification_sent_today(
  p_certificate_id UUID,
  p_notification_type TEXT
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM certificate_notification_log
    WHERE employee_certificate_id = p_certificate_id
      AND notification_type = p_notification_type
      AND notification_date = CURRENT_DATE
      AND email_sent = true
  );
END;
$$ LANGUAGE plpgsql;

-- Note: To actually send emails, you'll need to:
-- 1. Set up a Supabase Edge Function (certificate-expiration-notifications)
-- 2. Call it via HTTP from pg_cron, or
-- 3. Use Supabase's scheduled functions feature
-- 4. Or set up an external cron job that calls the edge function

-- Example pg_cron job (requires superuser access):
-- SELECT cron.schedule(
--   'certificate-expiration-check',
--   '0 8 * * *', -- Daily at 8:00 AM
--   $$SELECT check_certificate_expirations()$$
-- );


















