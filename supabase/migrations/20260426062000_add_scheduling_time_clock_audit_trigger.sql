CREATE OR REPLACE FUNCTION public.audit_scheduling_time_clock_update()
RETURNS trigger
AS $$
DECLARE
  v_changed_by uuid;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  IF OLD.clock_in_time IS DISTINCT FROM NEW.clock_in_time THEN
    v_changes := v_changes || jsonb_build_object(
      'clock_in_time',
      jsonb_build_object('from', OLD.clock_in_time, 'to', NEW.clock_in_time)
    );
  END IF;

  IF OLD.clock_out_time IS DISTINCT FROM NEW.clock_out_time THEN
    v_changes := v_changes || jsonb_build_object(
      'clock_out_time',
      jsonb_build_object('from', OLD.clock_out_time, 'to', NEW.clock_out_time)
    );
  END IF;

  IF COALESCE(OLD.notes, '') IS DISTINCT FROM COALESCE(NEW.notes, '') THEN
    v_changes := v_changes || jsonb_build_object(
      'notes',
      jsonb_build_object('from', OLD.notes, 'to', NEW.notes)
    );
  END IF;

  IF v_changes = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  SELECT id
    INTO v_changed_by
  FROM public.users
  WHERE id = auth.uid();

  IF v_changed_by IS NULL AND NEW.adjusted_by IS NOT NULL THEN
    SELECT id
      INTO v_changed_by
    FROM public.users
    WHERE id = NEW.adjusted_by;
  END IF;

  IF v_changed_by IS NULL THEN
    v_changed_by := NEW.employee_id;
  END IF;

  INSERT INTO public.scheduling_time_clocks_audit (
    time_clock_id,
    changed_by,
    changes,
    reason
  ) VALUES (
    NEW.id,
    v_changed_by,
    v_changes,
    COALESCE(NEW.adjustment_reason, 'Timecard edited')
  );

  RETURN NEW;
END;
$$
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

DROP TRIGGER IF EXISTS trg_audit_scheduling_time_clock_update ON public.scheduling_time_clocks;

CREATE TRIGGER trg_audit_scheduling_time_clock_update
AFTER UPDATE OF clock_in_time, clock_out_time, notes ON public.scheduling_time_clocks
FOR EACH ROW
EXECUTE FUNCTION public.audit_scheduling_time_clock_update();
