-- Complete Daily Inspection Log yes/no checklist (Off The Wall Kids paper form parity).
-- Template: Daily Inspection Log (f820576a-1244-4cd3-9fa4-620a386e4450)

INSERT INTO public.forms_fields (
  form_template_id,
  field_key,
  field_label,
  field_type,
  is_required,
  display_order,
  field_options,
  validation_rules
) VALUES
  (
    'f820576a-1244-4cd3-9fa4-620a386e4450',
    'floor_bases_intact_and_secure_no_movement_or_damage',
    'Floor bases: Intact and secure? No movement, or damage?',
    'yes_no',
    true,
    3,
    '{}'::jsonb,
    '{"correct_answer":"yes","flag_incorrect":true}'::jsonb
  ),
  (
    'f820576a-1244-4cd3-9fa4-620a386e4450',
    'overall_play_area_clean_and_sanitized',
    'Overall play area: Clean and sanitized? Free of vandalism, graffiti, debris, and foreign articles?',
    'yes_no',
    true,
    4,
    '{}'::jsonb,
    '{"correct_answer":"yes","flag_incorrect":true}'::jsonb
  ),
  (
    'f820576a-1244-4cd3-9fa4-620a386e4450',
    'windows_and_domes_free_of_cracks_damage',
    'Windows & domes: Free of cracks / damage?',
    'yes_no',
    true,
    5,
    '{}'::jsonb,
    '{"correct_answer":"yes","flag_incorrect":true}'::jsonb
  ),
  (
    'f820576a-1244-4cd3-9fa4-620a386e4450',
    'safety_surfacing_flooring_secure_and_free_of_damage',
    'Safety surfacing (flooring): secure and free of damage?',
    'yes_no',
    true,
    6,
    '{}'::jsonb,
    '{"correct_answer":"yes","flag_incorrect":true}'::jsonb
  ),
  (
    'f820576a-1244-4cd3-9fa4-620a386e4450',
    'plastic_tubes_free_of_debris_secure_and_free_of_damage',
    'Plastic tubes: free of debris, secure, and free of damage?',
    'yes_no',
    true,
    7,
    '{}'::jsonb,
    '{"correct_answer":"yes","flag_incorrect":true}'::jsonb
  ),
  (
    'f820576a-1244-4cd3-9fa4-620a386e4450',
    'overall_play_area_free_of_sharp_edges_punch_shear_crush_points',
    'Overall play area: Clean and free of sharp edges, punch, shear and crush points?',
    'yes_no',
    true,
    8,
    '{}'::jsonb,
    '{"correct_answer":"yes","flag_incorrect":true}'::jsonb
  ),
  (
    'f820576a-1244-4cd3-9fa4-620a386e4450',
    'moving_components_all_secure_and_free_of_damage',
    'Moving components (Rodeo riders, rope bridge etc.): All secure and free of damage?',
    'yes_no',
    true,
    9,
    '{}'::jsonb,
    '{"correct_answer":"yes","flag_incorrect":true}'::jsonb
  ),
  (
    'f820576a-1244-4cd3-9fa4-620a386e4450',
    'slides_free_of_cracks_warps_gaps_nuts_caps_secure',
    'Slides: Free of cracks, warps, and gaps. All nuts and caps secure, in place and tight?',
    'yes_no',
    true,
    10,
    '{}'::jsonb,
    '{"correct_answer":"yes","flag_incorrect":true}'::jsonb
  ),
  (
    'f820576a-1244-4cd3-9fa4-620a386e4450',
    'electrical_components_no_loose_hardware_outlets_protected',
    'Electrical components: no loose hardware, buttons or wires? Outlets protected?',
    'yes_no',
    true,
    11,
    '{}'::jsonb,
    '{"correct_answer":"yes","flag_incorrect":true}'::jsonb
  ),
  (
    'f820576a-1244-4cd3-9fa4-620a386e4450',
    'zippers_closed_in_good_repair',
    'Zippers: Closed, in good repair?',
    'yes_no',
    true,
    12,
    '{}'::jsonb,
    '{"correct_answer":"yes","flag_incorrect":true}'::jsonb
  ),
  (
    'f820576a-1244-4cd3-9fa4-620a386e4450',
    'steps_intact_with_no_damage_or_gaps',
    'Steps: Intact with no damage or gaps?',
    'yes_no',
    true,
    13,
    '{}'::jsonb,
    '{"correct_answer":"yes","flag_incorrect":true}'::jsonb
  ),
  (
    'f820576a-1244-4cd3-9fa4-620a386e4450',
    'tube_entry_ring_pads_intact_and_secure',
    'Tube entry ring pads: Intact and secure?',
    'yes_no',
    true,
    14,
    '{}'::jsonb,
    '{"correct_answer":"yes","flag_incorrect":true}'::jsonb
  ),
  (
    'f820576a-1244-4cd3-9fa4-620a386e4450',
    'bolts_rivets_and_other_hardware_in_place_and_secure',
    'Bolts, rivets & other hardware: in place and secure, not loose?',
    'yes_no',
    true,
    15,
    '{}'::jsonb,
    '{"correct_answer":"yes","flag_incorrect":true}'::jsonb
  ),
  (
    'f820576a-1244-4cd3-9fa4-620a386e4450',
    'anchoring_supports_in_good_condition',
    'Anchoring supports: in good condition, free of damaged, broken parts?',
    'yes_no',
    true,
    16,
    '{}'::jsonb,
    '{"correct_answer":"yes","flag_incorrect":true}'::jsonb
  )
ON CONFLICT (form_template_id, field_key) DO UPDATE SET
  field_label = EXCLUDED.field_label,
  field_type = EXCLUDED.field_type,
  is_required = EXCLUDED.is_required,
  display_order = EXCLUDED.display_order,
  validation_rules = EXCLUDED.validation_rules;

-- Keep first three items aligned with paper form wording/order.
UPDATE public.forms_fields SET display_order = 0 WHERE form_template_id = 'f820576a-1244-4cd3-9fa4-620a386e4450' AND field_key = 'cap_nuts_secure_and_in_place_on_all_units';
UPDATE public.forms_fields SET display_order = 1 WHERE form_template_id = 'f820576a-1244-4cd3-9fa4-620a386e4450' AND field_key = 'netting_intact_and_free_of_rips_cuts_holes_tears_fastened_and_attached_appropriately';
UPDATE public.forms_fields SET display_order = 2 WHERE form_template_id = 'f820576a-1244-4cd3-9fa4-620a386e4450' AND field_key = 'padding_intact_and_secure_covers_all_accessible_pipe_fastened_and_attached_appropriately';
