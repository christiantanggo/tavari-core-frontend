-- Single-transaction waiver package (signature + participants + consents) for Edge + kiosk.
-- Idempotent on client_submission_id: completed packages return dedup; incomplete orphans are removed and retried.

CREATE OR REPLACE FUNCTION public.waivers_atomic_submit_package(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_w jsonb;
  v_parts jsonb;
  v_consents jsonb;
  v_business uuid;
  v_tpl uuid;
  v_sig_token text;
  v_client uuid;
  v_waiver_id uuid;
  v_business_short text;
  v_short_part text;
  v_pc int := 0;
  v_cc int := 0;
  v_expected_parts int;
  v_expected_consents int;
  part jsonb;
  consent jsonb;
  v_clean jsonb;
  k text;
  v_val jsonb;
  v_updated int;
  v_row waiver_signatures%ROWTYPE;
  v_part_row waiver_participants%ROWTYPE;
  v_consent_row waiver_consents%ROWTYPE;
  v_part_ids uuid[] := '{}'::uuid[];
  v_pid uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'waivers_atomic_submit_package: service role only';
  END IF;

  v_w := p_payload->'waiver';
  v_parts := p_payload->'participants';
  v_consents := p_payload->'consents';

  IF v_w IS NULL OR v_w = 'null'::jsonb THEN
    RAISE EXCEPTION 'missing waiver object';
  END IF;
  IF jsonb_typeof(v_parts) <> 'array' OR jsonb_array_length(v_parts) < 1 THEN
    RAISE EXCEPTION 'participants required';
  END IF;
  IF jsonb_typeof(v_consents) <> 'array' OR jsonb_array_length(v_consents) < 1 THEN
    RAISE EXCEPTION 'consents required';
  END IF;

  v_business := (v_w->>'business_id')::uuid;
  IF v_business IS NULL THEN
    RAISE EXCEPTION 'missing business_id';
  END IF;

  v_tpl := (v_w->>'template_id')::uuid;
  IF v_tpl IS NULL THEN
    RAISE EXCEPTION 'missing template_id';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.waiver_templates t
    WHERE t.id = v_tpl
      AND t.business_id = v_business
  ) THEN
    RAISE EXCEPTION 'template does not belong to business';
  END IF;

  v_sig_token := v_w->>'signature_token';
  IF v_sig_token IS NULL OR length(trim(v_sig_token)) < 12 THEN
    RAISE EXCEPTION 'missing signature_token';
  END IF;

  v_business_short := upper(substring(replace(v_business::text, '-', ''), 1, 8));
  v_short_part := split_part(v_sig_token, '-', 2);
  IF v_short_part IS DISTINCT FROM v_business_short THEN
    RAISE EXCEPTION 'invalid signature_token for business';
  END IF;

  v_client := NULL;
  IF (v_w ? 'client_submission_id')
     AND nullif(trim(v_w->>'client_submission_id'), '') IS NOT NULL THEN
    BEGIN
      v_client := (v_w->>'client_submission_id')::uuid;
    EXCEPTION
      WHEN OTHERS THEN
        v_client := NULL;
    END;
  END IF;

  IF v_client IS NOT NULL THEN
    SELECT ws.id
    INTO v_waiver_id
    FROM public.waiver_signatures ws
    WHERE ws.client_submission_id = v_client
    LIMIT 1;

    IF FOUND THEN
      SELECT count(*)::int
      INTO v_pc
      FROM public.waiver_participants wp
      WHERE wp.waiver_id = v_waiver_id;

      SELECT count(*)::int
      INTO v_cc
      FROM public.waiver_consents wc
      WHERE wc.waiver_id = v_waiver_id;

      IF v_pc > 0 AND v_cc > 0 THEN
        RAISE WARNING '[waivers_atomic_submit_package] dedup waiver_id=%', v_waiver_id;
        RETURN jsonb_build_object(
          'success', true,
          'waiver_id', v_waiver_id::text,
          'dedup', true,
          'participant_count', v_pc,
          'consent_count', v_cc,
          'participant_ids', coalesce(
            (
              SELECT jsonb_agg(wp.id::text ORDER BY wp.is_required DESC NULLS LAST, wp.participant_type, wp.created_at, wp.id)
              FROM public.waiver_participants wp
              WHERE wp.waiver_id = v_waiver_id
            ),
            '[]'::jsonb
          )
        );
      END IF;

      DELETE FROM public.waiver_signatures WHERE id = v_waiver_id;
      v_waiver_id := NULL;
    END IF;
  END IF;

  v_waiver_id := coalesce(
    nullif(trim(coalesce(v_w->>'id', '')), '')::uuid,
    gen_random_uuid()
  );

  v_clean := '{}'::jsonb;
  FOR k, v_val IN SELECT * FROM jsonb_each(v_w) LOOP
    IF v_val IS NULL OR v_val = 'null'::jsonb THEN
      CONTINUE;
    END IF;
    v_clean := v_clean || jsonb_build_object(k, v_val);
  END LOOP;

  v_w := v_clean || jsonb_build_object('id', to_jsonb(v_waiver_id::text));

  SELECT * INTO v_row FROM jsonb_populate_record(null::waiver_signatures, v_w) AS r;
  v_row.created_at := coalesce(v_row.created_at, timezone('utc', now()));
  v_row.updated_at := coalesce(v_row.updated_at, timezone('utc', now()));
  INSERT INTO public.waiver_signatures VALUES (v_row.*);

  v_expected_parts := jsonb_array_length(v_parts);
  v_expected_consents := jsonb_array_length(v_consents);

  FOR part IN SELECT value FROM jsonb_array_elements(v_parts) AS e (value) LOOP
    IF coalesce((part->>'is_account_owner')::boolean, false)
       AND nullif(trim(coalesce(part->>'customer_id', '')), '') IS NOT NULL
       AND nullif(trim(coalesce(part->>'business_id', '')), '') IS NOT NULL THEN

      v_pid := NULL;

      UPDATE public.waiver_participants p
      SET
        waiver_id = v_waiver_id,
        participant_type = coalesce(part->>'participant_type', p.participant_type),
        first_name = coalesce(part->>'first_name', p.first_name),
        last_name = coalesce(part->>'last_name', p.last_name),
        date_of_birth = CASE
          WHEN part ? 'date_of_birth' AND nullif(trim(part->>'date_of_birth'), '') IS NOT NULL
            THEN (part->>'date_of_birth')::date
          ELSE p.date_of_birth
        END,
        phone_number = CASE
          WHEN part ? 'phone_number' THEN part->>'phone_number'
          ELSE p.phone_number
        END,
        email = CASE WHEN part ? 'email' THEN part->>'email' ELSE p.email END,
        address = CASE WHEN part ? 'address' THEN part->>'address' ELSE p.address END,
        city = CASE WHEN part ? 'city' THEN part->>'city' ELSE p.city END,
        postal_code = CASE WHEN part ? 'postal_code' THEN part->>'postal_code' ELSE p.postal_code END,
        relationship_to_minor = CASE
          WHEN part ? 'relationship_to_minor' THEN part->>'relationship_to_minor'
          ELSE p.relationship_to_minor
        END,
        signature_image_url = CASE
          WHEN part ? 'signature_image_url' THEN part->>'signature_image_url'
          ELSE p.signature_image_url
        END,
        signature_data = CASE
          WHEN part ? 'signature_data' THEN part->'signature_data'
          ELSE p.signature_data
        END,
        signed_at = CASE
          WHEN part ? 'signed_at' AND nullif(trim(part->>'signed_at'), '') IS NOT NULL
            THEN (part->>'signed_at')::timestamptz
          ELSE p.signed_at
        END,
        is_required = coalesce((part->>'is_required')::boolean, p.is_required),
        is_active = true,
        updated_at = now()
      WHERE p.customer_id = (part->>'customer_id')::uuid
        AND p.business_id = (part->>'business_id')::uuid
        AND p.is_account_owner IS TRUE
        AND coalesce(p.is_active, true) IS TRUE
      RETURNING p.id INTO v_pid;

      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated > 0 THEN
        IF v_pid IS NOT NULL THEN
          v_part_ids := array_append(v_part_ids, v_pid);
        END IF;
        v_pc := v_pc + 1;
        CONTINUE;
      END IF;
    END IF;

    SELECT *
    INTO v_part_row
    FROM jsonb_populate_record(
      null::waiver_participants,
      (part || jsonb_build_object(
        'waiver_id', to_jsonb(v_waiver_id::text),
        'business_id', to_jsonb(coalesce(nullif(part->>'business_id', ''), v_business::text))
      ))
    ) AS pr;

    v_part_row.id := coalesce(v_part_row.id, gen_random_uuid());
    v_part_row.created_at := coalesce(v_part_row.created_at, timezone('utc', now()));
    v_part_row.updated_at := coalesce(v_part_row.updated_at, timezone('utc', now()));

    INSERT INTO public.waiver_participants VALUES (v_part_row.*)
    RETURNING id INTO v_pid;

    IF v_pid IS NOT NULL THEN
      v_part_ids := array_append(v_part_ids, v_pid);
    END IF;
    v_pc := v_pc + 1;
  END LOOP;

  IF v_pc <> v_expected_parts THEN
    RAISE EXCEPTION 'participant save count mismatch (expected %, got %)', v_expected_parts, v_pc;
  END IF;

  FOR consent IN SELECT value FROM jsonb_array_elements(v_consents) AS c (value) LOOP
    SELECT *
    INTO v_consent_row
    FROM jsonb_populate_record(
      null::waiver_consents,
      (consent || jsonb_build_object('waiver_id', to_jsonb(v_waiver_id::text)))
    ) AS cr;

    v_consent_row.id := coalesce(v_consent_row.id, gen_random_uuid());
    v_consent_row.created_at := coalesce(v_consent_row.created_at, timezone('utc', now()));

    INSERT INTO public.waiver_consents VALUES (v_consent_row.*);
    v_cc := v_cc + 1;
  END LOOP;

  IF v_cc <> v_expected_consents THEN
    RAISE EXCEPTION 'consent save count mismatch (expected %, got %)', v_expected_consents, v_cc;
  END IF;

  RAISE WARNING '[waivers_atomic_submit_package] ok waiver_id=% participants=% consents=%',
    v_waiver_id, v_pc, v_cc;

  RETURN jsonb_build_object(
    'success', true,
    'waiver_id', v_waiver_id::text,
    'dedup', false,
    'participant_count', v_pc,
    'consent_count', v_cc,
    'participant_ids', coalesce(
      (
        SELECT jsonb_agg(x::text ORDER BY ord)
        FROM unnest(v_part_ids) WITH ORDINALITY AS t(x, ord)
      ),
      '[]'::jsonb
    )
  );
END;
$$;

COMMENT ON FUNCTION public.waivers_atomic_submit_package(jsonb) IS
  'Atomic insert: waiver_signatures + waiver_participants + waiver_consents (service_role only). Payload keys: waiver, participants, consents (jsonb arrays).';

REVOKE ALL ON FUNCTION public.waivers_atomic_submit_package(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waivers_atomic_submit_package(jsonb) TO service_role;

-- Staff reconciliation: waivers missing participants or consents (recent window)
CREATE OR REPLACE VIEW public.waivers_reconciliation_incomplete AS
SELECT
  ws.id AS waiver_id,
  ws.business_id,
  ws.signed_at,
  ws.client_submission_id,
  coalesce((
    SELECT count(*)::int
    FROM public.waiver_participants wp
    WHERE wp.waiver_id = ws.id
  ), 0) AS participant_count,
  coalesce((
    SELECT count(*)::int
    FROM public.waiver_consents wc
    WHERE wc.waiver_id = ws.id
  ), 0) AS consent_count
FROM public.waiver_signatures ws
WHERE ws.signed_at >= (timezone('utc', now()) - interval '90 days')
  AND (
    NOT EXISTS (SELECT 1 FROM public.waiver_participants wp WHERE wp.waiver_id = ws.id)
    OR NOT EXISTS (SELECT 1 FROM public.waiver_consents wc WHERE wc.waiver_id = ws.id)
  );

COMMENT ON VIEW public.waivers_reconciliation_incomplete IS
  'Rows where a waiver signature exists but participants or consents are missing (last 90 days, UTC).';

GRANT SELECT ON public.waivers_reconciliation_incomplete TO authenticated;
GRANT SELECT ON public.waivers_reconciliation_incomplete TO service_role;
