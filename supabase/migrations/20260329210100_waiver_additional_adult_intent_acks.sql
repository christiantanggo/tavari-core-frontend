-- Store pre-sign acknowledgments when primary initiates adding an additional adult (legal / court record).
-- JSON array of { acknowledged_at, disclaimer_version, acknowledgment_text, ip_address, user_agent }

ALTER TABLE waiver_signatures
ADD COLUMN IF NOT EXISTS additional_adult_intent_acknowledgments JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN waiver_signatures.additional_adult_intent_acknowledgments IS
  'Array of records: each time the primary confirms intent to add another adult signer (timestamp, disclaimer text version, IP, user agent).';
