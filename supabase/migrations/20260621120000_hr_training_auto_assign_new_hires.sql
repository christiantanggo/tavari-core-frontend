-- Auto-assign selected HR training modules when a new employee joins a business.

ALTER TABLE public.hr_training_items
  ADD COLUMN IF NOT EXISTS auto_assign_new_hires boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_hr_training_items_auto_assign_new_hires
  ON public.hr_training_items (business_id, auto_assign_new_hires)
  WHERE auto_assign_new_hires = true AND is_active = true;

CREATE OR REPLACE FUNCTION public.hr_training_auto_assign_new_hire(
  p_business_id uuid,
  p_employee_id uuid,
  p_assigned_by uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.hr_training_items%ROWTYPE;
  v_assignment_id uuid;
  v_task_id uuid;
  v_count integer := 0;
BEGIN
  IF p_business_id IS NULL OR p_employee_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_item IN
    SELECT *
    FROM public.hr_training_items
    WHERE business_id = p_business_id
      AND is_active = true
      AND auto_assign_new_hires = true
    ORDER BY created_at ASC
  LOOP
    INSERT INTO public.hr_training_assignments (
      business_id,
      training_item_id,
      employee_id,
      status,
      assigned_by,
      assigned_at,
      updated_at
    )
    VALUES (
      p_business_id,
      v_item.id,
      p_employee_id,
      'assigned',
      p_assigned_by,
      now(),
      now()
    )
    ON CONFLICT (training_item_id, employee_id) DO NOTHING
    RETURNING id INTO v_assignment_id;

    IF v_assignment_id IS NULL THEN
      CONTINUE;
    END IF;

    v_count := v_count + 1;

    IF v_item.task_manager_enabled
       AND v_item.task_link_mode = 'create_task'
       AND v_item.task_requires_completion IS NOT FALSE THEN
      INSERT INTO public.task_manager_tasks (
        business_id,
        title,
        description,
        category_id,
        category,
        priority,
        assignment_scope,
        assigned_to,
        available_at,
        instructions,
        checklist,
        requires_photo,
        requires_notes,
        peer_review_required,
        manager_review_required,
        review_status,
        created_by
      )
      VALUES (
        p_business_id,
        'Training: ' || v_item.title,
        COALESCE(v_item.description, v_item.content),
        v_item.task_category_id,
        CASE WHEN v_item.task_category_id IS NULL THEN 'Training' ELSE NULL END,
        COALESCE(v_item.task_priority, 'medium'),
        'assigned',
        p_employee_id,
        now(),
        'Complete HR training: ' || v_item.title,
        jsonb_build_array(
          jsonb_build_object('label', 'Review all training steps'),
          jsonb_build_object('label', 'Complete HR training acknowledgement')
        ),
        false,
        false,
        false,
        false,
        'not_required',
        p_assigned_by
      )
      RETURNING id INTO v_task_id;

      UPDATE public.hr_training_assignments
      SET task_manager_task_id = v_task_id,
          updated_at = now()
      WHERE id = v_assignment_id;

      INSERT INTO public.task_manager_training_resources (
        business_id,
        task_id,
        template_id,
        hr_training_item_id,
        title,
        resource_type,
        resource_url,
        content,
        is_required,
        created_by
      )
      VALUES (
        p_business_id,
        v_task_id,
        NULL,
        v_item.id,
        v_item.title,
        'text',
        NULL,
        COALESCE(v_item.description, v_item.content),
        true,
        p_assigned_by
      );
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_business_users_auto_assign_training()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(COALESCE(NEW.role, 'employee')) <> 'employee' THEN
    RETURN NEW;
  END IF;

  PERFORM public.hr_training_auto_assign_new_hire(NEW.business_id, NEW.user_id, NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS business_users_auto_assign_training ON public.business_users;

CREATE TRIGGER business_users_auto_assign_training
  AFTER INSERT ON public.business_users
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_business_users_auto_assign_training();

COMMENT ON COLUMN public.hr_training_items.auto_assign_new_hires IS
  'When true, this module is assigned automatically when a new employee joins the business.';

COMMENT ON FUNCTION public.hr_training_auto_assign_new_hire(uuid, uuid, uuid) IS
  'Assigns all auto_assign_new_hires training modules to one employee; creates linked Task Manager tasks when configured.';

GRANT EXECUTE ON FUNCTION public.hr_training_auto_assign_new_hire(uuid, uuid, uuid) TO authenticated;
