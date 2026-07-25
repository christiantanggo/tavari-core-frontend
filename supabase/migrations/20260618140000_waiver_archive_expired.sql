-- Soft-archive waivers that have been expired for N+ years (default 2).
-- Archived rows stay in DB + storage; excluded from dashboard list/search by default.

ALTER TABLE public.waiver_signatures
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.legacy_waivers
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.waiver_signatures.archived_at IS
  'Set when waiver has been expired for waivers_archive_expired_years+; hidden from default list/search.';

COMMENT ON COLUMN public.legacy_waivers.archived_at IS
  'Same as waiver_signatures.archived_at for imported legacy rows.';

CREATE INDEX IF NOT EXISTS idx_waiver_signatures_business_active_signed
  ON public.waiver_signatures (business_id, signed_at DESC NULLS LAST)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_legacy_waivers_business_active_signed
  ON public.legacy_waivers (business_id, signed_at DESC NULLS LAST)
  WHERE archived_at IS NULL AND deleted_at IS NULL;

-- Effective expiry cutoff: row is archivable when effective_expiry <= (now - p_expired_years).
CREATE OR REPLACE FUNCTION public.waivers_archive_expired(
  p_expired_years integer DEFAULT 2,
  p_fallback_expiry_days integer DEFAULT 365
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - make_interval(years => GREATEST(1, COALESCE(p_expired_years, 2)));
  v_fallback interval := make_interval(days => GREATEST(1, COALESCE(p_fallback_expiry_days, 365)));
  v_modern integer := 0;
  v_legacy integer := 0;
BEGIN
  UPDATE public.waiver_signatures ws
  SET archived_at = now()
  WHERE ws.archived_at IS NULL
    AND (
      (ws.expires_at IS NOT NULL AND ws.expires_at <= v_cutoff)
      OR (
        ws.expires_at IS NULL
        AND COALESCE(ws.signed_at, ws.created_at) IS NOT NULL
        AND COALESCE(ws.signed_at, ws.created_at) + v_fallback <= v_cutoff
      )
      OR (
        ws.is_valid = false
        AND COALESCE(ws.signed_at, ws.created_at) IS NOT NULL
        AND COALESCE(ws.signed_at, ws.created_at) <= v_cutoff
      )
    );

  GET DIAGNOSTICS v_modern = ROW_COUNT;

  UPDATE public.legacy_waivers lw
  SET archived_at = now()
  WHERE lw.archived_at IS NULL
    AND lw.deleted_at IS NULL
    AND COALESCE(lw.signed_at, lw.created_at) IS NOT NULL
    AND COALESCE(lw.signed_at, lw.created_at) + v_fallback <= v_cutoff;

  GET DIAGNOSTICS v_legacy = ROW_COUNT;

  RETURN jsonb_build_object(
    'cutoff', v_cutoff,
    'modern_archived', v_modern,
    'legacy_archived', v_legacy,
    'archived_total', v_modern + v_legacy
  );
END;
$$;

COMMENT ON FUNCTION public.waivers_archive_expired(integer, integer) IS
  'Marks waivers expired for at least p_expired_years as archived (archived_at). Run via pg_cron weekly.';

REVOKE ALL ON FUNCTION public.waivers_archive_expired(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waivers_archive_expired(integer, integer) TO service_role;

-- One-time backfill for existing data
SELECT public.waivers_archive_expired(2, 365);

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'waivers-archive-expired-weekly') THEN
    PERFORM cron.unschedule('waivers-archive-expired-weekly');
  END IF;

  PERFORM cron.schedule(
    'waivers-archive-expired-weekly',
    '15 4 * * 0',
    'SELECT public.waivers_archive_expired(2, 365);'
  );
END $$;
