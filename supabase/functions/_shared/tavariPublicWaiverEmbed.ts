/** Public waiver embed config + website signing for external sites (OTWK). */

import { normalizePhone } from "./customerAppSession.ts";

export type WaiverTemplateRow = {
  id: string;
  template_key: string | null;
  template_name: string | null;
  waiver_title: string | null;
  waiver_content: string | null;
  fields_config: unknown;
  requires_digital_signature: boolean | null;
  expiry_days: number | null;
  minor_age_threshold: number | null;
  version: number | null;
  is_active: boolean | null;
};

export type PublicWaiverField = {
  key: string;
  label: string;
  type: "text" | "email" | "phone" | "date" | "address";
  required: boolean;
  participantTypes: Array<"primary" | "minor" | "additional_adult">;
};

export type PublicWaiverConsent = {
  type: string;
  label: string;
  required: boolean;
  defaultChecked?: boolean;
};

export type PublicWaiverEmbedConfig = {
  ok: true;
  businessId: string;
  businessName: string;
  branding: {
    name: string;
    logoUrl: string | null;
    faviconUrl: string | null;
  };
  template: {
    id: string;
    templateKey: string;
    version: number | null;
    title: string;
    contentHtml: string;
    requiresDigitalSignature: boolean;
    minorAgeThreshold: number | null;
    expiryDays: number | null;
  };
  fields: PublicWaiverField[];
  consents: PublicWaiverConsent[];
  participantTypes: Array<"primary" | "minor" | "additional_adult">;
  submit: {
    method: "POST";
    url: string;
    actions: {
      sendOtp: string;
      verifyOtp: string;
      submit: string;
    };
  };
  embed: {
    recommendedMode: "native";
    signingUrl: string;
    websiteOrigin: string | null;
  };
};

const FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  dateOfBirth: "Date of birth",
  phoneNumber: "Mobile phone",
  emailAddress: "Email",
  address: "Street address",
  city: "City",
  postalCode: "Postal code",
};

const CONSENT_LABELS: Record<string, string> = {
  waiver_terms: "I have read and agree to the waiver terms above",
  electronic_signature: "I agree to sign electronically",
  marketing: "Send me occasional promotions and updates by email",
  photography: "I consent to photography and promotional use of images",
};

const CONSENT_TYPES = [
  "waiver_terms",
  "electronic_signature",
  "marketing",
  "photography",
  "additional_adult_intent",
] as const;

type ParticipantInput = {
  type?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string | null;
  email?: string | null;
  phone?: string | null;
  signatureBase64?: string | null;
};

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

function coerceNumericSetting(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const n = parseInt(raw.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (typeof raw === "object" && raw !== null) {
    const o = raw as Record<string, unknown>;
    if ("value" in o) return coerceNumericSetting(o.value);
    if ("days" in o) return coerceNumericSetting(o.days);
  }
  return null;
}

function latestTemplatesByKey(templates: WaiverTemplateRow[]): WaiverTemplateRow[] {
  const seen = new Set<string>();
  const latest: WaiverTemplateRow[] = [];
  for (const template of templates) {
    const key = template.template_key || template.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    latest.push(template);
  }
  return latest;
}

function buildStationTemplateOptions(
  templates: WaiverTemplateRow[],
  settings: Record<string, unknown>,
) {
  const configured = Array.isArray(settings.waiver_station_templates)
    ? settings.waiver_station_templates as Array<Record<string, unknown>>
    : [];

  return configured
    .map((item) => {
      const match = templates.find((template) =>
        (item?.templateId && template.id === item.templateId) ||
        (item?.templateKey && template.template_key === item.templateKey)
      );
      if (!match) return null;
      const displayName =
        String(item?.displayName || "").trim() ||
        String(match.waiver_title || "").trim() ||
        String(match.template_name || "").trim() ||
        String(match.template_key || "").trim();
      return { templateId: match.id, templateKey: match.template_key, displayName, template: match };
    })
    .filter(Boolean);
}

export function resolveDefaultWaiverTemplate(
  templates: WaiverTemplateRow[],
  settings: Record<string, unknown>,
  templateKeyHint?: string,
): WaiverTemplateRow | null {
  const latestTemplates = latestTemplatesByKey(templates);
  const stationMode = settings.waiver_station_mode === "multi" ? "multi" : "single";
  const stationTemplateOptions = buildStationTemplateOptions(latestTemplates, settings);
  const defaultTemplateKey = String(settings.waiver_station_default_template_key || "").trim();
  const hint = String(templateKeyHint || "").trim();

  if (hint) {
    const byHint = latestTemplates.find((item) => item.template_key === hint);
    if (byHint) return byHint;
  }

  return (
    (stationMode === "multi" && stationTemplateOptions.length === 1
      ? stationTemplateOptions[0]?.template
      : null) ||
    latestTemplates.find((item) => item.template_key === defaultTemplateKey) ||
    stationTemplateOptions[0]?.template ||
    latestTemplates[0] ||
    null
  );
}

export async function loadWaiverSettingsMap(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("waiver_settings")
    .select("setting_key, setting_value")
    .eq("business_id", businessId)
    .is("template_id", null)
    .eq("is_global", true);

  if (error) throw new Error(error.message);

  const settings: Record<string, unknown> = {};
  for (const row of data || []) {
    const key = String((row as { setting_key?: string }).setting_key || "");
    if (!key) continue;
    let val = (row as { setting_value?: unknown }).setting_value;
    if (["default_expiry_days", "minor_age_threshold", "expiry_warning_days"].includes(key)) {
      val = coerceNumericSetting(val) ?? val;
    }
    settings[key] = val;
  }
  return settings;
}

function fieldTypeForKey(key: string): PublicWaiverField["type"] {
  if (key === "emailAddress") return "email";
  if (key === "phoneNumber") return "phone";
  if (key === "dateOfBirth") return "date";
  if (key === "address" || key === "city" || key === "postalCode") return "address";
  return "text";
}

function isFieldEnabled(
  key: string,
  templateFields: Record<string, unknown>,
  settingsFields: Record<string, unknown>,
): boolean {
  const templateParticipantFields = parseJsonObject(templateFields).participantFields as Record<string, unknown>;
  const settingsParticipantFields = parseJsonObject(settingsFields).participantFields as Record<string, unknown>;
  const merged = { ...templateParticipantFields, ...settingsParticipantFields };

  if (key === "firstName" || key === "lastName") return merged[key] !== false;
  if (Object.prototype.hasOwnProperty.call(merged, key)) return !!merged[key];

  if (key === "phoneNumber" || key === "emailAddress") return true;
  if (key === "dateOfBirth") return true;
  return false;
}

export function mapParticipantFieldsForEmbed(
  template: WaiverTemplateRow,
  settings: Record<string, unknown>,
): PublicWaiverField[] {
  const templateCfg = parseJsonObject(template.fields_config);
  const settingsCfg = parseJsonObject(settings.participant_fields_config);
  const keys = [
    "firstName",
    "lastName",
    "dateOfBirth",
    "phoneNumber",
    "emailAddress",
    "address",
    "city",
    "postalCode",
  ];

  const fields: PublicWaiverField[] = [];
  for (const key of keys) {
    if (!isFieldEnabled(key, templateCfg, settingsCfg)) continue;
    fields.push({
      key,
      label: FIELD_LABELS[key] || key,
      type: fieldTypeForKey(key),
      required: key === "firstName" || key === "lastName" ||
        (key === "dateOfBirth" && settings.require_date_of_birth === true),
      participantTypes: ["primary"],
    });
  }

  fields.push({
    key: "minorFirstName",
    label: "Child first name",
    type: "text",
    required: true,
    participantTypes: ["minor"],
  });
  fields.push({
    key: "minorLastName",
    label: "Child last name",
    type: "text",
    required: true,
    participantTypes: ["minor"],
  });
  fields.push({
    key: "minorDateOfBirth",
    label: "Child date of birth",
    type: "date",
    required: true,
    participantTypes: ["minor"],
  });

  return fields;
}

export function mapConsentsForEmbed(settings: Record<string, unknown>): PublicWaiverConsent[] {
  const requirePhoto = settings.require_photography_consent === true;
  const autoMarketing = settings.auto_click_marketing !== false;

  const consents: PublicWaiverConsent[] = [
    {
      type: "waiver_terms",
      label: CONSENT_LABELS.waiver_terms,
      required: true,
    },
    {
      type: "electronic_signature",
      label: CONSENT_LABELS.electronic_signature,
      required: true,
    },
    {
      type: "marketing",
      label: CONSENT_LABELS.marketing,
      required: false,
      defaultChecked: autoMarketing,
    },
  ];

  if (requirePhoto) {
    consents.push({
      type: "photography",
      label: CONSENT_LABELS.photography,
      required: true,
      defaultChecked: false,
    });
  } else {
    consents.push({
      type: "photography",
      label: CONSENT_LABELS.photography,
      required: false,
      defaultChecked: false,
    });
  }

  return consents;
}

export async function loadPublicWaiverEmbedConfig(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  options: {
    templateKey?: string;
    supabaseUrl?: string;
    websiteOrigin?: string | null;
  } = {},
): Promise<PublicWaiverEmbedConfig> {
  const { data: business, error: bizErr } = await supabase
    .from("businesses")
    .select("id, name")
    .eq("id", businessId)
    .maybeSingle();

  if (bizErr) throw new Error(bizErr.message);
  if (!business) throw new Error("Business not found");

  const { data: branding } = await supabase
    .from("app_branding")
    .select("logo_url, favicon_url")
    .eq("business_id", businessId)
    .maybeSingle();

  const { data: templates, error: tplErr } = await supabase
    .from("waiver_templates")
    .select(
      "id, template_key, template_name, waiver_title, waiver_content, fields_config, requires_digital_signature, expiry_days, minor_age_threshold, version, is_active",
    )
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("version", { ascending: false });

  if (tplErr) throw new Error(tplErr.message);

  const settings = await loadWaiverSettingsMap(supabase, businessId);
  const resolved = resolveDefaultWaiverTemplate(
    (templates || []) as WaiverTemplateRow[],
    settings,
    options.templateKey,
  );

  if (!resolved?.id) throw new Error("No active waiver template found");

  const supabaseUrl = (options.supabaseUrl || Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const fnUrl = `${supabaseUrl}/functions/v1/tavari-api-waiver-embed`;
  const templateKey = String(resolved.template_key || resolved.id).trim();
  const businessName = String(business.name || "Off The Wall Kids").trim();

  return {
    ok: true,
    businessId,
    businessName,
    branding: {
      name: businessName,
      logoUrl: typeof branding?.logo_url === "string" ? branding.logo_url.trim() || null : null,
      faviconUrl: typeof branding?.favicon_url === "string" ? branding.favicon_url.trim() || null : null,
    },
    template: {
      id: resolved.id,
      templateKey,
      version: resolved.version,
      title: String(resolved.waiver_title || resolved.template_name || "Digital Waiver").trim(),
      contentHtml: String(resolved.waiver_content || "").trim(),
      requiresDigitalSignature: resolved.requires_digital_signature !== false,
      minorAgeThreshold: coerceNumericSetting(resolved.minor_age_threshold) ??
        coerceNumericSetting(settings.minor_age_threshold),
      expiryDays: coerceNumericSetting(resolved.expiry_days) ??
        coerceNumericSetting(settings.default_expiry_days) ??
        365,
    },
    fields: mapParticipantFieldsForEmbed(resolved, settings),
    consents: mapConsentsForEmbed(settings),
    participantTypes: ["primary", "minor"],
    submit: {
      method: "POST",
      url: fnUrl,
      actions: {
        sendOtp: "sendOtp",
        verifyOtp: "verifyOtp",
        submit: "submit",
      },
    },
    embed: {
      recommendedMode: "native",
      signingUrl: fnUrl,
      websiteOrigin: options.websiteOrigin || null,
    },
  };
}

async function loadExpiryDays(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  templateId: string,
): Promise<number> {
  const settings = await loadWaiverSettingsMap(supabase, businessId);
  const fromSettings = coerceNumericSetting(settings.default_expiry_days);
  if (fromSettings) return fromSettings;

  const { data: template } = await supabase
    .from("waiver_templates")
    .select("expiry_days")
    .eq("id", templateId)
    .maybeSingle();

  return coerceNumericSetting(template?.expiry_days) || 365;
}

async function uploadSignaturePng(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  waiverId: string,
  signatureBase64: string,
  suffix = "",
): Promise<string | null> {
  const raw = signatureBase64.replace(/^data:image\/png;base64,/, "");
  const binary = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  const filePath = `signatures/${businessId}/${waiverId}${suffix}-${Date.now()}.png`;

  const { error } = await supabase.storage.from("waiver-signatures").upload(filePath, binary, {
    contentType: "image/png",
    upsert: false,
  });

  if (error) {
    console.warn("[tavariPublicWaiverEmbed] signature upload failed:", error.message);
    return null;
  }

  const { data } = supabase.storage.from("waiver-signatures").getPublicUrl(filePath);
  return data?.publicUrl || null;
}

function buildConsentRows(
  waiverId: string,
  acknowledgedAt: string,
  consentStates: Record<string, boolean>,
): Array<Record<string, unknown>> {
  const merged = {
    waiver_terms: true,
    electronic_signature: true,
    ...consentStates,
  };

  const rows: Array<Record<string, unknown>> = [];
  for (const consentType of CONSENT_TYPES) {
    if (!Object.prototype.hasOwnProperty.call(merged, consentType)) continue;
    if (consentType === "additional_adult_intent") continue;
    rows.push({
      waiver_id: waiverId,
      consent_type: consentType,
      consent_given: !!merged[consentType],
      acknowledged_at: acknowledgedAt,
    });
  }
  return rows;
}

export async function submitPublicWaiverEmbed(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  input: {
    businessId: string;
    templateId: string;
    phone: string;
    email: string;
    signatureBase64: string;
    participants: ParticipantInput[];
    consentStates?: Record<string, boolean>;
    marketingOptIn?: boolean;
  },
): Promise<{ waiverId: string; dedup?: boolean }> {
  const {
    businessId,
    templateId,
    phone,
    email,
    signatureBase64,
    participants,
    consentStates = {},
    marketingOptIn = false,
  } = input;

  if (!signatureBase64.startsWith("data:image")) {
    throw new Error("signatureBase64 PNG data URL required");
  }

  const primary = participants.find((p) => p.type === "primary") || participants[0];
  if (!primary?.firstName?.trim() || !primary?.lastName?.trim()) {
    throw new Error("Primary signer name is required");
  }

  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = String(email || primary.email || "").trim().toLowerCase();

  const { data: customerRows, error: customerError } = await supabase.rpc(
    "bookings_create_or_get_portal_customer",
    {
      p_business_id: businessId,
      p_phone_number: normalizedPhone,
      p_email: normalizedEmail,
      p_first_name: primary.firstName.trim(),
      p_last_name: primary.lastName.trim(),
      p_city: primary.dateOfBirth ? null : null,
    },
  );

  if (customerError) throw new Error(customerError.message);
  const customer = Array.isArray(customerRows) ? customerRows[0] : customerRows;
  const customerId = String(customer?.id || "");
  if (!customerId) throw new Error("Could not create customer account");

  const { data: signatureToken, error: tokenError } = await supabase.rpc(
    "waivers_create_signature_token",
    { business_uuid: businessId },
  );
  if (tokenError) throw new Error(tokenError.message);

  const waiverId = crypto.randomUUID();
  const signedAt = new Date();
  const signedAtIso = signedAt.toISOString();
  const expiryDays = await loadExpiryDays(supabase, businessId, templateId);
  const expiresAt = new Date(signedAt.getTime() + expiryDays * 86400000).toISOString();
  const primarySignatureUrl = await uploadSignaturePng(
    supabase,
    businessId,
    waiverId,
    signatureBase64,
    "-primary",
  );

  const waiverRow: Record<string, unknown> = {
    id: waiverId,
    client_submission_id: waiverId,
    business_id: businessId,
    template_id: templateId,
    signature_token: signatureToken,
    first_name: primary.firstName.trim(),
    last_name: primary.lastName.trim(),
    date_of_birth: primary.dateOfBirth || null,
    phone_number: normalizedPhone.length >= 10 ? normalizedPhone : null,
    email: normalizedEmail || null,
    signature_image_url: primarySignatureUrl,
    signature_data: { imageUrl: signatureBase64 },
    customer_id: customerId,
    is_minor: false,
    is_valid: true,
    signed_at: signedAtIso,
    expires_at: expiresAt,
    ip_address: null,
    user_agent: "otwk-website-embed",
    additional_adult_intent_acknowledgments: null,
  };

  const participantRows: Array<Record<string, unknown>> = [];
  const rowsToInsert = participants.filter((p) => p.firstName?.trim() && p.lastName?.trim());
  if (rowsToInsert.length === 0) {
    rowsToInsert.push({ ...primary, type: "primary" });
  }

  for (const p of rowsToInsert) {
    const isPrimary = p.type === "primary" || (!p.type && participantRows.length === 0);
    participantRows.push({
      waiver_id: waiverId,
      customer_id: customerId,
      business_id: businessId,
      participant_type: isPrimary ? "primary" : (p.type || "minor"),
      first_name: p.firstName!.trim(),
      last_name: p.lastName!.trim(),
      date_of_birth: p.dateOfBirth || null,
      phone_number: isPrimary && normalizedPhone.length >= 10 ? normalizedPhone : null,
      email: isPrimary ? normalizedEmail : (p.email || null),
      signed_at: isPrimary ? signedAtIso : null,
      is_required: isPrimary,
      is_account_owner: isPrimary,
      signature_image_url: isPrimary ? primarySignatureUrl : null,
      participant_portal_access: null,
    });
  }

  const mergedConsents = {
    ...consentStates,
    marketing: marketingOptIn || !!consentStates.marketing,
  };
  const consentRows = buildConsentRows(waiverId, signedAtIso, mergedConsents);

  const { data, error } = await supabase.rpc("waivers_atomic_submit_package", {
    p_payload: {
      waiver: waiverRow,
      participants: participantRows,
      consents: consentRows,
    },
  });

  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown> | null;
  if (!row || row.success !== true) {
    throw new Error(String(row?.error || "Waiver submit failed"));
  }

  return { waiverId: String(row.waiver_id || waiverId), dedup: !!row.dedup };
}

export async function sendEmbedOtpEmail(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  email: string,
  otpCode: string,
  phone: string,
): Promise<void> {
  const { data: business } = await supabase
    .from("businesses")
    .select("name")
    .eq("id", businessId)
    .maybeSingle();

  const businessName = String(business?.name || "Off The Wall Kids").trim() || "Off The Wall Kids";
  const subject = `Your waiver verification code - ${businessName}`;
  const text = `Your verification code is: ${otpCode}\n\nThis code expires in 10 minutes.\n\nIf you did not request this, ignore this email.\n\n${businessName}`;
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
<p>Your verification code is:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;padding:16px;background:#f5f5f5;border-radius:8px">${otpCode}</p>
<p style="font-size:12px;color:#666">Expires in 10 minutes.</p>
</body></html>`;

  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || ""}`,
    },
    body: JSON.stringify({
      businessId,
      campaignId: `waiver-embed-otp-${phone}-${Date.now()}`,
      emailType: "transactional",
      to: email,
      fromEmail: "noreply@tavarios.ca",
      fromName: `${businessName} - Verification`,
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.warn("[tavari-api-waiver-embed] mail-send failed:", err.slice(0, 400));
  }
}

export { normalizePhone };
