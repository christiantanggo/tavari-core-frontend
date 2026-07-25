-- Lock waiver template legal content once the first signature exists.
-- Signed waiver rows keep their original template_id, so future edits must create
-- a new waiver_templates row/version rather than mutating the signed snapshot.

CREATE OR REPLACE FUNCTION public.waivers_template_has_signatures(template_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.waiver_signatures ws
    WHERE ws.template_id = template_uuid
    LIMIT 1
  );
$$;

CREATE OR REPLACE FUNCTION public.waivers_user_can_manage_templates(target_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.user_id = auth.uid()
      AND bu.business_id = target_business_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.active = true
      AND ur.business_id = target_business_id
  );
$$;

CREATE OR REPLACE FUNCTION public.waiver_templates_enforce_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.waivers_template_has_signatures(OLD.id) THEN
      RAISE EXCEPTION 'Cannot delete a waiver template after it has signed waivers. Deactivate it and create a new version instead.'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND public.waivers_template_has_signatures(OLD.id) THEN
    IF OLD.business_id IS DISTINCT FROM NEW.business_id
      OR OLD.template_name IS DISTINCT FROM NEW.template_name
      OR OLD.template_key IS DISTINCT FROM NEW.template_key
      OR OLD.waiver_title IS DISTINCT FROM NEW.waiver_title
      OR OLD.waiver_content IS DISTINCT FROM NEW.waiver_content
      OR OLD.version IS DISTINCT FROM NEW.version
      OR OLD.requires_digital_signature IS DISTINCT FROM NEW.requires_digital_signature
      OR OLD.requires_guardian_signature IS DISTINCT FROM NEW.requires_guardian_signature
      OR OLD.minor_age_threshold IS DISTINCT FROM NEW.minor_age_threshold
      OR OLD.fields_config IS DISTINCT FROM NEW.fields_config
      OR OLD.signature_config IS DISTINCT FROM NEW.signature_config
      OR OLD.expiry_days IS DISTINCT FROM NEW.expiry_days
      OR OLD.created_by IS DISTINCT FROM NEW.created_by
      OR OLD.created_at IS DISTINCT FROM NEW.created_at
    THEN
      RAISE EXCEPTION 'Cannot change legal waiver template fields after the first signature. Create a new version instead.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_waiver_templates_enforce_immutability ON public.waiver_templates;
CREATE TRIGGER tr_waiver_templates_enforce_immutability
  BEFORE UPDATE OR DELETE ON public.waiver_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.waiver_templates_enforce_immutability();

CREATE OR REPLACE FUNCTION public.waivers_create_template_version(
  source_template_id uuid,
  new_template_name text DEFAULT NULL,
  new_waiver_title text DEFAULT NULL,
  new_waiver_content text DEFAULT NULL,
  new_requires_digital_signature boolean DEFAULT NULL,
  new_requires_guardian_signature boolean DEFAULT NULL,
  new_minor_age_threshold integer DEFAULT NULL,
  new_fields_config jsonb DEFAULT NULL,
  new_signature_config jsonb DEFAULT NULL,
  new_expiry_days integer DEFAULT NULL,
  changes_summary text DEFAULT NULL
)
RETURNS public.waiver_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  source_row public.waiver_templates%ROWTYPE;
  inserted_row public.waiver_templates%ROWTYPE;
  next_version integer;
BEGIN
  SELECT *
  INTO source_row
  FROM public.waiver_templates
  WHERE id = source_template_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source waiver template not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.waivers_user_can_manage_templates(source_row.business_id) THEN
    RAISE EXCEPTION 'Not authorized to create waiver template versions for this business'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.waivers_template_has_signatures(source_row.id) THEN
    RAISE EXCEPTION 'This waiver template has not been signed yet and can still be edited directly'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1
  INTO next_version
  FROM public.waiver_templates
  WHERE business_id = source_row.business_id
    AND template_key = source_row.template_key;

  UPDATE public.waiver_templates
  SET is_active = false,
      updated_at = now()
  WHERE business_id = source_row.business_id
    AND template_key = source_row.template_key
    AND is_active = true;

  INSERT INTO public.waiver_templates (
    business_id,
    template_name,
    template_key,
    waiver_title,
    waiver_content,
    version,
    is_active,
    requires_digital_signature,
    requires_guardian_signature,
    minor_age_threshold,
    fields_config,
    signature_config,
    expiry_days,
    created_by
  )
  VALUES (
    source_row.business_id,
    COALESCE(NULLIF(new_template_name, ''), source_row.template_name),
    source_row.template_key,
    COALESCE(NULLIF(new_waiver_title, ''), source_row.waiver_title),
    COALESCE(new_waiver_content, source_row.waiver_content),
    next_version,
    true,
    COALESCE(new_requires_digital_signature, source_row.requires_digital_signature),
    COALESCE(new_requires_guardian_signature, source_row.requires_guardian_signature),
    COALESCE(new_minor_age_threshold, source_row.minor_age_threshold),
    COALESCE(new_fields_config, source_row.fields_config),
    COALESCE(new_signature_config, source_row.signature_config),
    COALESCE(new_expiry_days, source_row.expiry_days),
    auth.uid()
  )
  RETURNING *
  INTO inserted_row;

  RETURN inserted_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.waivers_template_has_signatures(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.waivers_user_can_manage_templates(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.waivers_create_template_version(
  uuid,
  text,
  text,
  text,
  boolean,
  boolean,
  integer,
  jsonb,
  jsonb,
  integer,
  text
) TO authenticated;

COMMENT ON FUNCTION public.waivers_template_has_signatures(uuid) IS
  'Returns true once a waiver template has any signed waiver rows and is legally immutable.';

COMMENT ON FUNCTION public.waivers_create_template_version(
  uuid,
  text,
  text,
  text,
  boolean,
  boolean,
  integer,
  jsonb,
  jsonb,
  integer,
  text
) IS
  'Creates the next active waiver template version without mutating the signed source template.';
