-- Reliability fixes for digital signage schedules and playlist saves.

CREATE OR REPLACE FUNCTION public.check_schedule_conflicts(
  business_uuid uuid,
  screen_ids uuid[],
  start_time_param time without time zone,
  end_time_param time without time zone,
  days_param integer[],
  exclude_schedule_id uuid DEFAULT NULL
)
RETURNS TABLE (
  conflict_schedule_id uuid,
  conflict_schedule_name text,
  conflict_type text,
  conflict_details jsonb
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.schedule_name,
    'time_overlap'::text,
    jsonb_build_object(
      'start_time', s.start_time,
      'end_time', s.end_time,
      'days_of_week', s.days_of_week,
      'apply_to_screens', s.apply_to_screens
    )
  FROM public.digital_signage_schedules s
  WHERE s.business_id = business_uuid
    AND s.is_active = true
    AND (exclude_schedule_id IS NULL OR s.id <> exclude_schedule_id)
    AND COALESCE(array_length(screen_ids, 1), 0) > 0
    AND s.apply_to_screens IS NOT NULL
    AND s.apply_to_screens && screen_ids
    AND (
      COALESCE(array_length(days_param, 1), 0) = 0
      OR s.days_of_week IS NULL
      OR COALESCE(array_length(s.days_of_week, 1), 0) = 0
      OR s.days_of_week && days_param
    )
    AND (
      -- If either schedule is all-day/open-ended, a shared screen/day is a conflict.
      s.start_time IS NULL
      OR s.end_time IS NULL
      OR start_time_param IS NULL
      OR end_time_param IS NULL
      OR (s.start_time, s.end_time) OVERLAPS (start_time_param, end_time_param)
      OR (
        s.end_time < s.start_time
        AND (
          (start_time_param, end_time_param) OVERLAPS (s.start_time, '23:59:59'::time)
          OR (start_time_param, end_time_param) OVERLAPS ('00:00:00'::time, s.end_time)
        )
      )
      OR (
        end_time_param < start_time_param
        AND (
          (s.start_time, s.end_time) OVERLAPS (start_time_param, '23:59:59'::time)
          OR (s.start_time, s.end_time) OVERLAPS ('00:00:00'::time, end_time_param)
        )
      )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.replace_digital_signage_schedule_items(
  schedule_uuid uuid,
  business_uuid uuid,
  items jsonb DEFAULT '[]'::jsonb,
  shuffle_playlist_param boolean DEFAULT false
)
RETURNS void AS $$
DECLARE
  item jsonb;
  idx integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.digital_signage_schedules s
    WHERE s.id = schedule_uuid
      AND s.business_id = business_uuid
      AND s.is_active = true
      AND public.is_digital_signage_business_member(s.business_id)
  ) THEN
    RAISE EXCEPTION 'Schedule not found or access denied';
  END IF;

  IF jsonb_typeof(items) <> 'array' THEN
    RAISE EXCEPTION 'items must be an array';
  END IF;

  CREATE TEMP TABLE tmp_digital_signage_schedule_items (
    schedule_id uuid NOT NULL,
    content_id uuid NOT NULL,
    zone_id uuid,
    display_order integer NOT NULL,
    duration_seconds integer,
    transition_type text,
    transition_duration_ms integer
  ) ON COMMIT DROP;

  FOR item IN SELECT * FROM jsonb_array_elements(items)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.digital_signage_content c
      WHERE c.id = (item->>'contentId')::uuid
        AND c.business_id = business_uuid
        AND c.is_active = true
    ) THEN
      RAISE EXCEPTION 'Content not found or inactive: %', item->>'contentId';
    END IF;

    IF NULLIF(item->>'zoneId', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.digital_signage_zones z
        WHERE z.id = (item->>'zoneId')::uuid
          AND z.business_id = business_uuid
          AND z.is_active = true
      )
    THEN
      RAISE EXCEPTION 'Zone not found or inactive: %', item->>'zoneId';
    END IF;

    INSERT INTO tmp_digital_signage_schedule_items (
      schedule_id,
      content_id,
      zone_id,
      display_order,
      duration_seconds,
      transition_type,
      transition_duration_ms
    )
    VALUES (
      schedule_uuid,
      (item->>'contentId')::uuid,
      NULLIF(item->>'zoneId', '')::uuid,
      idx,
      NULLIF(item->>'durationSeconds', '')::integer,
      COALESCE(NULLIF(item->>'transitionType', ''), 'fade'),
      COALESCE(NULLIF(item->>'transitionDurationMs', '')::integer, 500)
    );

    idx := idx + 1;
  END LOOP;

  DELETE FROM public.digital_signage_schedule_items
  WHERE schedule_id = schedule_uuid;

  INSERT INTO public.digital_signage_schedule_items (
    schedule_id,
    content_id,
    zone_id,
    display_order,
    duration_seconds,
    transition_type,
    transition_duration_ms
  )
  SELECT
    schedule_id,
    content_id,
    zone_id,
    display_order,
    duration_seconds,
    transition_type,
    transition_duration_ms
  FROM tmp_digital_signage_schedule_items
  ORDER BY display_order;

  UPDATE public.digital_signage_schedules
  SET shuffle_playlist = COALESCE(shuffle_playlist_param, false),
      updated_at = timezone('utc'::text, now())
  WHERE id = schedule_uuid
    AND business_id = business_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.check_schedule_conflicts(uuid, uuid[], time without time zone, time without time zone, integer[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_digital_signage_schedule_items(uuid, uuid, jsonb, boolean) TO authenticated;
