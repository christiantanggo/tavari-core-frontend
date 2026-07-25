-- Manager/admin: wipe testing backlog and regenerate current week/biweek round-robin tasks.

CREATE OR REPLACE FUNCTION public.task_manager_admin_fresh_start_queue(
  p_business_id uuid,
  p_reset_checklists boolean DEFAULT true,
  p_clear_peer_review_pool boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week date;
  v_biweek date;
  v_cancelled_prior integer := 0;
  v_cancelled_current integer := 0;
  v_checklists_reset integer := 0;
  v_peer_cleared integer := 0;
  v_regenerated integer := 0;
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'business_id is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = p_business_id) THEN
    RAISE EXCEPTION 'Business not found';
  END IF;

  v_week := public.task_manager_business_week_start(p_business_id);
  v_biweek := public.task_manager_business_biweekly_period_start(p_business_id);

  -- Drop stale open tasks from prior round-robin periods (testing backlog).
  UPDATE public.task_manager_tasks
  SET status = 'cancelled', updated_at = now()
  WHERE business_id = p_business_id
    AND status IN ('to_do', 'in_progress', 'incomplete')
    AND (
      (due_schedule_mode = 'weekly_round_robin'
        AND COALESCE(round_robin_week_start, '1900-01-01'::date) <> v_week)
      OR (due_schedule_mode = 'biweekly_round_robin'
        AND COALESCE(round_robin_week_start, '1900-01-01'::date) <> v_biweek)
    );
  GET DIAGNOSTICS v_cancelled_prior = ROW_COUNT;

  -- Wipe open tasks for the current period so round-robin can regenerate cleanly.
  UPDATE public.task_manager_tasks
  SET status = 'cancelled', updated_at = now()
  WHERE business_id = p_business_id
    AND status IN ('to_do', 'in_progress', 'incomplete')
    AND (
      (due_schedule_mode = 'weekly_round_robin' AND round_robin_week_start = v_week)
      OR (due_schedule_mode = 'biweekly_round_robin' AND round_robin_week_start = v_biweek)
    );
  GET DIAGNOSTICS v_cancelled_current = ROW_COUNT;

  -- Clear one-off overdue / stuck facility tasks from testing.
  UPDATE public.task_manager_tasks
  SET status = 'cancelled', updated_at = now()
  WHERE business_id = p_business_id
    AND status IN ('to_do', 'in_progress', 'incomplete')
    AND due_schedule_mode IN ('specific_date', 'frequency', 'round_robin', 'daily_required');

  IF p_reset_checklists THEN
    UPDATE public.task_manager_tasks
    SET
      status = 'to_do',
      claimed_by = NULL,
      completed_by = NULL,
      completed_at = NULL,
      review_status = 'not_required',
      manager_review_required = false,
      completion_summary = '{}'::jsonb,
      handoff_notes = NULL,
      handoff_at = NULL,
      handoff_by = NULL,
      handoff_checklist = NULL,
      available_at = now(),
      updated_at = now()
    WHERE business_id = p_business_id
      AND due_schedule_mode = 'kiosk_checklist';
    GET DIAGNOSTICS v_checklists_reset = ROW_COUNT;
  END IF;

  IF p_clear_peer_review_pool THEN
    UPDATE public.task_manager_peer_review_pool
    SET status = 'removed'
    WHERE business_id = p_business_id
      AND status = 'pending';
    GET DIAGNOSTICS v_peer_cleared = ROW_COUNT;
  END IF;

  UPDATE public.task_manager_round_robin_groups
  SET current_week_start = '1900-01-01'::date
  WHERE business_id = p_business_id
    AND reset_cadence IN ('weekly_sunday', 'biweekly_sunday');

  v_regenerated := public.task_manager_reset_weekly_round_robin(p_business_id);

  RETURN jsonb_build_object(
    'success', true,
    'business_id', p_business_id,
    'week_start', v_week,
    'biweek_start', v_biweek,
    'cancelled_prior_period', v_cancelled_prior,
    'cancelled_current_period', v_cancelled_current,
    'checklists_reset', v_checklists_reset,
    'peer_review_pool_cleared', v_peer_cleared,
    'round_robin_groups_regenerated', v_regenerated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.task_manager_admin_fresh_start_queue(uuid, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.task_manager_admin_fresh_start_queue(uuid, boolean, boolean) TO service_role;

COMMENT ON FUNCTION public.task_manager_admin_fresh_start_queue(uuid, boolean, boolean) IS
  'Testing/production recovery: cancel stale round-robin backlog, reset kiosk checklists, optionally clear peer review pool, and regenerate current week/biweek tasks.';
