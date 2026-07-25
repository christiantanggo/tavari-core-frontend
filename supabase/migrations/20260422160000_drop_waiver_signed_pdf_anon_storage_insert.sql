-- Signed waiver PDF uploads are performed only via Edge Functions using the service role.
-- Remove client/anon INSERT on the canonical archival path (path-regex policy).
DROP POLICY IF EXISTS "Waiver signed PDF insert archival path" ON storage.objects;
