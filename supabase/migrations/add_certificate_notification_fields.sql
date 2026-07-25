-- Add certificate expiration notification fields to hr_certificates table
-- This allows configuring when to send expiration reminders and to whom

-- Add notification fields
ALTER TABLE hr_certificates
ADD COLUMN IF NOT EXISTS notify_days_before_expiry INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS notify_on_expiry_date BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS notification_recipient_emails TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS enable_notifications BOOLEAN DEFAULT true;

-- Add comments
COMMENT ON COLUMN hr_certificates.notify_days_before_expiry IS 'Number of days before expiration to send notification email (e.g., 30 for 30 days before)';
COMMENT ON COLUMN hr_certificates.notify_on_expiry_date IS 'Whether to send a reminder email on the certificate expiration date';
COMMENT ON COLUMN hr_certificates.notification_recipient_emails IS 'Array of email addresses to notify (in addition to the employee). Used for HR, managers, or designated contacts.';
COMMENT ON COLUMN hr_certificates.enable_notifications IS 'Whether expiration notifications are enabled for this certificate type';

-- Create index for efficient queries when checking expiring certificates
CREATE INDEX IF NOT EXISTS idx_hr_certificates_notifications 
ON hr_certificates(business_id, enable_notifications, is_active)
WHERE enable_notifications = true AND is_active = true;


















