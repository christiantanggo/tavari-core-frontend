-- Distinguish training that gates kiosk sign-in from training assigned on hire but shown only on linked tasks.

ALTER TABLE public.hr_training_items
  ADD COLUMN IF NOT EXISTS kiosk_sign_in_required boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_hr_training_items_kiosk_sign_in
  ON public.hr_training_items (business_id, kiosk_sign_in_required)
  WHERE kiosk_sign_in_required = true AND is_active = true;

-- Standalone new-hire modules (create_task) should gate sign-in.
UPDATE public.hr_training_items
SET kiosk_sign_in_required = true
WHERE auto_assign_new_hires = true
  AND task_link_mode = 'create_task';

-- Task-linked cleaning modules stay assigned on hire but off the sign-in gate.
UPDATE public.hr_training_items
SET kiosk_sign_in_required = false
WHERE task_link_mode = 'existing_task';

CREATE OR REPLACE FUNCTION public.task_manager_kiosk_get_pending_training(
  p_business_id uuid,
  p_employee_id uuid,
  p_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_verified uuid;
  v_items jsonb := '[]'::jsonb;
BEGIN
  SELECT employee_id INTO v_verified
  FROM public.task_manager_verify_pin(p_business_id, p_pin)
  LIMIT 1;

  IF v_verified IS NULL OR v_verified <> p_employee_id THEN
    RAISE EXCEPTION 'Invalid PIN';
  END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY sort_key), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      jsonb_build_object(
        'assignment_id', a.id,
        'status', a.status,
        'due_date', a.due_date,
        'assigned_at', a.assigned_at,
        'requires_acknowledgement', hti.requires_acknowledgement,
        'quiz_enabled', COALESCE((hti.quiz->>'enabled')::boolean, false),
        'training_item_id', hti.id,
        'title', hti.title,
        'description', hti.description,
        'content', hti.content,
        'sections', hti.sections,
        'steps', hti.steps,
        'task_manager_task_id', a.task_manager_task_id
      ) AS row_data,
      COALESCE(a.due_date::text, '9999-12-31') || a.assigned_at::text AS sort_key
    FROM public.hr_training_assignments a
    JOIN public.hr_training_items hti ON hti.id = a.training_item_id
    WHERE a.business_id = p_business_id
      AND a.employee_id = p_employee_id
      AND a.status <> 'cancelled'
      AND hti.is_active = true
      AND hti.kiosk_sign_in_required = true
      AND (
        a.status IN ('assigned', 'in_progress')
        OR (
          a.status = 'completed'
          AND hti.requires_acknowledgement = true
          AND a.acknowledged_at IS NULL
        )
      )
  ) pending_rows;

  RETURN jsonb_build_object(
    'success', true,
    'items', v_items,
    'count', jsonb_array_length(v_items)
  );
END;
$$;

COMMENT ON COLUMN public.hr_training_items.kiosk_sign_in_required IS
  'When true, pending assignments for this module appear at task kiosk sign-in before the work queue.';
