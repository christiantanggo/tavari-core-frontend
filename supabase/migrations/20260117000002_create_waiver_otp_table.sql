-- Create waiver_otp table for OTP authentication during waiver signing
-- OTP is sent to customer email on file, expires in 10 minutes

CREATE TABLE IF NOT EXISTS waiver_otp (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES pos_loyalty_accounts(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  email TEXT NOT NULL,
  otp_code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  verified_at TIMESTAMPTZ,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  is_used BOOLEAN DEFAULT false,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for OTP lookup by phone and code
CREATE INDEX IF NOT EXISTS idx_waiver_otp_phone_code 
ON waiver_otp (phone_number, otp_code, expires_at, is_used)
WHERE is_used = false;

-- Create index for cleanup (expired OTPs)
CREATE INDEX IF NOT EXISTS idx_waiver_otp_expires 
ON waiver_otp (expires_at, is_used);

-- Enable RLS
ALTER TABLE waiver_otp ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Public can insert OTP requests, business members can view
CREATE POLICY waiver_otp_insert_public ON waiver_otp
  FOR INSERT
  WITH CHECK (true); -- Public can request OTP

CREATE POLICY waiver_otp_select_business ON waiver_otp
  FOR SELECT
  USING (
    business_id IN (
      SELECT business_id FROM user_roles 
      WHERE user_id = auth.uid() AND active = true
    )
  );

-- Add comment
COMMENT ON TABLE waiver_otp IS 'OTP codes for waiver signing authentication. OTP is sent to customer email, expires in 10 minutes.';





