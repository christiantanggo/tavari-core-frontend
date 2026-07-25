-- Create triggers and functions for digital signage tables
-- Pattern: Matches existing Tavari trigger patterns

-- ============================================
-- 1. Updated_at trigger function
-- ============================================
CREATE OR REPLACE FUNCTION update_digital_signage_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create updated_at triggers for all tables
CREATE TRIGGER digital_signage_screen_groups_updated_at
    BEFORE UPDATE ON digital_signage_screen_groups
    FOR EACH ROW EXECUTE FUNCTION update_digital_signage_updated_at();

CREATE TRIGGER digital_signage_templates_updated_at
    BEFORE UPDATE ON digital_signage_templates
    FOR EACH ROW EXECUTE FUNCTION update_digital_signage_updated_at();

CREATE TRIGGER digital_signage_ad_campaigns_updated_at
    BEFORE UPDATE ON digital_signage_ad_campaigns
    FOR EACH ROW EXECUTE FUNCTION update_digital_signage_updated_at();

CREATE TRIGGER digital_signage_content_updated_at
    BEFORE UPDATE ON digital_signage_content
    FOR EACH ROW EXECUTE FUNCTION update_digital_signage_updated_at();

CREATE TRIGGER digital_signage_schedules_updated_at
    BEFORE UPDATE ON digital_signage_schedules
    FOR EACH ROW EXECUTE FUNCTION update_digital_signage_updated_at();

CREATE TRIGGER digital_signage_schedule_items_updated_at
    BEFORE UPDATE ON digital_signage_schedule_items
    FOR EACH ROW EXECUTE FUNCTION update_digital_signage_updated_at();

CREATE TRIGGER digital_signage_time_rules_updated_at
    BEFORE UPDATE ON digital_signage_time_rules
    FOR EACH ROW EXECUTE FUNCTION update_digital_signage_updated_at();

CREATE TRIGGER digital_signage_screens_updated_at
    BEFORE UPDATE ON digital_signage_screens
    FOR EACH ROW EXECUTE FUNCTION update_digital_signage_updated_at();

CREATE TRIGGER digital_signage_zones_updated_at
    BEFORE UPDATE ON digital_signage_zones
    FOR EACH ROW EXECUTE FUNCTION update_digital_signage_updated_at();

CREATE TRIGGER digital_signage_zone_content_updated_at
    BEFORE UPDATE ON digital_signage_zone_content
    FOR EACH ROW EXECUTE FUNCTION update_digital_signage_updated_at();

CREATE TRIGGER digital_signage_ads_updated_at
    BEFORE UPDATE ON digital_signage_ads
    FOR EACH ROW EXECUTE FUNCTION update_digital_signage_updated_at();

CREATE TRIGGER digital_signage_settings_updated_at
    BEFORE UPDATE ON digital_signage_settings
    FOR EACH ROW EXECUTE FUNCTION update_digital_signage_updated_at();

-- ============================================
-- 2. Content versioning trigger
-- ============================================
CREATE OR REPLACE FUNCTION digital_signage_content_version_trigger()
RETURNS TRIGGER AS $$
DECLARE
    current_version integer;
BEGIN
    -- Get current max version number
    SELECT COALESCE(MAX(version_number), 0) INTO current_version
    FROM digital_signage_content_versions
    WHERE content_id = NEW.id;

    -- Create version entry before update
    IF TG_OP = 'UPDATE' THEN
        INSERT INTO digital_signage_content_versions (
            content_id,
            version_number,
            file_url,
            file_path,
            file_size,
            width,
            height,
            duration_seconds,
            metadata,
            created_by
        )
        VALUES (
            OLD.id,
            current_version + 1,
            OLD.file_url,
            OLD.file_path,
            OLD.file_size,
            OLD.width,
            OLD.height,
            OLD.duration_seconds,
            OLD.metadata,
            OLD.created_by
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER digital_signage_content_version_trigger
    BEFORE UPDATE ON digital_signage_content
    FOR EACH ROW
    WHEN (OLD.file_url IS DISTINCT FROM NEW.file_url OR OLD.file_path IS DISTINCT FROM NEW.file_path)
    EXECUTE FUNCTION digital_signage_content_version_trigger();

-- ============================================
-- 3. Update screen heartbeat function
-- ============================================
CREATE OR REPLACE FUNCTION update_screen_heartbeat(screen_key_param text)
RETURNS void AS $$
BEGIN
    UPDATE digital_signage_screens
    SET 
        last_seen_at = timezone('utc'::text, now()),
        status = 'online'
    WHERE screen_key = screen_key_param
        AND is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4. Check schedule conflicts function
-- ============================================
CREATE OR REPLACE FUNCTION check_schedule_conflicts(
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
            'days_of_week', s.days_of_week
        )
    FROM digital_signage_schedules s
    WHERE s.business_id = business_uuid
        AND s.is_active = true
        AND (exclude_schedule_id IS NULL OR s.id != exclude_schedule_id)
        AND (
            -- Check if screens overlap
            (screen_ids IS NOT NULL AND s.apply_to_screens IS NOT NULL AND 
             s.apply_to_screens && screen_ids)
            OR
            -- Check if time overlaps
            (s.start_time IS NOT NULL AND s.end_time IS NOT NULL AND
             start_time_param IS NOT NULL AND end_time_param IS NOT NULL AND
             (s.start_time, s.end_time) OVERLAPS (start_time_param, end_time_param))
        )
        AND (
            -- Check if days overlap
            (days_param IS NULL OR s.days_of_week IS NULL OR 
             s.days_of_week && days_param)
        );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 5. Get content usage stats function
-- ============================================
CREATE OR REPLACE FUNCTION get_content_usage_stats(
    business_uuid uuid,
    content_uuid uuid
)
RETURNS TABLE (
    total_playbacks bigint,
    total_duration_seconds bigint,
    unique_screens bigint,
    last_played_at timestamptz,
    average_duration_seconds numeric
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::bigint as total_playbacks,
        COALESCE(SUM(duration_seconds), 0)::bigint as total_duration_seconds,
        COUNT(DISTINCT screen_id)::bigint as unique_screens,
        MAX(playback_started_at) as last_played_at,
        COALESCE(AVG(duration_seconds), 0)::numeric as average_duration_seconds
    FROM digital_signage_playback_logs
    WHERE business_id = business_uuid
        AND content_id = content_uuid
        AND completed = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;



