-- Ship readiness: helper routine updates, vet follow-ups, sitter share links

ALTER TABLE public.pullpets_vet_visits
  ADD COLUMN IF NOT EXISTS follow_up_date date;

CREATE TABLE IF NOT EXISTS public.pullpets_care_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES public.pullpets_pets(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  label text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pullpets_care_share_links_pet
  ON public.pullpets_care_share_links (pet_id, created_at DESC);

ALTER TABLE public.pullpets_care_share_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pullpets_care_share_links_owner ON public.pullpets_care_share_links;
CREATE POLICY pullpets_care_share_links_owner ON public.pullpets_care_share_links
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.pullpets_is_pet_owner(pet_id))
  WITH CHECK (user_id = auth.uid() AND public.pullpets_is_pet_owner(pet_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pullpets_care_share_links TO authenticated;

DROP POLICY IF EXISTS pullpets_reminders_helper_update ON public.pullpets_reminders;
CREATE POLICY pullpets_reminders_helper_update ON public.pullpets_reminders
  FOR UPDATE TO authenticated
  USING (
    public.pullpets_helper_can_access_pet(pet_id)
    AND reminder_type IN ('grooming', 'custom')
  )
  WITH CHECK (
    public.pullpets_helper_can_access_pet(pet_id)
    AND reminder_type IN ('grooming', 'custom')
  );

CREATE OR REPLACE FUNCTION public.pullpets_get_care_share_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.pullpets_care_share_links%ROWTYPE;
  v_pet public.pullpets_pets%ROWTYPE;
BEGIN
  SELECT * INTO v_link
  FROM public.pullpets_care_share_links
  WHERE token = trim(p_token)
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_pet FROM public.pullpets_pets WHERE id = v_link.pet_id;

  RETURN jsonb_build_object(
    'pet', jsonb_build_object(
      'name', v_pet.name,
      'species', v_pet.species,
      'breed', v_pet.breed,
      'date_of_birth', v_pet.date_of_birth,
      'microchip', v_pet.microchip,
      'notes', v_pet.notes,
      'care_instructions', v_pet.care_instructions
    ),
    'label', v_link.label,
    'expires_at', v_link.expires_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pullpets_get_care_share_by_token(text) TO anon, authenticated;
