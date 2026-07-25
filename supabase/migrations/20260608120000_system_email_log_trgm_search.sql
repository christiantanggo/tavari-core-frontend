-- Speed up Email History search (ILIKE '%pattern%') on system_email_log.
-- Without trigram indexes, OR + ilike forces large sequential scans and hits statement_timeout (57014).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_system_email_log_subject_gin_trgm
  ON public.system_email_log USING gin (subject gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_system_email_log_from_email_gin_trgm
  ON public.system_email_log USING gin (from_email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_system_email_log_recipient_email_gin_trgm
  ON public.system_email_log USING gin (recipient_email gin_trgm_ops);

COMMENT ON INDEX idx_system_email_log_subject_gin_trgm IS
  'Trigram index for subject ILIKE search in email history UI';
