-- Re-interpret legacy task timestamps that were stored as UTC wall-clock times
-- (e.g. 9:00 AM intended local was saved as 09:00+00 instead of proper timestamptz).

UPDATE public.task_manager_tasks t
SET scheduled_for = public.forms_slot_at(
  (t.scheduled_for AT TIME ZONE COALESCE(b.timezone, 'America/Toronto'))::date,
  to_char(t.scheduled_for AT TIME ZONE 'UTC', 'HH24:MI'),
  COALESCE(b.timezone, 'America/Toronto')
)
FROM public.businesses b
WHERE t.business_id = b.id
  AND t.scheduled_for IS NOT NULL;

UPDATE public.task_manager_tasks t
SET due_at = t.scheduled_for + make_interval(mins => COALESCE(tmpl.due_window_minutes, 60))
FROM public.task_manager_templates tmpl
WHERE t.template_id = tmpl.id
  AND t.scheduled_for IS NOT NULL;

UPDATE public.task_manager_tasks t
SET due_at = public.forms_slot_at(
  (t.due_at AT TIME ZONE COALESCE(b.timezone, 'America/Toronto'))::date,
  to_char(t.due_at AT TIME ZONE 'UTC', 'HH24:MI'),
  COALESCE(b.timezone, 'America/Toronto')
)
FROM public.businesses b
WHERE t.business_id = b.id
  AND t.template_id IS NULL
  AND t.due_at IS NOT NULL;
