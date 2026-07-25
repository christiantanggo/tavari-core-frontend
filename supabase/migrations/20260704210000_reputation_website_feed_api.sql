-- Website-oriented reputation feed (tavari-api-reputation-feed).

ALTER TABLE public.reputation_settings
  ADD COLUMN IF NOT EXISTS website_public_feed_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.reputation_settings
  ADD COLUMN IF NOT EXISTS website_public_feed_min_rating SMALLINT NOT NULL DEFAULT 4
    CHECK (website_public_feed_min_rating BETWEEN 1 AND 5);

ALTER TABLE public.reputation_settings
  ADD COLUMN IF NOT EXISTS website_public_feed_limit INT NOT NULL DEFAULT 9
    CHECK (website_public_feed_limit BETWEEN 1 AND 24);

COMMENT ON COLUMN public.reputation_settings.website_public_feed_enabled IS
  'When true, tavari-api-reputation-feed returns public review snippets for external websites.';
COMMENT ON COLUMN public.reputation_settings.website_public_feed_min_rating IS
  'Minimum star rating for snippets shown on external websites (default 4).';
COMMENT ON COLUMN public.reputation_settings.website_public_feed_limit IS
  'Max recent review snippets returned by tavari-api-reputation-feed (default 9).';
