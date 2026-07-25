-- Add unlock-related event types to audit_event_type enum (fixes Unlock.jsx 400 on audit_logs insert)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_event_type') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'audit_event_type' AND e.enumlabel = 'pin_login') THEN
      ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'pin_login';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'audit_event_type' AND e.enumlabel = 'pin_unlock') THEN
      ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'pin_unlock';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'audit_event_type' AND e.enumlabel = 'failed_pin_login') THEN
      ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'failed_pin_login';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'audit_event_type' AND e.enumlabel = 'suspicious_activity') THEN
      ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'suspicious_activity';
    END IF;
  END IF;
END $$;
