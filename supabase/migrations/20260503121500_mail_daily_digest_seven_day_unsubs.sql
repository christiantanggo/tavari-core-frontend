-- Extend rolling open-rate trend to 7 days; clarify unsubscribes = events by unsubscribed_at (not original send date).

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
  v_last_seven jsonb := '[]'::jsonb;
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

  -- Consent withdrawals in the reporting window (timestamp of the unsubscribe action), not tied to original campaign send date.
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
  INTO v_last_seven
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
        v_anchor_end - 6,
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
    'last_seven_days', v_last_seven,
    'last_six_days', v_last_seven
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mail_daily_digest_stats(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.mail_daily_digest_stats(uuid, timestamptz, timestamptz, text) IS
  'Aggregates mail stats for a UTC window aligned to caller bounds. '
  'Unsubscribes count mail_unsubscribes rows where unsubscribed_at falls in the window '
  '(when the person unsubscribed), independent of when the marketing email was sent.';
