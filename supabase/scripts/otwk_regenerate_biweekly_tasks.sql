-- One-time: regenerate Structure Deep Clean biweekly tasks after fresh-start wiped all anchors.

WITH biweek AS (
  SELECT
    '2026-06-21'::date AS start,
    '16b1012a-5e85-4747-9921-7bee922d5fe1'::uuid AS gid,
    'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'::uuid AS biz
),
anchors AS (
  SELECT DISTINCT ON (t.round_robin_slot_order) t.*
  FROM public.task_manager_tasks t
  CROSS JOIN biweek b
  WHERE t.round_robin_group_id = b.gid
    AND t.business_id = b.biz
    AND t.due_schedule_mode = 'biweekly_round_robin'
    AND t.round_robin_slot_order IS NOT NULL
  ORDER BY t.round_robin_slot_order, t.created_at ASC
),
next_sort AS (
  SELECT COALESCE(max(tm.round_robin_sort_order), -1) + 1 AS base
  FROM public.task_manager_tasks tm
  CROSS JOIN biweek b
  WHERE tm.round_robin_group_id = b.gid
    AND tm.business_id = b.biz
    AND tm.status <> 'cancelled'
),
inserted AS (
  INSERT INTO public.task_manager_tasks (
    business_id, title, description, category, category_id, priority,
    assignment_scope, assigned_to, status, available_at, due_at,
    requires_photo, photo_requirement_mode, requires_notes, peer_review_required, instructions, checklist,
    required_form_id, module_link_key, due_schedule_mode, round_robin_group_id,
    round_robin_sort_order, round_robin_slot_order, round_robin_week_start,
    review_status, created_by
  )
  SELECT
    a.business_id, a.title, a.description, a.category, a.category_id, a.priority,
    a.assignment_scope, a.assigned_to, 'to_do', now(), NULL,
    a.requires_photo, a.photo_requirement_mode, a.requires_notes, a.peer_review_required, a.instructions, a.checklist,
    a.required_form_id, a.module_link_key, a.due_schedule_mode, b.gid,
    (SELECT base FROM next_sort) + row_number() OVER (ORDER BY a.round_robin_slot_order) - 1,
    a.round_robin_slot_order, b.start,
    'not_required', a.created_by
  FROM anchors a
  CROSS JOIN biweek b
  RETURNING id
)
SELECT count(*) AS inserted FROM inserted;
