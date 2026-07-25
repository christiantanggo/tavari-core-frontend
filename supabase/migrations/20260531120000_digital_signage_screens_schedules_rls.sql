-- RLS for digital_signage_screens, schedules, zones, groups, templates, schedule_items.
-- Reuses is_digital_signage_business_member from 20260407113000.

-- ---------------------------------------------------------------------------
-- digital_signage_screens
-- ---------------------------------------------------------------------------
ALTER TABLE public.digital_signage_screens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "digital_signage_screens_select" ON public.digital_signage_screens;
DROP POLICY IF EXISTS "digital_signage_screens_insert" ON public.digital_signage_screens;
DROP POLICY IF EXISTS "digital_signage_screens_update" ON public.digital_signage_screens;
DROP POLICY IF EXISTS "digital_signage_screens_delete" ON public.digital_signage_screens;
DROP POLICY IF EXISTS "tosa_digital_signage_screens_all" ON public.digital_signage_screens;

CREATE POLICY "digital_signage_screens_select"
  ON public.digital_signage_screens
  FOR SELECT
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id));

CREATE POLICY "digital_signage_screens_insert"
  ON public.digital_signage_screens
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_digital_signage_business_member(business_id));

CREATE POLICY "digital_signage_screens_update"
  ON public.digital_signage_screens
  FOR UPDATE
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id))
  WITH CHECK (public.is_digital_signage_business_member(business_id));

CREATE POLICY "digital_signage_screens_delete"
  ON public.digital_signage_screens
  FOR DELETE
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id));

CREATE POLICY "tosa_digital_signage_screens_all"
  ON public.digital_signage_screens
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tavari_employees te
      WHERE te.user_id = auth.uid()
        AND te.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tavari_employees te
      WHERE te.user_id = auth.uid()
        AND te.is_active = true
    )
  );

-- ---------------------------------------------------------------------------
-- digital_signage_screen_groups
-- ---------------------------------------------------------------------------
ALTER TABLE public.digital_signage_screen_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "digital_signage_screen_groups_select" ON public.digital_signage_screen_groups;
DROP POLICY IF EXISTS "digital_signage_screen_groups_insert" ON public.digital_signage_screen_groups;
DROP POLICY IF EXISTS "digital_signage_screen_groups_update" ON public.digital_signage_screen_groups;
DROP POLICY IF EXISTS "digital_signage_screen_groups_delete" ON public.digital_signage_screen_groups;

CREATE POLICY "digital_signage_screen_groups_select"
  ON public.digital_signage_screen_groups
  FOR SELECT
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id));

CREATE POLICY "digital_signage_screen_groups_insert"
  ON public.digital_signage_screen_groups
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_digital_signage_business_member(business_id));

CREATE POLICY "digital_signage_screen_groups_update"
  ON public.digital_signage_screen_groups
  FOR UPDATE
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id))
  WITH CHECK (public.is_digital_signage_business_member(business_id));

CREATE POLICY "digital_signage_screen_groups_delete"
  ON public.digital_signage_screen_groups
  FOR DELETE
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id));

-- ---------------------------------------------------------------------------
-- digital_signage_schedules
-- ---------------------------------------------------------------------------
ALTER TABLE public.digital_signage_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "digital_signage_schedules_select" ON public.digital_signage_schedules;
DROP POLICY IF EXISTS "digital_signage_schedules_insert" ON public.digital_signage_schedules;
DROP POLICY IF EXISTS "digital_signage_schedules_update" ON public.digital_signage_schedules;
DROP POLICY IF EXISTS "digital_signage_schedules_delete" ON public.digital_signage_schedules;

CREATE POLICY "digital_signage_schedules_select"
  ON public.digital_signage_schedules
  FOR SELECT
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id));

CREATE POLICY "digital_signage_schedules_insert"
  ON public.digital_signage_schedules
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_digital_signage_business_member(business_id));

CREATE POLICY "digital_signage_schedules_update"
  ON public.digital_signage_schedules
  FOR UPDATE
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id))
  WITH CHECK (public.is_digital_signage_business_member(business_id));

CREATE POLICY "digital_signage_schedules_delete"
  ON public.digital_signage_schedules
  FOR DELETE
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id));

-- ---------------------------------------------------------------------------
-- digital_signage_schedule_items (via parent schedule business_id)
-- ---------------------------------------------------------------------------
ALTER TABLE public.digital_signage_schedule_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "digital_signage_schedule_items_select" ON public.digital_signage_schedule_items;
DROP POLICY IF EXISTS "digital_signage_schedule_items_insert" ON public.digital_signage_schedule_items;
DROP POLICY IF EXISTS "digital_signage_schedule_items_update" ON public.digital_signage_schedule_items;
DROP POLICY IF EXISTS "digital_signage_schedule_items_delete" ON public.digital_signage_schedule_items;

CREATE POLICY "digital_signage_schedule_items_select"
  ON public.digital_signage_schedule_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.digital_signage_schedules s
      WHERE s.id = digital_signage_schedule_items.schedule_id
        AND public.is_digital_signage_business_member(s.business_id)
    )
  );

CREATE POLICY "digital_signage_schedule_items_insert"
  ON public.digital_signage_schedule_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.digital_signage_schedules s
      WHERE s.id = digital_signage_schedule_items.schedule_id
        AND public.is_digital_signage_business_member(s.business_id)
    )
  );

CREATE POLICY "digital_signage_schedule_items_update"
  ON public.digital_signage_schedule_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.digital_signage_schedules s
      WHERE s.id = digital_signage_schedule_items.schedule_id
        AND public.is_digital_signage_business_member(s.business_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.digital_signage_schedules s
      WHERE s.id = digital_signage_schedule_items.schedule_id
        AND public.is_digital_signage_business_member(s.business_id)
    )
  );

CREATE POLICY "digital_signage_schedule_items_delete"
  ON public.digital_signage_schedule_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.digital_signage_schedules s
      WHERE s.id = digital_signage_schedule_items.schedule_id
        AND public.is_digital_signage_business_member(s.business_id)
    )
  );

-- ---------------------------------------------------------------------------
-- digital_signage_zones
-- ---------------------------------------------------------------------------
ALTER TABLE public.digital_signage_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "digital_signage_zones_select" ON public.digital_signage_zones;
DROP POLICY IF EXISTS "digital_signage_zones_insert" ON public.digital_signage_zones;
DROP POLICY IF EXISTS "digital_signage_zones_update" ON public.digital_signage_zones;
DROP POLICY IF EXISTS "digital_signage_zones_delete" ON public.digital_signage_zones;

CREATE POLICY "digital_signage_zones_select"
  ON public.digital_signage_zones
  FOR SELECT
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id));

CREATE POLICY "digital_signage_zones_insert"
  ON public.digital_signage_zones
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_digital_signage_business_member(business_id));

CREATE POLICY "digital_signage_zones_update"
  ON public.digital_signage_zones
  FOR UPDATE
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id))
  WITH CHECK (public.is_digital_signage_business_member(business_id));

CREATE POLICY "digital_signage_zones_delete"
  ON public.digital_signage_zones
  FOR DELETE
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id));

-- ---------------------------------------------------------------------------
-- digital_signage_templates (if table exists)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'digital_signage_templates'
  ) THEN
    EXECUTE 'ALTER TABLE public.digital_signage_templates ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "digital_signage_templates_select" ON public.digital_signage_templates';
    EXECUTE 'DROP POLICY IF EXISTS "digital_signage_templates_insert" ON public.digital_signage_templates';
    EXECUTE 'DROP POLICY IF EXISTS "digital_signage_templates_update" ON public.digital_signage_templates';
    EXECUTE 'DROP POLICY IF EXISTS "digital_signage_templates_delete" ON public.digital_signage_templates';

    EXECUTE $pol$
      CREATE POLICY "digital_signage_templates_select"
        ON public.digital_signage_templates
        FOR SELECT
        TO authenticated
        USING (public.is_digital_signage_business_member(business_id))
    $pol$;

    EXECUTE $pol$
      CREATE POLICY "digital_signage_templates_insert"
        ON public.digital_signage_templates
        FOR INSERT
        TO authenticated
        WITH CHECK (public.is_digital_signage_business_member(business_id))
    $pol$;

    EXECUTE $pol$
      CREATE POLICY "digital_signage_templates_update"
        ON public.digital_signage_templates
        FOR UPDATE
        TO authenticated
        USING (public.is_digital_signage_business_member(business_id))
        WITH CHECK (public.is_digital_signage_business_member(business_id))
    $pol$;

    EXECUTE $pol$
      CREATE POLICY "digital_signage_templates_delete"
        ON public.digital_signage_templates
        FOR DELETE
        TO authenticated
        USING (public.is_digital_signage_business_member(business_id))
    $pol$;
  END IF;
END $$;
