-- HR training builder: rich steps, optional quiz, and task-manager linkage.

ALTER TABLE public.hr_training_items
  ADD COLUMN IF NOT EXISTS steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sections jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS quiz jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS task_manager_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS task_link_mode text NOT NULL DEFAULT 'create_task'
    CHECK (task_link_mode IN ('create_task', 'existing_task')),
  ADD COLUMN IF NOT EXISTS task_manager_task_id uuid REFERENCES public.task_manager_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS task_category_id uuid REFERENCES public.task_manager_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS task_priority text NOT NULL DEFAULT 'medium'
    CHECK (task_priority IN ('low', 'medium', 'high', 'urgent')),
  ADD COLUMN IF NOT EXISTS task_requires_completion boolean NOT NULL DEFAULT false;

ALTER TABLE public.hr_training_assignments
  ADD COLUMN IF NOT EXISTS task_manager_task_id uuid REFERENCES public.task_manager_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quiz_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS quiz_score numeric(5,2),
  ADD COLUMN IF NOT EXISTS quiz_passed boolean;

CREATE INDEX IF NOT EXISTS idx_hr_training_items_task_manager
  ON public.hr_training_items (business_id, task_manager_enabled, task_category_id);

CREATE INDEX IF NOT EXISTS idx_hr_training_assignments_task
  ON public.hr_training_assignments (business_id, task_manager_task_id)
  WHERE task_manager_task_id IS NOT NULL;

-- Reuse the task training media bucket so task resources and HR training uploads share one public media source.
INSERT INTO storage.buckets (id, name, public)
VALUES ('task-training-media', 'task-training-media', true)
ON CONFLICT (id) DO UPDATE SET public = true;

