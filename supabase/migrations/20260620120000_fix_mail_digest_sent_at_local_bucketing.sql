-- mail_campaign_sends.sent_at is timestamp without time zone storing UTC wall clock.
-- Per-campaign 7-day digest bucketing must not use (sent_at AT TIME ZONE p_timezone)::date,
-- which treats UTC values as local wall time and shifts evening sends to the next calendar day.

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
  v_campaigns_seven_day jsonb := '[]'::jsonb;
  v_rollout_batches jsonb := '[]'::jsonb;
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
      'clicked_count', x.clicked_count,
      'open_rate_pct', CASE WHEN x.sent_count > 0
        THEN round((100.0 * x.opened_count / x.sent_count)::numeric, 2)
        ELSE 0 END,
      'click_rate_pct', CASE WHEN x.sent_count > 0
        THEN round((100.0 * x.clicked_count / x.sent_count)::numeric, 2)
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
      ) AS opened_count,
      COUNT(*) FILTER (
        WHERE mcs.status = 'sent'
          AND mcs.sent_at IS NOT NULL
          AND (mcs.sent_at AT TIME ZONE 'UTC') BETWEEN p_range_start AND p_range_end
          AND mcs.clicked_at IS NOT NULL
      ) AS clicked_count
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

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'campaign_name', rb.campaign_name,
      'batch_number', rb.batch_number,
      'sent_count', rb.sent_count,
      'opened_count', rb.opened_count,
      'clicked_count', rb.clicked_count,
      'open_rate_pct', CASE WHEN rb.sent_count > 0
        THEN round((100.0 * rb.opened_count / rb.sent_count)::numeric, 2)
        ELSE 0 END,
      'click_rate_pct', CASE WHEN rb.sent_count > 0
        THEN round((100.0 * rb.clicked_count / rb.sent_count)::numeric, 2)
        ELSE 0 END
    )
    ORDER BY rb.campaign_name, rb.batch_number
  ), '[]'::jsonb)
  INTO v_rollout_batches
  FROM (
    SELECT
      mc.name AS campaign_name,
      mcrb.batch_number,
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
      ) AS opened_count,
      COUNT(*) FILTER (
        WHERE mcs.status = 'sent'
          AND mcs.sent_at IS NOT NULL
          AND (mcs.sent_at AT TIME ZONE 'UTC') BETWEEN p_range_start AND p_range_end
          AND mcs.clicked_at IS NOT NULL
      ) AS clicked_count
    FROM public.mail_campaign_sends mcs
    INNER JOIN public.mail_campaigns mc ON mc.id = mcs.campaign_id AND mc.business_id = p_business_id
    INNER JOIN public.mail_campaign_rollout_batches mcrb ON mcrb.id = mcs.rollout_batch_id
    GROUP BY mc.name, mcrb.batch_number, mc.id, mcrb.id
    HAVING COUNT(*) FILTER (
      WHERE mcs.status = 'sent'
        AND mcs.sent_at IS NOT NULL
        AND (mcs.sent_at AT TIME ZONE 'UTC') BETWEEN p_range_start AND p_range_end
    ) > 0
  ) rb;

  v_anchor_end := (p_range_end AT TIME ZONE p_timezone)::date;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'campaign_id', q.campaign_id,
      'name', q.name,
      'days', q.days_json
    )
    ORDER BY q.name
  ), '[]'::jsonb)
  INTO v_campaigns_seven_day
  FROM (
    SELECT
      f.campaign_id,
      f.name,
      jsonb_agg(
        jsonb_build_object(
          'local_date', f.day_local,
          'sent', f.sent,
          'opened', f.opened,
          'clicked', f.clicked,
          'open_rate_pct', CASE WHEN f.sent > 0
            THEN round((100.0 * f.opened / f.sent)::numeric, 2)
            ELSE 0 END,
          'click_rate_pct', CASE WHEN f.sent > 0
            THEN round((100.0 * f.clicked / f.sent)::numeric, 2)
            ELSE 0 END
        )
        ORDER BY f.day_local
      ) AS days_json
    FROM (
      SELECT
        c.campaign_id,
        c.name,
        s.day_local,
        COALESCE(d.sent, 0)::bigint AS sent,
        COALESCE(d.opened, 0)::bigint AS opened,
        COALESCE(d.clicked, 0)::bigint AS clicked
      FROM (
        SELECT DISTINCT mc.id AS campaign_id, mc.name
        FROM public.mail_campaigns mc
        INNER JOIN public.mail_campaign_sends mcs ON mcs.campaign_id = mc.id
        WHERE mc.business_id = p_business_id
          AND mcs.status = 'sent'
          AND mcs.sent_at IS NOT NULL
          AND (mcs.sent_at AT TIME ZONE 'UTC') >= (v_anchor_end - 6)::timestamp AT TIME ZONE p_timezone
          AND (mcs.sent_at AT TIME ZONE 'UTC') < (v_anchor_end + 1)::timestamp AT TIME ZONE p_timezone
      ) c
      CROSS JOIN (
        SELECT gs::date AS day_local
        FROM generate_series(
          v_anchor_end - 6,
          v_anchor_end,
          interval '1 day'
        ) AS gs
      ) s
      LEFT JOIN (
        SELECT
          mc.id AS campaign_id,
          ((mcs.sent_at AT TIME ZONE 'UTC') AT TIME ZONE p_timezone)::date AS day_local,
          COUNT(*) FILTER (
            WHERE mcs.status = 'sent'
              AND mcs.sent_at IS NOT NULL
          ) AS sent,
          COUNT(*) FILTER (
            WHERE mcs.status = 'sent'
              AND mcs.sent_at IS NOT NULL
              AND mcs.opened_at IS NOT NULL
          ) AS opened,
          COUNT(*) FILTER (
            WHERE mcs.status = 'sent'
              AND mcs.sent_at IS NOT NULL
              AND mcs.clicked_at IS NOT NULL
          ) AS clicked
        FROM public.mail_campaign_sends mcs
        INNER JOIN public.mail_campaigns mc ON mc.id = mcs.campaign_id AND mc.business_id = p_business_id
        WHERE (mcs.sent_at AT TIME ZONE 'UTC') >= (v_anchor_end - 6)::timestamp AT TIME ZONE p_timezone
          AND (mcs.sent_at AT TIME ZONE 'UTC') < (v_anchor_end + 1)::timestamp AT TIME ZONE p_timezone
        GROUP BY mc.id, ((mcs.sent_at AT TIME ZONE 'UTC') AT TIME ZONE p_timezone)::date
      ) d ON d.campaign_id = c.campaign_id AND d.day_local = s.day_local
    ) f
    GROUP BY f.campaign_id, f.name
  ) q;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'local_date', sd.day_local,
      'sent', sd.day_sent,
      'opened', sd.day_opened,
      'open_rate_pct', CASE WHEN sd.day_sent > 0
        THEN round((100.0 * sd.day_opened / sd.day_sent)::numeric, 2)
        ELSE 0 END,
      'clicked', sd.day_clicked,
      'click_rate_pct', CASE WHEN sd.day_sent > 0
        THEN round((100.0 * sd.day_clicked / sd.day_sent)::numeric, 2)
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
      ) AS day_opened,
      (
        SELECT COUNT(*) FILTER (
          WHERE mcs.status = 'sent'
            AND mcs.sent_at IS NOT NULL
            AND mcs.clicked_at IS NOT NULL
            AND (mcs.sent_at AT TIME ZONE 'UTC') >= (ds.day_local::timestamp AT TIME ZONE p_timezone)
            AND (mcs.sent_at AT TIME ZONE 'UTC') < ((ds.day_local + 1)::timestamp AT TIME ZONE p_timezone)
        )
        FROM public.mail_campaign_sends mcs
        INNER JOIN public.mail_campaigns mc ON mc.id = mcs.campaign_id AND mc.business_id = p_business_id
      ) AS day_clicked
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
    'anchor_local_date', v_anchor_end,
    'sent_count', v_sent,
    'opened_count', v_opened,
    'clicked_count', v_clicked,
    'open_rate_pct', v_open_rate,
    'click_rate_pct', v_click_rate,
    'campaigns', v_campaigns,
    'campaigns_seven_day', v_campaigns_seven_day,
    'rollout_batches', v_rollout_batches,
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
  'Digest stats: summary uses p_range_* window; campaigns_seven_day buckets sent_at as UTC then converts to p_timezone for local calendar dates.';
