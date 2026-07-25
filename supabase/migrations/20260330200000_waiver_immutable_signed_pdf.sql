-- Immutable signed waiver: archive path metadata + enforce no edits after PDF is stored.
-- Canonical storage object key (bucket waivers): waivers/{business_id}/{waiver_id}.pdf

ALTER TABLE waiver_signatures
  ADD COLUMN IF NOT EXISTS signed_pdf_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS signed_pdf_uploaded_at TIMESTAMPTZ;

COMMENT ON COLUMN waiver_signatures.signed_pdf_storage_path IS 'Supabase Storage object path in bucket waivers (immutable legal PDF)';
COMMENT ON COLUMN waiver_signatures.signed_pdf_uploaded_at IS 'When the signed PDF was written to storage; after this, row is legally locked';

CREATE INDEX IF NOT EXISTS idx_waiver_signatures_pdf_uploaded
  ON waiver_signatures (business_id, signed_pdf_uploaded_at)
  WHERE signed_pdf_uploaded_at IS NOT NULL;

-- After PDF archival, only is_valid may change (e.g. expiry invalidation). updated_at may change with it.
CREATE OR REPLACE FUNCTION waiver_signatures_enforce_immutable_after_pdf()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.signed_pdf_uploaded_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'is_valid' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'is_valid' - 'updated_at') THEN
    RAISE EXCEPTION 'waiver_immutable: signed waiver cannot be modified after PDF archival (except validity flag)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_waiver_signatures_immutable_after_pdf ON waiver_signatures;
CREATE TRIGGER tr_waiver_signatures_immutable_after_pdf
  BEFORE UPDATE ON waiver_signatures
  FOR EACH ROW
  EXECUTE FUNCTION waiver_signatures_enforce_immutable_after_pdf();

CREATE OR REPLACE FUNCTION waiver_participants_enforce_immutable_waiver()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  locked_at TIMESTAMPTZ;
  wid UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    wid := OLD.waiver_id;
  ELSE
    wid := NEW.waiver_id;
  END IF;

  IF wid IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  SELECT signed_pdf_uploaded_at INTO locked_at
  FROM waiver_signatures
  WHERE id = wid;

  IF locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'waiver_immutable: cannot add, change, or remove participants after signed PDF is archived'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_waiver_participants_immutable_insert ON waiver_participants;
CREATE TRIGGER tr_waiver_participants_immutable_insert
  BEFORE INSERT ON waiver_participants
  FOR EACH ROW
  EXECUTE FUNCTION waiver_participants_enforce_immutable_waiver();

DROP TRIGGER IF EXISTS tr_waiver_participants_immutable_update ON waiver_participants;
CREATE TRIGGER tr_waiver_participants_immutable_update
  BEFORE UPDATE ON waiver_participants
  FOR EACH ROW
  EXECUTE FUNCTION waiver_participants_enforce_immutable_waiver();

DROP TRIGGER IF EXISTS tr_waiver_participants_immutable_delete ON waiver_participants;
CREATE TRIGGER tr_waiver_participants_immutable_delete
  BEFORE DELETE ON waiver_participants
  FOR EACH ROW
  EXECUTE FUNCTION waiver_participants_enforce_immutable_waiver();

-- Allow clients to upload the one-time signed PDF at waivers/{business_id}/{waiver_id}.pdf
DROP POLICY IF EXISTS "Waiver signed PDF insert archival path" ON storage.objects;
CREATE POLICY "Waiver signed PDF insert archival path"
  ON storage.objects
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (
    bucket_id = 'waivers'
    AND name ~* '^waivers/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
  );

DROP POLICY IF EXISTS "Waiver signed PDF select for business members" ON storage.objects;
CREATE POLICY "Waiver signed PDF select for business members"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'waivers'
    AND split_part(name, '/', 1) = 'waivers'
    AND (
      EXISTS (
        SELECT 1 FROM public.business_users bu
        WHERE bu.user_id = auth.uid()
          AND bu.business_id = split_part(name, '/', 2)::uuid
      )
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.active = true
          AND ur.business_id = split_part(name, '/', 2)::uuid
      )
    )
  );
