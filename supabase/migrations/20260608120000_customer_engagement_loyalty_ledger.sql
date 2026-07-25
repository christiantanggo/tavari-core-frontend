-- Customer engagement (streaks) + idempotent app points awards in Tavari loyalty ledger.

CREATE TABLE IF NOT EXISTS public.customer_engagement_profiles (
  loyalty_account_id uuid PRIMARY KEY REFERENCES public.pos_loyalty_accounts(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  current_streak integer NOT NULL DEFAULT 0,
  longest_streak integer NOT NULL DEFAULT 0,
  last_play_date date NULL,
  grace_used_month text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_engagement_profiles_business
  ON public.customer_engagement_profiles (business_id);

CREATE TABLE IF NOT EXISTS public.pos_loyalty_engagement_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  loyalty_account_id uuid NOT NULL REFERENCES public.pos_loyalty_accounts(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  event_type text NOT NULL,
  points_awarded integer NOT NULL DEFAULT 0,
  loyalty_transaction_id uuid NULL REFERENCES public.pos_loyalty_transactions(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_loyalty_engagement_awards_unique_source
    UNIQUE (business_id, loyalty_account_id, source_key)
);

CREATE INDEX IF NOT EXISTS idx_pos_loyalty_engagement_awards_account
  ON public.pos_loyalty_engagement_awards (loyalty_account_id, created_at DESC);

ALTER TABLE public.pos_loyalty_settings
  ADD COLUMN IF NOT EXISTS app_trivia_points integer NOT NULL DEFAULT 10;

ALTER TABLE public.pos_loyalty_settings
  ADD COLUMN IF NOT EXISTS app_daily_open_points integer NOT NULL DEFAULT 0;

ALTER TABLE public.pos_loyalty_settings
  ADD COLUMN IF NOT EXISTS app_streak_milestone_points integer NOT NULL DEFAULT 25;

ALTER TABLE public.pos_loyalty_settings
  ADD COLUMN IF NOT EXISTS app_streak_milestone_days integer NOT NULL DEFAULT 7;

COMMENT ON TABLE public.customer_engagement_profiles IS
  'App trivia streak state — authoritative in Tavari, keyed by pos_loyalty_accounts.id';

COMMENT ON TABLE public.pos_loyalty_engagement_awards IS
  'Idempotency log for app engagement point awards; each source_key posts at most one ledger entry';

CREATE OR REPLACE FUNCTION public.pos_loyalty_award_points_internal(
  p_business_id uuid,
  p_customer_id uuid,
  p_points integer,
  p_description text,
  p_source_key text,
  p_event_type text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings record;
  v_account record;
  v_existing uuid;
  v_tx_id uuid;
  v_points integer := GREATEST(0, COALESCE(p_points, 0));
  v_current_points integer;
  v_new_points integer;
  v_current_balance numeric;
  v_new_balance numeric;
  v_credits numeric;
BEGIN
  IF v_points <= 0 THEN
    RETURN jsonb_build_object('awarded', false, 'points', 0, 'reason', 'zero_points');
  END IF;

  SELECT id INTO v_existing
  FROM pos_loyalty_engagement_awards
  WHERE business_id = p_business_id
    AND loyalty_account_id = p_customer_id
    AND source_key = p_source_key;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('awarded', false, 'points', 0, 'reason', 'duplicate', 'duplicate', true);
  END IF;

  SELECT * INTO v_settings
  FROM pos_loyalty_settings
  WHERE business_id = p_business_id
  LIMIT 1;

  IF v_settings IS NULL OR v_settings.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('awarded', false, 'points', 0, 'reason', 'loyalty_inactive');
  END IF;

  SELECT * INTO v_account
  FROM pos_loyalty_accounts
  WHERE id = p_customer_id
    AND business_id = p_business_id
    AND is_active IS NOT FALSE
  FOR UPDATE;

  IF v_account IS NULL THEN
    RETURN jsonb_build_object('awarded', false, 'points', 0, 'reason', 'account_not_found');
  END IF;

  v_current_points := COALESCE(v_account.points, 0);
  v_current_balance := COALESCE(v_account.balance, 0);
  v_credits := v_points::numeric / NULLIF(COALESCE(v_settings.redemption_rate, 1), 0);
  v_new_balance := v_current_balance + v_credits;

  IF COALESCE(v_settings.loyalty_mode, 'points') = 'dollars' THEN
    v_new_points := ROUND(v_new_balance * COALESCE(v_settings.redemption_rate, 1))::integer;
  ELSE
    v_new_points := v_current_points + v_points;
  END IF;

  UPDATE pos_loyalty_accounts
  SET
    points = v_new_points,
    balance = v_new_balance,
    total_earned = COALESCE(total_earned, 0) + v_credits,
    last_activity = now(),
    updated_at = now()
  WHERE id = p_customer_id;

  INSERT INTO pos_loyalty_transactions (
    business_id,
    loyalty_account_id,
    transaction_type,
    amount,
    points,
    balance_before,
    balance_after,
    points_before,
    points_after,
    description,
    processed_at,
    earned_date
  ) VALUES (
    p_business_id,
    p_customer_id,
    'earn',
    v_credits,
    v_points,
    v_current_balance,
    v_new_balance,
    v_current_points,
    v_new_points,
    p_description,
    now(),
    CURRENT_DATE
  )
  RETURNING id INTO v_tx_id;

  INSERT INTO pos_loyalty_engagement_awards (
    business_id,
    loyalty_account_id,
    source_key,
    event_type,
    points_awarded,
    loyalty_transaction_id,
    metadata
  ) VALUES (
    p_business_id,
    p_customer_id,
    p_source_key,
    p_event_type,
    v_points,
    v_tx_id,
    COALESCE(p_metadata, '{}'::jsonb)
  );

  RETURN jsonb_build_object(
    'awarded', true,
    'points', v_points,
    'transactionId', v_tx_id,
    'newPoints', v_new_points,
    'newBalance', v_new_balance
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.pos_loyalty_record_engagement_event(
  p_business_id uuid,
  p_customer_id uuid,
  p_event_type text,
  p_play_date date DEFAULT CURRENT_DATE,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings record;
  v_profile record;
  v_event text := lower(trim(COALESCE(p_event_type, '')));
  v_today date := COALESCE(p_play_date, CURRENT_DATE);
  v_yesterday date := (v_today - 1);
  v_month_key text := to_char(v_today, 'YYYY-MM');
  v_current_streak integer := 0;
  v_longest_streak integer := 0;
  v_grace_month text := NULL;
  v_last_play date := NULL;
  v_streak_updated boolean := false;
  v_trivia_award jsonb := jsonb_build_object('awarded', false, 'points', 0);
  v_open_award jsonb := jsonb_build_object('awarded', false, 'points', 0);
  v_milestone_award jsonb := jsonb_build_object('awarded', false, 'points', 0);
  v_gap_days integer;
BEGIN
  IF v_event NOT IN ('trivia_correct', 'daily_open') THEN
    RAISE EXCEPTION 'Unsupported engagement event: %', p_event_type;
  END IF;

  SELECT * INTO v_settings
  FROM pos_loyalty_settings
  WHERE business_id = p_business_id
  LIMIT 1;

  SELECT * INTO v_profile
  FROM customer_engagement_profiles
  WHERE loyalty_account_id = p_customer_id
    AND business_id = p_business_id
  FOR UPDATE;

  IF v_profile IS NULL THEN
    INSERT INTO customer_engagement_profiles (loyalty_account_id, business_id)
    VALUES (p_customer_id, p_business_id)
    ON CONFLICT (loyalty_account_id) DO NOTHING;

    SELECT * INTO v_profile
    FROM customer_engagement_profiles
    WHERE loyalty_account_id = p_customer_id
      AND business_id = p_business_id
    FOR UPDATE;
  END IF;

  v_current_streak := COALESCE(v_profile.current_streak, 0);
  v_longest_streak := COALESCE(v_profile.longest_streak, 0);
  v_grace_month := v_profile.grace_used_month;
  v_last_play := v_profile.last_play_date;

  IF v_event = 'trivia_correct' THEN
    IF v_last_play IS DISTINCT FROM v_today THEN
      IF v_last_play IS NULL THEN
        v_current_streak := 1;
      ELSIF v_last_play = v_yesterday THEN
        v_current_streak := v_current_streak + 1;
      ELSE
        v_gap_days := v_today - v_last_play;
        IF v_gap_days = 2 AND COALESCE(v_grace_month, '') <> v_month_key THEN
          v_current_streak := v_current_streak + 1;
          v_grace_month := v_month_key;
        ELSIF v_gap_days = 1 THEN
          v_current_streak := v_current_streak + 1;
        ELSE
          v_current_streak := 1;
        END IF;
      END IF;

      v_longest_streak := GREATEST(v_longest_streak, v_current_streak);
      v_last_play := v_today;
      v_streak_updated := true;
    END IF;

    v_trivia_award := pos_loyalty_award_points_internal(
      p_business_id,
      p_customer_id,
      COALESCE(v_settings.app_trivia_points, 10),
      'Daily trivia',
      'trivia:' || v_today::text,
      'trivia_correct',
      p_metadata
    );

    IF v_streak_updated
      AND COALESCE(v_settings.app_streak_milestone_days, 7) > 0
      AND v_current_streak > 0
      AND (v_current_streak % COALESCE(v_settings.app_streak_milestone_days, 7)) = 0 THEN
      v_milestone_award := pos_loyalty_award_points_internal(
        p_business_id,
        p_customer_id,
        COALESCE(v_settings.app_streak_milestone_points, 25),
        format('%s-day trivia streak bonus', v_current_streak),
        'streak_milestone:' || v_current_streak::text,
        'streak_milestone',
        jsonb_build_object('streak', v_current_streak)
      );
    END IF;
  ELSIF v_event = 'daily_open' THEN
    v_open_award := pos_loyalty_award_points_internal(
      p_business_id,
      p_customer_id,
      COALESCE(v_settings.app_daily_open_points, 0),
      'App check-in',
      'daily_open:' || v_today::text,
      'daily_open',
      p_metadata
    );
  END IF;

  IF v_streak_updated OR v_event = 'daily_open' THEN
    UPDATE customer_engagement_profiles
    SET
      current_streak = v_current_streak,
      longest_streak = v_longest_streak,
      last_play_date = CASE WHEN v_event = 'trivia_correct' THEN v_last_play ELSE last_play_date END,
      grace_used_month = v_grace_month,
      updated_at = now()
    WHERE loyalty_account_id = p_customer_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'eventType', v_event,
    'streak', jsonb_build_object(
      'current', v_current_streak,
      'longest', v_longest_streak,
      'lastPlayDate', v_last_play
    ),
    'pointsAwarded',
      COALESCE((v_trivia_award->>'points')::integer, 0)
      + COALESCE((v_open_award->>'points')::integer, 0)
      + COALESCE((v_milestone_award->>'points')::integer, 0),
    'awards', jsonb_build_object(
      'trivia', v_trivia_award,
      'dailyOpen', v_open_award,
      'streakMilestone', v_milestone_award
    ),
    'loyaltyActive', COALESCE(v_settings.is_active, false)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_loyalty_record_engagement_event(uuid, uuid, text, date, jsonb)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.pos_loyalty_award_points_internal(uuid, uuid, integer, text, text, text, jsonb)
  TO service_role;

ALTER TABLE public.customer_engagement_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_loyalty_engagement_awards ENABLE ROW LEVEL SECURITY;
