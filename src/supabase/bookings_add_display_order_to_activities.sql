-- ============================================
-- ADD DISPLAY_ORDER TO BOOKING_ACTIVITIES
-- ============================================
-- Adds display_order field to allow custom ordering of activities within categories

-- Add display_order column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'booking_activities' 
    AND column_name = 'display_order'
  ) THEN
    ALTER TABLE booking_activities 
    ADD COLUMN display_order INTEGER DEFAULT 0;
    
    -- Create index for efficient ordering queries
    CREATE INDEX IF NOT EXISTS idx_booking_activities_type_order 
      ON booking_activities(type_id, display_order) 
      WHERE is_active = true;
    
    -- Update existing activities to have sequential display_order within their categories
    WITH ordered_activities AS (
      SELECT 
        id,
        type_id,
        ROW_NUMBER() OVER (PARTITION BY type_id ORDER BY created_at) - 1 AS new_order
      FROM booking_activities
      WHERE type_id IS NOT NULL
    )
    UPDATE booking_activities ba
    SET display_order = oa.new_order
    FROM ordered_activities oa
    WHERE ba.id = oa.id;
  END IF;
END $$;

-- Add comment
COMMENT ON COLUMN booking_activities.display_order IS 'Order in which activities are displayed within their category (0-based)';
