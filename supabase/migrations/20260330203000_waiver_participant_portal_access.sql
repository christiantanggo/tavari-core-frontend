-- Additional adults: how they may view this waiver when they verify with their own phone (public flow).
-- co_primary — same capabilities as primary signer on the “on file” screen (full roster + sign new waiver).
-- full_view — see everyone on the waiver; cannot start a new waiver from this screen as easily (read-focused).
-- self_only — only their own participant row; others summarized without PII.

ALTER TABLE waiver_participants
  ADD COLUMN IF NOT EXISTS participant_portal_access TEXT;

ALTER TABLE waiver_participants
  DROP CONSTRAINT IF EXISTS waiver_participants_portal_access_check;

ALTER TABLE waiver_participants
  ADD CONSTRAINT waiver_participants_portal_access_check
  CHECK (
    participant_portal_access IS NULL
    OR participant_portal_access IN ('co_primary', 'full_view', 'self_only')
  );

COMMENT ON COLUMN waiver_participants.participant_portal_access IS
  'For additional_adult: portal access when they look up by their phone (co_primary | full_view | self_only). NULL = legacy / not applicable.';

-- Find waiver IDs where this phone matches an additional-adult participant row (for public kiosk search).
CREATE OR REPLACE FUNCTION public.waivers_find_ids_by_additional_adult_phone(
  p_business_id uuid,
  p_normalized_phone text
)
RETURNS TABLE (waiver_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT wp.waiver_id
  FROM waiver_participants wp
  INNER JOIN waiver_signatures ws ON ws.id = wp.waiver_id
  WHERE ws.business_id = p_business_id
    AND lower(trim(coalesce(wp.participant_type, ''))) = 'additional_adult'
    AND length(trim(coalesce(p_normalized_phone, ''))) >= 10
    AND regexp_replace(coalesce(wp.phone_number, ''), '\D', '', 'g') = trim(p_normalized_phone);
$$;

GRANT EXECUTE ON FUNCTION public.waivers_find_ids_by_additional_adult_phone(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.waivers_find_ids_by_additional_adult_phone(uuid, text) TO authenticated;
