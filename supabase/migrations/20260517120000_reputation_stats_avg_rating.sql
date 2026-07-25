-- Add average star rating to reputation dashboard stats
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
  v_avg_rating NUMERIC;
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

  SELECT round(avg(rating)::numeric, 2) INTO v_avg_rating
  FROM public.reputation_submissions
  WHERE business_id = p_business_id AND rating IS NOT NULL;

  RETURN jsonb_build_object(
    'invites_created', v_invites_created,
    'invites_completed', v_invites_completed,
    'submissions_total', v_submitted_total,
    'sent_toward_google_eligible', v_google_eligible,
    'google_redirect_clicks', v_google_clicks,
    'internal_or_non_google_paths', v_internal_low,
    'avg_rating', v_avg_rating
  );
END;
$$;
