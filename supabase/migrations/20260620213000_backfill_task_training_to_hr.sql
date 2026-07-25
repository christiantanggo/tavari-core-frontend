-- Backfill legacy task/template-only training resources into canonical HR training items.
-- This makes training created through Task Manager appear in HR -> Training.

WITH legacy_resources AS (
  SELECT
    tr.*,
    COALESCE(t.title, tmpl.title, 'Task Manager') AS source_title
  FROM public.task_manager_training_resources tr
  LEFT JOIN public.task_manager_tasks t ON t.id = tr.task_id
  LEFT JOIN public.task_manager_templates tmpl ON tmpl.id = tr.template_id
  WHERE tr.hr_training_item_id IS NULL
),
created_items AS (
  INSERT INTO public.hr_training_items (
    business_id,
    title,
    description,
    content,
    resource_url,
    requires_acknowledgement,
    is_active,
    created_by,
    sections,
    steps,
    quiz,
    task_manager_enabled,
    task_link_mode,
    task_manager_task_id
  )
  SELECT
    lr.business_id,
    lr.title,
    'Created from Task Manager training for: ' || lr.source_title,
    lr.content,
    lr.resource_url,
    lr.is_required,
    true,
    lr.created_by,
    jsonb_build_object(
      'overview',
      jsonb_build_object(
        'text', lr.content,
        'image_url', CASE WHEN lr.resource_type = 'document' THEN lr.resource_url ELSE NULL END
      ),
      'objectives',
      jsonb_build_object('text', NULL, 'image_url', NULL),
      'notes',
      jsonb_build_object('text', 'Created from Task Manager training.', 'image_url', NULL)
    ),
    jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(),
      'order', 1,
      'title', lr.title,
      'body', lr.content,
      'resource_url', CASE WHEN lr.resource_type = 'link' THEN lr.resource_url ELSE NULL END,
      'image_url', CASE WHEN lr.resource_type = 'document' THEN lr.resource_url ELSE NULL END,
      'file_url', CASE WHEN lr.resource_type NOT IN ('link', 'document') THEN lr.resource_url ELSE NULL END,
      'is_required', lr.is_required
    )),
    '{}'::jsonb,
    true,
    CASE WHEN lr.task_id IS NOT NULL THEN 'existing_task' ELSE 'create_task' END,
    lr.task_id
  FROM legacy_resources lr
  RETURNING id, business_id, title, created_at
),
numbered_resources AS (
  SELECT
    lr.id AS resource_id,
    row_number() OVER (ORDER BY lr.created_at, lr.id) AS rn
  FROM legacy_resources lr
),
numbered_items AS (
  SELECT
    ci.id AS hr_training_item_id,
    row_number() OVER (ORDER BY ci.created_at, ci.id) AS rn
  FROM created_items ci
)
UPDATE public.task_manager_training_resources tr
SET hr_training_item_id = ni.hr_training_item_id
FROM numbered_resources nr
JOIN numbered_items ni ON ni.rn = nr.rn
WHERE tr.id = nr.resource_id;

