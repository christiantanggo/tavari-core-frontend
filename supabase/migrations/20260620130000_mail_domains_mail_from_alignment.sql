-- Track SES custom MAIL FROM and DKIM status so domain setup can satisfy Gmail bulk-sender alignment checks.

ALTER TABLE public.mail_domains
  ADD COLUMN IF NOT EXISTS dkim_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS mail_from_domain text,
  ADD COLUMN IF NOT EXISTS mail_from_status text NOT NULL DEFAULT 'pending';

COMMENT ON COLUMN public.mail_domains.dkim_status IS
  'Normalized SES DKIM verification status for the domain: pending, verified, or failed.';

COMMENT ON COLUMN public.mail_domains.mail_from_domain IS
  'Custom SES MAIL FROM subdomain used for SPF/Return-Path alignment, e.g. mail.example.com.';

COMMENT ON COLUMN public.mail_domains.mail_from_status IS
  'Normalized SES custom MAIL FROM status: pending, verified, or failed.';
