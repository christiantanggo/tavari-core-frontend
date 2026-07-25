-- Add Yes/No field type for Tavari Forms.

ALTER TABLE public.forms_fields
  DROP CONSTRAINT IF EXISTS forms_fields_field_type_check;

ALTER TABLE public.forms_fields
  ADD CONSTRAINT forms_fields_field_type_check
  CHECK (field_type IN ('number', 'text', 'textarea', 'checkbox', 'select', 'yes_no'));
