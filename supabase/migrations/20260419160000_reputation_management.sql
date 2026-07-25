-- Reputation management: settings, invites, public submissions, Google OAuth storage (service role only)

CREATE TABLE IF NOT EXISTS public.reputation_settings (
  business_id UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  min_stars_redirect_google SMALLINT NOT NULL DEFAULT 4 CHECK (min_stars_redirect_google BETWEEN 1 AND 5),
  invite_delay_hours INT NOT NULL DEFAULT 24 CHECK (invite_delay_hours >= 0),
  google_review_url TEXT,
  manager_notification_emails TEXT[] NOT NULL DEFAULT '{}'::text[],
  routing_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  retention_days_internal_feedback INT NOT NULL DEFAULT 365 CHECK (retention_days_internal_feedback >= 1),
  default_invite_channel TEXT NOT NULL DEFAULT 'email'
    CHECK (default_invite_channel IN ('email','sms','prefer_email')),
  ai_reply_guidelines TEXT,
  privacy_policy_url TEXT,
  terms_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.reputation_settings IS 'Per-business reputation / review funnel configuration.';

CREATE TABLE IF NOT EXISTS public.reputation_contact_opt_out (
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_normalized TEXT NOT NULL,
  opted_out_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, contact_normalized)
);

CREATE TABLE IF NOT EXISTS public.reputation_invite_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret TEXT NOT NULL UNIQUE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_normalized TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('waiver_check_in','booking','manual','loyalty','staff')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  consumed_rating SMALLINT CHECK (consumed_rating BETWEEN 1 AND 5),
  delivered_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reputation_invite_tokens_business_created
  ON public.reputation_invite_tokens (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.reputation_daily_invite_cap (
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_normalized TEXT NOT NULL,
  invite_day DATE NOT NULL DEFAULT ((timezone('utc', now())))::date,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms')),
  PRIMARY KEY (business_id, contact_normalized, invite_day)
);

CREATE TABLE IF NOT EXISTS public.reputation_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  token_id UUID REFERENCES public.reputation_invite_tokens(id) ON DELETE SET NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  flow_type TEXT NOT NULL DEFAULT 'invite'
    CHECK (flow_type IN ('invite','anonymous','external_link')),
  routed_to_google BOOLEAN NOT NULL DEFAULT false,
  google_redirect_clicked BOOLEAN NOT NULL DEFAULT false,
  anonymous_session_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS reputation_submissions_anon_session_unique
  ON public.reputation_submissions (business_id, anonymous_session_key)
  WHERE anonymous_session_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reputation_submissions_business_created
  ON public.reputation_submissions (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.reputation_events (
  id BIGSERIAL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reputation_events_business_time
  ON public.reputation_events (business_id, created_at DESC);

-- Google OAuth tokens: never expose to authenticated users (RLS disabled for anon/auth; service role only)
CREATE TABLE IF NOT EXISTS public.reputation_google_oauth (
  business_id UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  scope TEXT,
  connected_email TEXT,
  selected_location_resource TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.reputation_google_oauth ENABLE ROW LEVEL SECURITY;

-- No policies: only service_role can access (default deny for authenticated)

CREATE TABLE IF NOT EXISTS public.reputation_google_review_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  google_review_name TEXT NOT NULL,
  reviewer_display_name TEXT,
  star_rating INT,
  review_comment TEXT,
  draft_reply TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','posted','declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, google_review_name)
);

CREATE INDEX IF NOT EXISTS idx_reputation_google_drafts_business_status
  ON public.reputation_google_review_drafts (business_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.reputation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reputation_contact_opt_out ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reputation_invite_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reputation_daily_invite_cap ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reputation_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reputation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reputation_google_review_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY reputation_settings_select ON public.reputation_settings
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true)
  );

CREATE POLICY reputation_settings_write ON public.reputation_settings
  FOR ALL USING (
    business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true)
  )
  WITH CHECK (
    business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true)
  );

CREATE POLICY reputation_opt_out_select ON public.reputation_contact_opt_out
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true)
  );

CREATE POLICY reputation_opt_out_write ON public.reputation_contact_opt_out
  FOR ALL USING (
    business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true)
  )
  WITH CHECK (
    business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true)
  );

CREATE POLICY reputation_tokens_select ON public.reputation_invite_tokens
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true)
  );

CREATE POLICY reputation_tokens_insert ON public.reputation_invite_tokens
  FOR INSERT WITH CHECK (
    business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true)
  );

CREATE POLICY reputation_tokens_update ON public.reputation_invite_tokens
  FOR UPDATE USING (
    business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true)
  );

CREATE POLICY reputation_cap_select ON public.reputation_daily_invite_cap
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true)
  );

CREATE POLICY reputation_cap_write ON public.reputation_daily_invite_cap
  FOR ALL USING (
    business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true)
  )
  WITH CHECK (
    business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true)
  );

CREATE POLICY reputation_submissions_select ON public.reputation_submissions
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true)
  );

CREATE POLICY reputation_submissions_insert ON public.reputation_submissions
  FOR INSERT WITH CHECK (false);

CREATE POLICY reputation_events_select ON public.reputation_events
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true)
  );

CREATE POLICY reputation_events_insert ON public.reputation_events
  FOR INSERT WITH CHECK (false);

CREATE POLICY reputation_drafts_select ON public.reputation_google_review_drafts
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true)
  );

CREATE POLICY reputation_drafts_write ON public.reputation_google_review_drafts
  FOR ALL USING (
    business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true)
  )
  WITH CHECK (
    business_id IN (SELECT business_id FROM public.user_roles WHERE user_id = auth.uid() AND active = true)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reputation_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reputation_contact_opt_out TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.reputation_invite_tokens TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reputation_daily_invite_cap TO authenticated;
GRANT SELECT ON public.reputation_submissions TO authenticated;
GRANT SELECT ON public.reputation_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reputation_google_review_drafts TO authenticated;

-- ---------------------------------------------------------------------------
-- Helpers: business access
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reputation_user_can_access_business(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.active = true AND ur.business_id = p_business_id
  );
$$;

-- ---------------------------------------------------------------------------
-- Public: submit via single-use invite token
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reputation_public_submit_invite(
  p_token_secret TEXT,
  p_rating INTEGER,
  p_comment TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_min SMALLINT;
  v_google TEXT;
  v_redirect BOOLEAN;
  v_internal_capture BOOLEAN;
BEGIN
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_rating');
  END IF;

  SELECT t.id, t.business_id, t.used_at, t.expires_at, s.min_stars_redirect_google, s.google_review_url, s.enabled
  INTO v_row
  FROM public.reputation_invite_tokens t
  INNER JOIN public.reputation_settings s ON s.business_id = t.business_id
  WHERE t.secret = p_token_secret;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  IF NOT coalesce(v_row.enabled, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'disabled');
  END IF;

  IF v_row.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_used');
  END IF;

  IF v_row.expires_at < timezone('utc', now()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  v_min := v_row.min_stars_redirect_google;
  v_google := nullif(trim(coalesce(v_row.google_review_url, '')), '');
  v_redirect := p_rating >= v_min AND v_google IS NOT NULL;
  v_internal_capture := (NOT v_redirect) OR (p_rating < v_min);

  UPDATE public.reputation_invite_tokens
  SET used_at = timezone('utc', now()), consumed_rating = p_rating
  WHERE id = v_row.id;

  INSERT INTO public.reputation_submissions (
    business_id, token_id, rating, comment, flow_type, routed_to_google
  ) VALUES (
    v_row.business_id,
    v_row.id,
    p_rating,
    nullif(trim(p_comment), ''),
    'invite',
    v_redirect
  );

  INSERT INTO public.reputation_events (business_id, event_type, payload)
  VALUES (
    v_row.business_id,
    'invite_submit',
    jsonb_build_object('rating', p_rating, 'redirect_eligible', v_redirect)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'redirect_google', v_redirect,
    'google_review_url', CASE WHEN v_redirect THEN v_google ELSE NULL END,
    'show_internal_feedback', v_internal_capture
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reputation_public_submit_invite(TEXT, INTEGER, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public: anonymous / QR / external Bookeo link (same UX)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reputation_public_submit_anonymous(
  p_business_id UUID,
  p_rating INTEGER,
  p_comment TEXT DEFAULT '',
  p_session_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min SMALLINT;
  v_google TEXT;
  v_redirect BOOLEAN;
  v_internal_capture BOOLEAN;
  v_enabled BOOLEAN;
BEGIN
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_rating');
  END IF;

  IF p_session_key IS NULL OR length(trim(p_session_key)) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_session');
  END IF;

  SELECT s.min_stars_redirect_google, s.google_review_url, s.enabled
  INTO v_min, v_google, v_enabled
  FROM public.reputation_settings s
  WHERE s.business_id = p_business_id;

  IF NOT FOUND OR NOT coalesce(v_enabled, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'disabled');
  END IF;

  v_google := nullif(trim(coalesce(v_google, '')), '');
  v_redirect := p_rating >= v_min AND v_google IS NOT NULL;
  v_internal_capture := (NOT v_redirect) OR (p_rating < v_min);

  INSERT INTO public.reputation_submissions (
    business_id, token_id, rating, comment, flow_type, routed_to_google, anonymous_session_key
  ) VALUES (
    p_business_id,
    NULL,
    p_rating,
    nullif(trim(p_comment), ''),
    'anonymous',
    v_redirect,
    trim(p_session_key)
  );

  INSERT INTO public.reputation_events (business_id, event_type, payload)
  VALUES (
    p_business_id,
    'anonymous_submit',
    jsonb_build_object('rating', p_rating, 'redirect_eligible', v_redirect)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'redirect_google', v_redirect,
    'google_review_url', CASE WHEN v_redirect THEN v_google ELSE NULL END,
    'show_internal_feedback', v_internal_capture
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_submitted');
END;
$$;

GRANT EXECUTE ON FUNCTION public.reputation_public_submit_anonymous(UUID, INTEGER, TEXT, TEXT) TO anon, authenticated;

-- Acknowledge user navigated to Google (best-effort conversion tracking)
CREATE OR REPLACE FUNCTION public.reputation_public_ack_google_click(
  p_token_secret TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tid UUID;
  v_bid UUID;
BEGIN
  SELECT id, business_id INTO v_tid, v_bid
  FROM public.reputation_invite_tokens
  WHERE secret = p_token_secret AND used_at IS NOT NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  UPDATE public.reputation_submissions
  SET google_redirect_clicked = true
  WHERE token_id = v_tid AND routed_to_google = true;

  INSERT INTO public.reputation_events (business_id, event_type, payload)
  VALUES (v_bid, 'google_redirect_click', '{}'::jsonb);

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reputation_public_ack_google_click(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.reputation_public_ack_google_click_anonymous(
  p_business_id UUID,
  p_session_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_session_key IS NULL OR length(trim(p_session_key)) < 8 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  UPDATE public.reputation_submissions
  SET google_redirect_clicked = true
  WHERE business_id = p_business_id
    AND anonymous_session_key = trim(p_session_key)
    AND routed_to_google = true;

  INSERT INTO public.reputation_events (business_id, event_type, payload)
  VALUES (p_business_id, 'google_redirect_click', jsonb_build_object('anonymous', true));

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reputation_public_ack_google_click_anonymous(UUID, TEXT) TO anon, authenticated;

-- Opt out (public link in email footer)
CREATE OR REPLACE FUNCTION public.reputation_public_opt_out(
  p_business_id UUID,
  p_contact_normalized TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  v_email := lower(trim(coalesce(p_contact_normalized, '')));
  IF v_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_contact');
  END IF;

  INSERT INTO public.reputation_contact_opt_out (business_id, contact_normalized)
  VALUES (p_business_id, v_email)
  ON CONFLICT (business_id, contact_normalized) DO UPDATE SET opted_out_at = timezone('utc', now());

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reputation_public_opt_out(UUID, TEXT) TO anon, authenticated;

-- Authenticated: create invite token + enforce daily cap (email OR sms = one row per day per contact)
CREATE OR REPLACE FUNCTION public.reputation_create_invite_token(
  p_business_id UUID,
  p_contact_normalized TEXT,
  p_channel TEXT DEFAULT 'email',
  p_source TEXT DEFAULT 'manual',
  p_ttl_days INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm TEXT;
  v_ch TEXT;
  v_day DATE;
  v_secret TEXT;
  v_id UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  IF NOT public.reputation_user_can_access_business(p_business_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.reputation_settings WHERE business_id = p_business_id) THEN
    INSERT INTO public.reputation_settings (business_id) VALUES (p_business_id);
  END IF;

  v_norm := lower(trim(coalesce(p_contact_normalized, '')));
  IF v_norm = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_contact');
  END IF;

  v_ch := lower(trim(coalesce(p_channel, 'email')));
  IF v_ch NOT IN ('email', 'sms') THEN
    v_ch := 'email';
  END IF;

  v_day := (timezone('utc', now()))::date;

  IF EXISTS (
    SELECT 1 FROM public.reputation_contact_opt_out
    WHERE business_id = p_business_id AND contact_normalized = v_norm
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'opted_out');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reputation_daily_invite_cap
    WHERE business_id = p_business_id
      AND contact_normalized = v_norm
      AND invite_day = v_day
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'daily_cap');
  END IF;

  -- Use built-in gen_random_uuid() only (no pgcrypto / gen_random_bytes required on Supabase)
  v_secret := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  v_expires := timezone('utc', now()) + (make_interval(days => greatest(1, coalesce(p_ttl_days, 30))));

  INSERT INTO public.reputation_invite_tokens (secret, business_id, contact_normalized, source, expires_at)
  VALUES (v_secret, p_business_id, v_norm, coalesce(nullif(trim(p_source),''), 'manual'), v_expires)
  RETURNING id INTO v_id;

  INSERT INTO public.reputation_daily_invite_cap (business_id, contact_normalized, invite_day, channel)
  VALUES (p_business_id, v_norm, v_day, v_ch)
  ON CONFLICT (business_id, contact_normalized, invite_day) DO NOTHING;

  INSERT INTO public.reputation_events (business_id, event_type, payload)
  VALUES (p_business_id, 'invite_created', jsonb_build_object('channel', v_ch));

  RETURN jsonb_build_object(
    'ok', true,
    'token_id', v_id,
    'secret', v_secret,
    'expires_at', v_expires
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reputation_create_invite_token(UUID, TEXT, TEXT, TEXT, INTEGER) TO authenticated;

-- ---------------------------------------------------------------------------
-- Module catalog
-- ---------------------------------------------------------------------------

INSERT INTO public.app_modules (module_key, module_name, description, icon, enabled_by_default, module_category)
VALUES (
  'reputation',
  'Reputation',
  'Review requests, Google routing, internal feedback, and GBP reply workflow',
  'FiStar',
  false,
  'Marketing'
)
ON CONFLICT (module_key) DO UPDATE
SET
  module_name = EXCLUDED.module_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  module_category = EXCLUDED.module_category;

-- ---------------------------------------------------------------------------
-- Public read: landing page metadata (does not expose Google review URL)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reputation_public_landing_meta(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bname TEXT;
  v_row RECORD;
BEGIN
  SELECT coalesce(nullif(trim(b.name), ''), 'Business') INTO v_bname
  FROM public.businesses b
  WHERE b.id = p_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT * INTO v_row FROM public.reputation_settings WHERE business_id = p_business_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'enabled', false,
      'business_name', v_bname,
      'min_stars_redirect_google', 4,
      'privacy_policy_url', null,
      'terms_url', null
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'enabled', coalesce(v_row.enabled, false),
    'business_name', v_bname,
    'min_stars_redirect_google', v_row.min_stars_redirect_google,
    'privacy_policy_url', v_row.privacy_policy_url,
    'terms_url', v_row.terms_url
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reputation_public_landing_meta(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.reputation_public_invite_preview(p_secret TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t RECORD;
  v_enabled BOOLEAN;
  v_min SMALLINT;
  v_privacy TEXT;
  v_terms TEXT;
  v_bname TEXT;
BEGIN
  SELECT t.id, t.business_id, t.used_at, t.expires_at
  INTO v_t
  FROM public.reputation_invite_tokens t
  WHERE t.secret = p_secret;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  SELECT s.enabled, s.min_stars_redirect_google, s.privacy_policy_url, s.terms_url
  INTO v_enabled, v_min, v_privacy, v_terms
  FROM public.reputation_settings s
  WHERE s.business_id = v_t.business_id;

  IF NOT FOUND THEN
    v_enabled := false;
    v_min := 4;
    v_privacy := null;
    v_terms := null;
  END IF;

  SELECT coalesce(nullif(trim(name),''), 'Business') INTO v_bname
  FROM public.businesses WHERE id = v_t.business_id;

  RETURN jsonb_build_object(
    'ok', true,
    'business_id', v_t.business_id,
    'business_name', coalesce(v_bname, 'Business'),
    'enabled', coalesce(v_enabled, false),
    'already_used', v_t.used_at IS NOT NULL,
    'expired', v_t.expires_at < timezone('utc', now()),
    'min_stars_redirect_google', coalesce(v_min, 4),
    'privacy_policy_url', v_privacy,
    'terms_url', v_terms
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reputation_public_invite_preview(TEXT) TO anon, authenticated;

-- Dashboard stats (authenticated)
CREATE OR REPLACE FUNCTION public.reputation_stats_summary(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invites_created BIGINT;
  v_invites_completed BIGINT;
  v_google_eligible BIGINT;
  v_google_clicks BIGINT;
  v_internal_low BIGINT;
  v_submitted_total BIGINT;
BEGIN
  IF NOT public.reputation_user_can_access_business(p_business_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(*) INTO v_invites_created
  FROM public.reputation_invite_tokens WHERE business_id = p_business_id;

  SELECT count(*) INTO v_invites_completed
  FROM public.reputation_invite_tokens WHERE business_id = p_business_id AND used_at IS NOT NULL;

  SELECT count(*) INTO v_google_eligible
  FROM public.reputation_submissions WHERE business_id = p_business_id AND routed_to_google = true;

  SELECT count(*) INTO v_google_clicks
  FROM public.reputation_submissions WHERE business_id = p_business_id AND google_redirect_clicked = true;

  SELECT count(*) INTO v_internal_low
  FROM public.reputation_submissions
  WHERE business_id = p_business_id
    AND routed_to_google = false
    AND rating IS NOT NULL;

  SELECT count(*) INTO v_submitted_total
  FROM public.reputation_submissions WHERE business_id = p_business_id;

  RETURN jsonb_build_object(
    'invites_created', v_invites_created,
    'invites_completed', v_invites_completed,
    'submissions_total', v_submitted_total,
    'sent_toward_google_eligible', v_google_eligible,
    'google_redirect_clicks', v_google_clicks,
    'internal_or_non_google_paths', v_internal_low
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reputation_stats_summary(UUID) TO authenticated;

-- Masked GBP connection info (tokens stay service-role only via edge functions)
CREATE OR REPLACE FUNCTION public.reputation_google_connection_status(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v RECORD;
BEGIN
  IF NOT public.reputation_user_can_access_business(p_business_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT connected_email, selected_location_resource
  INTO v
  FROM public.reputation_google_oauth
  WHERE business_id = p_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('connected', false);
  END IF;

  RETURN jsonb_build_object(
    'connected', true,
    'connected_email', v.connected_email,
    'selected_location_resource', v.selected_location_resource
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reputation_google_connection_status(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reputation_save_google_location(p_business_id UUID, p_location_resource TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.reputation_user_can_access_business(p_business_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.reputation_google_oauth WHERE business_id = p_business_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_connected');
  END IF;

  UPDATE public.reputation_google_oauth
  SET selected_location_resource = nullif(trim(p_location_resource), ''),
      updated_at = timezone('utc', now())
  WHERE business_id = p_business_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reputation_save_google_location(UUID, TEXT) TO authenticated;
