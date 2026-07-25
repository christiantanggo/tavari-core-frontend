-- Manager-PIN guarded delete/archive for canonical HR training modules.
-- Used by both HR Training and Task Manager training doors.

CREATE OR REPLACE FUNCTION public.hr_training_delete_with_manager_pin(
  p_business_id uuid,
  p_training_item_id uuid,
  p_manager_pin text,
  p_hard_delete boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manager record;
  v_training public.hr_training_items%ROWTYPE;
BEGIN
  SELECT * INTO v_manager
  FROM public.task_manager_verify_pin(p_business_id, p_manager_pin)
  LIMIT 1;

  IF v_manager.employee_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid manager PIN');
  END IF;

  IF COALESCE(v_manager.role, '') NOT IN ('owner', 'admin', 'manager', 'hr_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Manager PIN required');
  END IF;

  SELECT * INTO v_training
  FROM public.hr_training_items
  WHERE id = p_training_item_id
    AND business_id = p_business_id
  FOR UPDATE;

  IF v_training.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Training module not found');
  END IF;

  IF p_hard_delete THEN
    DELETE FROM public.hr_training_items
    WHERE id = p_training_item_id
      AND business_id = p_business_id;
  ELSE
    UPDATE public.hr_training_items
    SET is_active = false,
        updated_at = now()
    WHERE id = p_training_item_id
      AND business_id = p_business_id;

    DELETE FROM public.task_manager_training_resources
    WHERE business_id = p_business_id
      AND hr_training_item_id = p_training_item_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'training_item_id', p_training_item_id,
    'hard_delete', p_hard_delete
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.hr_training_delete_with_manager_pin(uuid, uuid, text, boolean) TO authenticated;

