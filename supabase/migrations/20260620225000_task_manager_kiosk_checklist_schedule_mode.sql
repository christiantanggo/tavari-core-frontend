-- Allow kiosk_checklist schedule mode (category-configurable checklist buttons).

ALTER TABLE public.task_manager_tasks
  DROP CONSTRAINT IF EXISTS task_manager_tasks_due_schedule_mode_check;

ALTER TABLE public.task_manager_tasks
  ADD CONSTRAINT task_manager_tasks_due_schedule_mode_check
  CHECK (due_schedule_mode IN (
    'specific_date', 'frequency', 'round_robin', 'weekly_round_robin',
    'daily_required', 'opening_checklist', 'closing_checklist', 'kiosk_checklist'
  ));

DROP INDEX IF EXISTS idx_task_manager_tasks_checklist;

CREATE INDEX IF NOT EXISTS idx_task_manager_tasks_checklist
  ON public.task_manager_tasks (business_id, category_id, checklist_sort_order)
  WHERE due_schedule_mode IN ('opening_checklist', 'closing_checklist', 'kiosk_checklist');
