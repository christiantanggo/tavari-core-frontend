// Digitize scanned/handwritten camp registration forms via OpenAI vision / text extraction.
// POST body: {
//   business_id,
//   form_text?,
//   images?: [{ image_base64, mime_type }],
// }
// Returns structured camper registration fields matching portal form_data shape.
// Deploy: npx supabase functions deploy camper-registration-extract --no-verify-jwt

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const VISION_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGES = 4;

function corsResponse(body: string | null, status: number) {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  });
}

function asString(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function asBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const s = asString(value).toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === 'checked' || s === '1';
}

function asYesNo(value: unknown): 'yes' | 'no' | null {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  const s = asString(value).toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(s)) return 'yes';
  if (['no', 'n', 'false', '0'].includes(s)) return 'no';
  return null;
}

function normalizeDate(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const mdy = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (mdy) {
    let year = Number(mdy[3]);
    if (year < 100) year += 2000;
    const month = String(Number(mdy[1])).padStart(2, '0');
    const day = String(Number(mdy[2])).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function normalizeCustody(value: unknown): string {
  const s = asString(value).toLowerCase().replace(/[\s\-]+/g, '_');
  if (['parent_guardian_1', 'guardian_1', 'parent1', 'parent_1'].includes(s)) return 'parent_guardian_1';
  if (['parent_guardian_2', 'guardian_2', 'parent2', 'parent_2'].includes(s)) return 'parent_guardian_2';
  if (s === 'both') return 'both';
  if (s === 'joint') return 'joint';
  if (s === 'other' || s.includes('other')) return 'other';
  return s || '';
}

function normalizePhone(value: unknown): string {
  const digits = asString(value).replace(/\D/g, '');
  if (!digits) return '';
  let local = digits;
  if (local.length === 11 && local.startsWith('1')) local = local.slice(1);
  if (local.length === 10) {
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return asString(value);
}

function normalizePostal(value: unknown): string {
  const raw = asString(value).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
  if (!raw) return '';
  if (raw.length <= 3) return raw;
  return `${raw.slice(0, 3)} ${raw.slice(3)}`;
}

type RawExtraction = Record<string, unknown>;

function normalizeExtraction(raw: RawExtraction) {
  const camperInfo = (raw.camper_info && typeof raw.camper_info === 'object' ? raw.camper_info : {}) as Record<string, unknown>;
  const guardians = (raw.guardians && typeof raw.guardians === 'object' ? raw.guardians : {}) as Record<string, unknown>;
  const g1 = (guardians.guardian_1 && typeof guardians.guardian_1 === 'object' ? guardians.guardian_1 : {}) as Record<string, unknown>;
  const g2 = (guardians.guardian_2 && typeof guardians.guardian_2 === 'object' ? guardians.guardian_2 : {}) as Record<string, unknown>;
  const custody = (raw.custody && typeof raw.custody === 'object' ? raw.custody : {}) as Record<string, unknown>;
  const pickup = (raw.authorized_pickup && typeof raw.authorized_pickup === 'object' ? raw.authorized_pickup : {}) as Record<string, unknown>;
  const campAuth = (raw.camp_authorization && typeof raw.camp_authorization === 'object' ? raw.camp_authorization : {}) as Record<string, unknown>;
  const sectionNa = (raw.section_na && typeof raw.section_na === 'object' ? raw.section_na : {}) as Record<string, unknown>;

  const emergencyContacts = Array.isArray(raw.emergency_contacts)
    ? raw.emergency_contacts
        .map((row) => {
          const item = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
          return { name: asString(item.name), phone: normalizePhone(item.phone) };
        })
        .filter((row) => row.name || row.phone)
    : [];

  const allergies = Array.isArray(raw.allergies)
    ? raw.allergies
        .map((row) => {
          const item = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
          return {
            allergen: asString(item.allergen),
            potential_symptoms: asString(item.potential_symptoms),
            other: asString(item.other),
            is_anaphylactic: asYesNo(item.is_anaphylactic),
            has_epipen: asYesNo(item.has_epipen),
          };
        })
        .filter((row) => row.allergen || row.potential_symptoms || row.other)
    : [];

  const medications = Array.isArray(raw.medications)
    ? raw.medications
        .map((row) => {
          const item = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
          return {
            name: asString(item.name),
            dosage_instructions: asString(item.dosage_instructions),
            time_to_dispense: asString(item.time_to_dispense),
            refrigeration: asYesNo(item.refrigeration),
          };
        })
        .filter((row) => row.name)
    : [];

  const firstName = asString(raw.first_name || camperInfo.first_name);
  const lastName = asString(raw.last_name || camperInfo.last_name);
  const medicalNeeds = asString(raw.medical_needs);

  const formData = {
    camper_info: {
      address: asString(camperInfo.address),
      city: asString(camperInfo.city),
      postal_code: normalizePostal(camperInfo.postal_code),
      home_phone: normalizePhone(camperInfo.home_phone),
      age_at_camp: asString(camperInfo.age_at_camp),
    },
    guardians: {
      guardian_1: {
        name: asString(g1.name),
        primary_phone: normalizePhone(g1.primary_phone),
        secondary_phone: normalizePhone(g1.secondary_phone),
        email: asString(g1.email).toLowerCase(),
      },
      guardian_2: {
        name: asString(g2.name),
        primary_phone: normalizePhone(g2.primary_phone),
        secondary_phone: normalizePhone(g2.secondary_phone),
        email: asString(g2.email).toLowerCase(),
      },
    },
    custody: {
      type: normalizeCustody(custody.type),
      other_detail: asString(custody.other_detail),
    },
    emergency_contacts: emergencyContacts,
    authorized_pickup: {
      parent_guardians: asBool(pickup.parent_guardians),
      emergency_contacts: asBool(pickup.emergency_contacts),
      other_detail: asString(pickup.other_detail),
    },
    medical_needs: medicalNeeds,
    allergies,
    allergy_med_authorization_acknowledged: asBool(raw.allergy_med_authorization_acknowledged),
    medications,
    camp_authorization: {
      camp_acknowledged: asBool(campAuth.camp_acknowledged),
      medical_acknowledged: asBool(campAuth.medical_acknowledged),
      off_premises_acknowledged: asBool(campAuth.off_premises_acknowledged),
    },
    custom_fields: raw.custom_fields && typeof raw.custom_fields === 'object' ? raw.custom_fields : {},
    section_na: {
      guardian_2: asBool(sectionNa.guardian_2) || (!asString(g2.name) && !asString(g2.primary_phone)),
      emergency_contacts: asBool(sectionNa.emergency_contacts) || emergencyContacts.length === 0,
      medical_information: asBool(sectionNa.medical_information) || !medicalNeeds,
      allergies: asBool(sectionNa.allergies) || allergies.length === 0,
      medications: asBool(sectionNa.medications) || medications.length === 0,
    },
    signed_at: normalizeDate(raw.signed_at) || null,
    ocr: {
      digitized: true,
      confidence: typeof raw.confidence === 'number' ? raw.confidence : null,
      warnings: Array.isArray(raw.warnings) ? raw.warnings.map((w) => asString(w)).filter(Boolean) : [],
      extracted_at: new Date().toISOString(),
    },
  };

  const authorizedPickups: Array<{ name: string; relationship: string; source: string }> = [];
  if (formData.authorized_pickup.parent_guardians) {
    if (formData.guardians.guardian_1.name) {
      authorizedPickups.push({
        name: formData.guardians.guardian_1.name,
        relationship: 'Parent/Guardian 1',
        source: 'parent_guardians',
      });
    }
    if (formData.guardians.guardian_2.name) {
      authorizedPickups.push({
        name: formData.guardians.guardian_2.name,
        relationship: 'Parent/Guardian 2',
        source: 'parent_guardians',
      });
    }
  }
  if (formData.authorized_pickup.emergency_contacts) {
    formData.emergency_contacts.forEach((c) => {
      if (c.name) {
        authorizedPickups.push({ name: c.name, relationship: 'Emergency contact', source: 'emergency_contacts' });
      }
    });
  }
  if (formData.authorized_pickup.other_detail) {
    authorizedPickups.push({
      name: formData.authorized_pickup.other_detail,
      relationship: 'Other',
      source: 'other',
    });
  }

  const medicalSummary = {
    medical_needs: formData.medical_needs,
    allergies: formData.allergies,
    medications: formData.medications,
    has_alerts:
      !!formData.medical_needs || formData.allergies.length > 0 || formData.medications.length > 0,
  };

  return {
    first_name: firstName,
    last_name: lastName,
    date_of_birth: normalizeDate(raw.date_of_birth || camperInfo.date_of_birth),
    signed_by_name: asString(raw.signed_by_name),
    signed_by_relationship: asString(raw.signed_by_relationship) || 'Parent/Guardian',
    signed_at: formData.signed_at,
    form_data: formData,
    authorized_pickups: authorizedPickups,
    medical_summary: medicalSummary,
    warnings: formData.ocr.warnings,
    confidence: formData.ocr.confidence,
  };
}

serve(async (req: Request) => {
  try {
    if (req.method === 'OPTIONS') return corsResponse(null, 204);
    if (req.method !== 'POST') return corsResponse(JSON.stringify({ error: 'Method not allowed' }), 405);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return corsResponse(JSON.stringify({ error: 'Unauthorized' }), 401);

    const body = (await req.json().catch(() => ({}))) as {
      business_id?: string;
      form_text?: string;
      images?: Array<{ image_base64?: string; mime_type?: string }>;
    };

    const businessId = asString(body.business_id);
    const formText = asString(body.form_text);
    const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];

    if (!businessId) return corsResponse(JSON.stringify({ error: 'Missing business_id' }), 400);
    if (!formText && images.length === 0) {
      return corsResponse(JSON.stringify({ error: 'Provide form_text or images' }), 400);
    }

    for (const image of images) {
      const mime = asString(image.mime_type || 'image/jpeg').toLowerCase().split(';')[0];
      if (!VISION_MIME_TYPES.has(mime)) {
        return corsResponse(
          JSON.stringify({ error: `Unsupported image type "${mime}". Use jpeg/png/webp.` }),
          400
        );
      }
      if (!asString(image.image_base64)) {
        return corsResponse(JSON.stringify({ error: 'Each image requires image_base64' }), 400);
      }
    }

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) return corsResponse(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), 500);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const isServiceRoleCall = serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`;

    if (!isServiceRoleCall) {
      const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user },
      } = await supabaseUser.auth.getUser();
      if (!user?.id) return corsResponse(JSON.stringify({ error: 'Unauthorized' }), 401);

      const { data: membership } = await supabaseUser
        .from('business_users')
        .select('user_id')
        .eq('business_id', businessId)
        .eq('user_id', user.id)
        .in('role', ['owner', 'manager', 'admin'])
        .maybeSingle();

      if (!membership) {
        const { data: role } = await supabaseUser
          .from('user_roles')
          .select('user_id')
          .eq('business_id', businessId)
          .eq('user_id', user.id)
          .eq('active', true)
          .in('role', ['owner', 'manager', 'admin'])
          .maybeSingle();
        if (!role) return corsResponse(JSON.stringify({ error: 'Access denied to this business' }), 403);
      }
    }

    const systemPrompt = `You digitize a handwritten or filled Camp Registration & Medical Form into structured JSON.
Return ONLY valid JSON with these keys (use empty string, empty array, false, or null when unknown — never invent medical facts):
- first_name, last_name: camper name
- date_of_birth: YYYY-MM-DD or null
- signed_by_name: parent/guardian printed name who signed
- signed_by_relationship: relationship if present
- signed_at: date signed YYYY-MM-DD or null
- camper_info: { address, city, postal_code, home_phone, age_at_camp }
- guardians: { guardian_1: { name, primary_phone, secondary_phone, email }, guardian_2: { name, primary_phone, secondary_phone, email } }
- custody: { type: one of parent_guardian_1|parent_guardian_2|both|joint|other, other_detail }
- emergency_contacts: [{ name, phone }]
- authorized_pickup: { parent_guardians: boolean, emergency_contacts: boolean, other_detail: string }
- medical_needs: string
- allergies: [{ allergen, potential_symptoms, other, is_anaphylactic: "yes"|"no"|null, has_epipen: "yes"|"no"|null }]
- allergy_med_authorization_acknowledged: boolean
- medications: [{ name, dosage_instructions, time_to_dispense, refrigeration: "yes"|"no"|null }]
- camp_authorization: { camp_acknowledged: boolean, medical_acknowledged: boolean, off_premises_acknowledged: boolean }
- section_na: { guardian_2, emergency_contacts, medical_information, allergies, medications } booleans when marked N/A or blank intentionally
- confidence: number 0-1 estimating overall extraction confidence
- warnings: string[] describing uncertain/illegible fields

Rules:
- Prefer what is written on the form over assumptions.
- Checkmarks/X in boxes mean true/yes.
- Canadian postal codes should keep letter-number pattern.
- Phones may be formatted or raw digits.
- If a section is marked N/A, set the matching section_na flag true and leave related arrays empty.`;

    const userContent: Array<
      { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
    > = [
      {
        type: 'text',
        text:
          'Extract every filled field from this camp registration / medical form. ' +
          (formText
            ? `Also use this extracted text if helpful:\n${formText.slice(0, 20000)}`
            : 'Read the handwritten and checked values carefully.'),
      },
    ];

    for (const image of images) {
      const mime = asString(image.mime_type || 'image/jpeg').toLowerCase().split(';')[0];
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${asString(image.image_base64)}` },
      });
    }

    const model = images.length > 0 ? 'gpt-4o' : 'gpt-4o-mini';
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_tokens: 3500,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[camper-registration-extract] OpenAI failed', res.status, err.slice(0, 400));
      return corsResponse(
        JSON.stringify({ error: 'OCR extraction failed: ' + (res.statusText || err.slice(0, 200)) }),
        502
      );
    }

    const completion = await res.json();
    const content = completion?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      return corsResponse(JSON.stringify({ error: 'OCR returned empty response' }), 502);
    }

    let parsed: RawExtraction;
    try {
      parsed = JSON.parse(content) as RawExtraction;
    } catch {
      return corsResponse(JSON.stringify({ error: 'OCR returned invalid JSON' }), 502);
    }

    const normalized = normalizeExtraction(parsed);
    return corsResponse(JSON.stringify({ ok: true, ...normalized }), 200);
  } catch (error) {
    console.error('[camper-registration-extract]', error);
    return corsResponse(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unexpected OCR error' }),
      500
    );
  }
});
