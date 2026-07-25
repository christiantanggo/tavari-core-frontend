-- Step 10: Create waiver_audit_log table
-- Purpose: Store audit trail for waiver actions
-- Note: Alternatively, could use existing audit_logs table with event_type = 'waiver.*'

CREATE TABLE IF NOT EXISTS waiver_audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  waiver_id UUID REFERENCES waiver_signatures(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  action_details JSONB,
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  performed_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_waiver_audit_log_business 
  ON waiver_audit_log (business_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_waiver_audit_log_waiver 
  ON waiver_audit_log (waiver_id, performed_at DESC) 
  WHERE waiver_id IS NOT NULL;

-- Enable RLS (policies will be created in Step 50+)
ALTER TABLE waiver_audit_log ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE waiver_audit_log IS 'Audit trail for waiver actions (created, signed, viewed, downloaded, uploaded, etc.)';
COMMENT ON COLUMN waiver_audit_log.action_type IS 'Type of action: created, signed, expired, viewed, downloaded, uploaded, etc.';
COMMENT ON COLUMN waiver_audit_log.action_details IS 'JSONB object containing detailed information about the action';




