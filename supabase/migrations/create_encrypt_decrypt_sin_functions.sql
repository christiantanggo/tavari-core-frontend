-- Create encrypt_sin and decrypt_sin RPC functions for secure SIN handling
-- These functions use PostgreSQL's pgcrypto extension for encryption

-- Ensure pgcrypto extension is enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Drop existing encrypt_sin function if it exists (with any signature)
DROP FUNCTION IF EXISTS encrypt_sin(TEXT, UUID);
DROP FUNCTION IF EXISTS encrypt_sin(TEXT);
DROP FUNCTION IF EXISTS encrypt_sin;

-- Function to encrypt SIN number
-- Uses business-specific encryption key derived from business_id
CREATE OR REPLACE FUNCTION encrypt_sin(
  sin_text TEXT,
  business_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  encryption_key TEXT;
  encrypted_result TEXT;
BEGIN
  -- Validate input
  IF sin_text IS NULL OR length(trim(sin_text)) = 0 THEN
    RAISE EXCEPTION 'SIN text cannot be empty';
  END IF;
  
  IF business_id IS NULL THEN
    RAISE EXCEPTION 'Business ID is required for encryption';
  END IF;
  
  -- Generate encryption key from business_id
  -- This ensures each business has a unique encryption key
  encryption_key := encode(digest(business_id::text || 'sin_encryption_salt_v1', 'sha256'), 'hex');
  
  -- Encrypt the SIN using AES-256 encryption
  -- pgp_sym_encrypt encrypts data using a symmetric key
  encrypted_result := encode(
    pgp_sym_encrypt(
      sin_text,
      encryption_key
    ),
    'base64'
  );
  
  RETURN encrypted_result;
END;
$$;

-- Drop existing decrypt_sin function if it exists (with any signature)
DROP FUNCTION IF EXISTS decrypt_sin(TEXT, UUID);
DROP FUNCTION IF EXISTS decrypt_sin(TEXT);
DROP FUNCTION IF EXISTS decrypt_sin;

-- Function to decrypt SIN number
-- Uses business-specific encryption key derived from business_id
CREATE OR REPLACE FUNCTION decrypt_sin(
  encrypted_data TEXT,
  business_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  encryption_key TEXT;
  decrypted_result TEXT;
BEGIN
  -- Validate input
  IF encrypted_data IS NULL OR length(trim(encrypted_data)) = 0 THEN
    RAISE EXCEPTION 'Encrypted data cannot be empty';
  END IF;
  
  IF business_id IS NULL THEN
    RAISE EXCEPTION 'Business ID is required for decryption';
  END IF;
  
  -- Generate encryption key from business_id (must match encrypt_sin)
  encryption_key := encode(digest(business_id::text || 'sin_encryption_salt_v1', 'sha256'), 'hex');
  
  -- Decrypt the SIN
  BEGIN
    decrypted_result := pgp_sym_decrypt(
      decode(encrypted_data, 'base64'),
      encryption_key
    );
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'Failed to decrypt SIN: %', SQLERRM;
  END;
  
  RETURN decrypted_result;
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION encrypt_sin(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION decrypt_sin(TEXT, UUID) TO authenticated;

-- Add comments
COMMENT ON FUNCTION encrypt_sin IS 'Encrypts a SIN number using business-specific encryption key. Returns base64-encoded encrypted data.';
COMMENT ON FUNCTION decrypt_sin IS 'Decrypts a SIN number using business-specific encryption key. Requires the same business_id used for encryption.';

NOTIFY pgrst, 'reload schema';

