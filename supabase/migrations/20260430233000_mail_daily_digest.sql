-- Daily email digest settings + aggregate stats RPC for reporting / CSV / scheduled digest

ALTER TABLE public.mail_settings
  ADD COLUMN IF NOT EXISTS daily_digest_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_digest_recipients text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS daily_digest_sections jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS daily_digest_last_sent_on date;

COMMENT ON COLUMN public.mail_settings.daily_digest_enabled IS 'When true, cron sends a daily stats email at 8pm local business time.';
COMMENT ON COLUMN public.mail_settings.daily_digest_recipients IS 'Comma-separated recipient emails for the daily digest.';
COMMENT ON COLUMN public.mail_settings.daily_digest_sections IS 'JSON object of section keys -> boolean for email + CSV.';
COMMENT ON COLUMN public.mail_settings.daily_digest_last_sent_on IS 'Local calendar date (business TZ) when digest was last sent; avoids duplicate cron sends.';

-- Pure timezone helper (no business data); used by Edge cron for local-day bounds.
CREATE OR REPLACE FUNCTION public.mail_daily_digest_day_bounds(
  p_timezone text,
  p_instant timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'local_date', ((p_instant AT TIME ZONE p_timezone)::date),
    'range_start', (((p_instant AT TIME ZONE p_timezone)::date)::timestamp AT TIME ZONE p_timezone),
    'range_end', ((((p_instant AT TIME ZONE p_timezone)::date)::timestamp AT TIME ZONE p_timezone)
      + interval '1 day' - interval '1 microsecond')
  );
$$;

GRANT EXECUTE ON FUNCTION public.mail_daily_digest_day_bounds(text, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mail_daily_digest_stats(
  p_business_id uuid,
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_timezone text DEFAULT 'America/Toronto'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_ok boolean;
  v_sent int := 0;
  v_opened int := 0;
  v_clicked int := 0;
  v_failures int := 0;
  v_bounced int := 0;
  v_pending int := 0;
  v_suppressed int := 0;
  v_unsubscribed_send int := 0;
  v_unsubs int := 0;
  v_bounces_tbl int := 0;
  v_open_rate numeric := 0;
  v_click_rate numeric := 0;
  v_campaigns jsonb := '[]'::jsonb;
  v_last_six jsonb := '[]'::jsonb;
  v_anchor_end date;
BEGIN
  v_role := coalesce(auth.jwt()->>'role', '');

  SELECT EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.user_id = auth.uid()
      AND bu.business_id = p_business_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.business_id = p_business_id
  )
  INTO v_ok;

  IF v_role IS DISTINCT FROM 'service_role' AND NOT v_ok THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT
    COUNT(*) FILTER (
      WHERE mcs.status = 'sent'
        AND mcs.sent_at IS NOT NULL
        AND (mcs.sent_at AT TIME ZONE 'UTC') BETWEEN p_range_start AND p_range_end
    ),
    COUNT(*) FILTER (
      WHERE mcs.status = 'sent'
        AND mcs.sent_at IS NOT NULL
        AND (mcs.sent_at AT TIME ZONE 'UTC') BETWEEN p_range_start AND p_range_end
        AND mcs.opened_at IS NOT NULL
    ),
    COUNT(*) FILTER (
      WHERE mcs.status = 'sent'
        AND mcs.sent_at IS NOT NULL
        AND (mcs.sent_at AT TIME ZONE 'UTC') BETWEEN p_range_start AND p_range_end
        AND mcs.clicked_at IS NOT NULL
    ),
    COUNT(*) FILTER (
      WHERE mcs.status = 'failed'
        AND (COALESCE(mcs.sent_at, mcs.created_at) AT TIME ZONE 'UTC') BETWEEN p_range_start AND p_range_end
    ),
    COUNT(*) FILTER (
      WHERE mcs.status = 'bounced'
        AND (COALESCE(mcs.sent_at, mcs.created_at) AT TIME ZONE 'UTC') BETWEEN p_range_start AND p_range_end
    ),
    COUNT(*) FILTER (
      WHERE mcs.status = 'pending'
        AND (COALESCE(mcs.sent_at, mcs.created_at) AT TIME ZONE 'UTC') BETWEEN p_range_start AND p_range_end
    ),
    COUNT(*) FILTER (
      WHERE mcs.status = 'suppressed'
        AND (COALESCE(mcs.sent_at, mcs.created_at) AT TIME ZONE 'UTC') BETWEEN p_range_start AND p_range_end
    ),
    COUNT(*) FILTER (
      WHERE mcs.status = 'unsubscribed'
        AND (COALESCE(mcs.sent_at, mcs.created_at) AT TIME ZONE 'UTC') BETWEEN p_range_start AND p_range_end
    )
  INTO v_sent, v_opened, v_clicked, v_failures, v_bounced, v_pending, v_suppressed, v_unsubscribed_send
  FROM public.mail_campaign_sends mcs
  INNER JOIN public.mail_campaigns mc ON mc.id = mcs.campaign_id AND mc.business_id = p_business_id;

  SELECT COUNT(*) INTO v_unsubs
  FROM public.mail_unsubscribes mu
  WHERE mu.business_id = p_business_id
    AND mu.unsubscribed_at IS NOT NULL
    AND (mu.unsubscribed_at AT TIME ZONE 'UTC') BETWEEN p_range_start AND p_range_end;

  SELECT COUNT(*) INTO v_bounces_tbl
  FROM public.mail_bounces mb
  WHERE mb.business_id = p_business_id
    AND mb.bounced_at IS NOT NULL
    AND (mb.bounced_at AT TIME ZONE 'UTC') BETWEEN p_range_start AND p_range_end;

  IF v_sent > 0 THEN
    v_open_rate := round((100.0 * v_opened / v_sent)::numeric, 2);
    v_click_rate := round((100.0 * v_clicked / v_sent)::numeric, 2);
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'campaign_id', x.campaign_id,
      'name', x.name,
      'sent_count', x.sent_count,
      'opened_count', x.opened_count,
      'open_rate_pct', CASE WHEN x.sent_count > 0
        THEN round((100.0 * x.opened_count / x.sent_count)::numeric, 2)
        ELSE 0 END
    )
    ORDER BY x.name
  ), '[]'::jsonb)
  INTO v_campaigns
  FROM (
    SELECT
      mc.id AS campaign_id,
      mc.name,
      COUNT(*) FILTER (
        WHERE mcs.status = 'sent'
          AND mcs.sent_at IS NOT NULL
          AND (mcs.sent_at AT TIME ZONE 'UTC') BETWEEN p_range_start AND p_range_end
      ) AS sent_count,
      COUNT(*) FILTER (
        WHERE mcs.status = 'sent'
          AND mcs.sent_at IS NOT NULL
          AND (mcs.sent_at AT TIME ZONE 'UTC') BETWEEN p_range_start AND p_range_end
          AND mcs.opened_at IS NOT NULL
      ) AS opened_count
    FROM public.mail_campaigns mc
    LEFT JOIN public.mail_campaign_sends mcs ON mcs.campaign_id = mc.id
    WHERE mc.business_id = p_business_id
    GROUP BY mc.id, mc.name
    HAVING COUNT(*) FILTER (
      WHERE mcs.status = 'sent'
        AND mcs.sent_at IS NOT NULL
        AND (mcs.sent_at AT TIME ZONE 'UTC') BETWEEN p_range_start AND p_range_end
    ) > 0
  ) x;

  v_anchor_end := (p_range_end AT TIME ZONE p_timezone)::date;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'local_date', sd.day_local,
      'sent', sd.day_sent,
      'opened', sd.day_opened,
      'open_rate_pct', CASE WHEN sd.day_sent > 0
        THEN round((100.0 * sd.day_opened / sd.day_sent)::numeric, 2)
        ELSE 0 END
    )
    ORDER BY sd.day_local
  ), '[]'::jsonb)
  INTO v_last_six
  FROM (
    SELECT
      ds.day_local,
      (
        SELECT COUNT(*) FILTER (
          WHERE mcs.status = 'sent'
            AND mcs.sent_at IS NOT NULL
            AND (mcs.sent_at AT TIME ZONE 'UTC') >= (ds.day_local::timestamp AT TIME ZONE p_timezone)
            AND (mcs.sent_at AT TIME ZONE 'UTC') < ((ds.day_local + 1)::timestamp AT TIME ZONE p_timezone)
        )
        FROM public.mail_campaign_sends mcs
        INNER JOIN public.mail_campaigns mc ON mc.id = mcs.campaign_id AND mc.business_id = p_business_id
      ) AS day_sent,
      (
        SELECT COUNT(*) FILTER (
          WHERE mcs.status = 'sent'
            AND mcs.sent_at IS NOT NULL
            AND mcs.opened_at IS NOT NULL
            AND (mcs.sent_at AT TIME ZONE 'UTC') >= (ds.day_local::timestamp AT TIME ZONE p_timezone)
            AND (mcs.sent_at AT TIME ZONE 'UTC') < ((ds.day_local + 1)::timestamp AT TIME ZONE p_timezone)
        )
        FROM public.mail_campaign_sends mcs
        INNER JOIN public.mail_campaigns mc ON mc.id = mcs.campaign_id AND mc.business_id = p_business_id
      ) AS day_opened
    FROM (
      SELECT gs::date AS day_local
      FROM generate_series(
        v_anchor_end - 5,
        v_anchor_end,
        interval '1 day'
      ) AS gs
    ) ds
  ) sd;

  RETURN jsonb_build_object(
    'timezone', p_timezone,
    'range_start', p_range_start,
    'range_end', p_range_end,
    'sent_count', v_sent,
    'opened_count', v_opened,
    'clicked_count', v_clicked,
    'open_rate_pct', v_open_rate,
    'click_rate_pct', v_click_rate,
    'campaigns', v_campaigns,
    'failures_count', v_failures,
    'bounced_status_count', v_bounced,
    'pending_count', v_pending,
    'suppressed_count', v_suppressed,
    'unsubscribed_send_count', v_unsubscribed_send,
    'unsubscribes_count', v_unsubs,
    'bounces_table_count', v_bounces_tbl,
    'last_six_days', v_last_six
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mail_daily_digest_stats(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
