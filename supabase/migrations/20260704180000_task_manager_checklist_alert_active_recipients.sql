-- Stop checklist alert emails to terminated / inactive staff still on recipient lists.

DELETE FROM public.task_manager_checklist_alert_recipients r
USING public.users u
WHERE r.employee_id = u.id
  AND (
    lower(coalesce(u.employment_status, '')) IN ('terminated', 'suspended')
    OR u.is_active = false
    OR u.termination_date IS NOT NULL
  );
