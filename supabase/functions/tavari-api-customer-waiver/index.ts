// Mobile customer waiver API — context, submit, existing-waiver OTP access.



import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {

  createWaiverViewerToken,

  extractBearerToken,

  normalizePhone,

  verifyWaiverViewerToken,

} from "../_shared/customerAppSession.ts";

import {

  isSessionResponse,

  requireCustomerSession,

} from "../_shared/requireCustomerSession.ts";



const corsHeaders = {

  "Access-Control-Allow-Origin": "*",

  "Access-Control-Allow-Headers":

    "authorization, x-client-info, apikey, content-type, x-customer-session, x-waiver-viewer",

  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",

  "Access-Control-Max-Age": "86400",

};



const UUID_RE =

  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;



const CONSENT_TYPES = [

  "marketing",

  "photography",

  "medical",

  "other",

  "waiver_terms",

  "electronic_signature",

  "additional_adult_intent",

];



function json(body: Record<string, unknown>, status = 200) {

  return new Response(JSON.stringify(body), {

    status,

    headers: { ...corsHeaders, "Content-Type": "application/json" },

  });

}



function maskEmail(email: string): string {

  const trimmed = email.trim();

  const at = trimmed.indexOf("@");

  if (at <= 1) return "***@***";

  return `${trimmed[0]}***@${trimmed.slice(at + 1)}`;

}



function participantTypeKey(p: Record<string, unknown>): string {

  return String(p.participant_type || p.type || "")

    .toLowerCase()

    .replace(/\s+/g, "_")

    .replace(/-+/g, "_");

}



function isAdditionalAdultParticipant(p: Record<string, unknown>): boolean {

  const k = participantTypeKey(p);

  return k === "additional_adult" || k === "additionaladult" || k === "guardian";

}



function participantPhoneDigits(p: Record<string, unknown>): string {

  const raw = String(p.phone_number ?? p.phone ?? "").trim();

  return normalizePhone(raw);

}



function resolveOtpDeliveryForExistingWaiver(

  waiver: Record<string, unknown>,

  participants: Array<Record<string, unknown>>,

  enteredPhone: string,

) {

  const entered = normalizePhone(enteredPhone);

  if (entered.length < 10) {

    return { email: null as string | null, preferProvidedEmail: false, matched: null as string | null };

  }



  const sigPhone = normalizePhone(waiver.phone_number);

  if (sigPhone && sigPhone === entered) {

    const email = String(waiver.email || "").trim() || null;

    return { email, preferProvidedEmail: false, matched: "signature" };

  }



  const adult = participants.find((p) => {

    if (!isAdditionalAdultParticipant(p)) return false;

    const pPhone = participantPhoneDigits(p);

    return pPhone === entered && pPhone.length >= 10;

  });



  if (adult) {

    const email = String(adult.email || adult.contact_email || "").trim() || null;

    return { email, preferProvidedEmail: true, matched: "additional_adult" };

  }



  return { email: null, preferProvidedEmail: false, matched: null };

}



function resolveWaiverViewerAccess(

  waiver: Record<string, unknown>,

  participants: Array<Record<string, unknown>>,

  enteredPhone: string,

) {

  const entered = normalizePhone(enteredPhone);

  if (entered.length < 10) {

    return { mode: "signer", participantId: null as string | null };

  }



  const sigPhone = normalizePhone(waiver.phone_number);

  if (sigPhone && sigPhone === entered) {

    return { mode: "signer", participantId: null };

  }



  const match = participants.find((p) => {

    if (!isAdditionalAdultParticipant(p)) return false;

    const pPhone = participantPhoneDigits(p);

    return pPhone === entered && pPhone.length >= 10;

  });



  if (!match) return { mode: "signer", participantId: null };



  const raw = String(match.participant_portal_access || "full_view");

  const mode = raw === "co_primary" ? "co_primary" : raw === "self_only" ? "self_only" : "full_view";

  return { mode, participantId: String(match.id || "") || null };

}



function buildConsentRows(waiverId: string, acknowledgedAt: string, includeIntent = false) {

  const rows = [];

  for (const consentType of CONSENT_TYPES) {

    if (consentType === "marketing") continue;

    if (consentType === "additional_adult_intent" && !includeIntent) continue;

    rows.push({

      waiver_id: waiverId,

      consent_type: consentType,

      consent_given:

        consentType === "waiver_terms" ||

        consentType === "electronic_signature" ||

        consentType === "additional_adult_intent",

      acknowledged_at: acknowledgedAt,

    });

  }

  return rows;

}



async function loadExpiryDays(

  supabase: ReturnType<typeof createClient>,

  businessId: string,

  templateId: string,

): Promise<number | null> {

  const { data: globalSettings } = await supabase

    .from("waiver_settings")

    .select("setting_value")

    .eq("business_id", businessId)

    .eq("setting_key", "default_expiry_days")

    .eq("is_global", true)

    .maybeSingle();



  if (globalSettings?.setting_value != null) {

    const n = parseInt(String(globalSettings.setting_value), 10);

    if (Number.isFinite(n) && n > 0) return n;

  }



  const { data: template } = await supabase

    .from("waiver_templates")

    .select("expiry_days")

    .eq("id", templateId)

    .maybeSingle();



  if (template?.expiry_days != null) {

    const n = parseInt(String(template.expiry_days), 10);

    if (Number.isFinite(n) && n > 0) return n;

  }



  return 365;

}



async function uploadSignaturePng(

  supabase: ReturnType<typeof createClient>,

  businessId: string,

  waiverId: string,

  signatureBase64: string,

  suffix = "",

): Promise<string | null> {

  const raw = signatureBase64.replace(/^data:image\/png;base64,/, "");

  const binary = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));

  const filePath = `signatures/${businessId}/${waiverId}${suffix}-${Date.now()}.png`;

  const { error } = await supabase.storage.from("waivers").upload(filePath, binary, {

    contentType: "image/png",

    upsert: false,

  });

  if (error) {

    console.warn("[tavari-api-customer-waiver] signature upload failed:", error.message);

    return null;

  }

  const { data } = supabase.storage.from("waivers").getPublicUrl(filePath);

  return data?.publicUrl || null;

}



async function sendOtpEmail(

  businessId: string,

  email: string,

  otpCode: string,

  phone: string,

) {

  const supabase = createClient(

    Deno.env.get("SUPABASE_URL")!,

    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,

  );

  const { data: business } = await supabase

    .from("businesses")

    .select("name")

    .eq("id", businessId)

    .maybeSingle();



  const businessName = String(business?.name || "Off The Wall Kids").trim() || "Off The Wall Kids";

  const subject = `Your waiver verification code - ${businessName}`;

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#111">

<p>Your verification code is:</p>

<p style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;padding:16px;background:#f5f5f5;border-radius:8px">${otpCode}</p>

<p style="font-size:12px;color:#666">Expires in 10 minutes.</p>

</body></html>`;



  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mail-send`, {

    method: "POST",

    headers: {

      "Content-Type": "application/json",

      apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",

      Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || ""}`,

    },

    body: JSON.stringify({

      businessId,

      campaignId: `waiver-otp-${phone}-${Date.now()}`,

      emailType: "transactional",

      to: email,

      fromEmail: "noreply@tavarios.ca",

      fromName: `${businessName} - Verification`,

      subject,

      html,

      text: `Your verification code is: ${otpCode}\n\nExpires in 10 minutes.`,

    }),

  });

}



async function searchWaiversByPhone(

  supabase: ReturnType<typeof createClient>,

  businessId: string,

  phone: string,

) {

  const normalized = normalizePhone(phone);

  const waivers: Array<Record<string, unknown>> = [];

  const seen = new Set<string>();



  const addWaiver = (w: Record<string, unknown> | null) => {

    const id = String(w?.id || "");

    if (!id || seen.has(id)) return;

    seen.add(id);

    waivers.push(w!);

  };



  const { data: byPhone } = await supabase

    .from("waiver_signatures")

    .select("id, first_name, last_name, email, phone_number, signed_at, expires_at, is_valid, customer_id")

    .eq("business_id", businessId)

    .eq("is_valid", true)

    .ilike("phone_number", `%${normalized.slice(-10)}%`)

    .order("signed_at", { ascending: false })

    .limit(20);



  for (const w of byPhone || []) {

    if (normalizePhone(w.phone_number) === normalized) addWaiver(w as Record<string, unknown>);

  }



  const suffix = normalized.slice(-7);

  const { data: customers } = await supabase

    .from("pos_loyalty_accounts")

    .select("id, customer_phone")

    .eq("business_id", businessId)

    .eq("is_active", true)

    .ilike("customer_phone", `%${suffix}%`)

    .limit(50);



  const customerIds = (customers || [])

    .filter((c) => normalizePhone(c.customer_phone) === normalized)

    .map((c) => c.id);



  if (customerIds.length > 0) {

    const { data: byCustomer } = await supabase

      .from("waiver_signatures")

      .select("id, first_name, last_name, email, phone_number, signed_at, expires_at, is_valid, customer_id")

      .eq("business_id", businessId)

      .eq("is_valid", true)

      .in("customer_id", customerIds)

      .order("signed_at", { ascending: false })

      .limit(20);

    for (const w of byCustomer || []) addWaiver(w as Record<string, unknown>);

  }



  if (normalized.length >= 10) {

    const { data: participantMatches } = await supabase.rpc(

      "waivers_find_ids_by_additional_adult_phone",

      { p_business_id: businessId, p_normalized_phone: normalized },

    );

    const extraIds = [

      ...new Set(

        (participantMatches || [])

          .map((row: { waiver_id?: string }) => row?.waiver_id)

          .filter((id: string | undefined) => id && !seen.has(id)),

      ),

    ];

    if (extraIds.length > 0) {

      const { data: moreWaivers } = await supabase

        .from("waiver_signatures")

        .select("id, first_name, last_name, email, phone_number, signed_at, expires_at, is_valid, customer_id")

        .eq("business_id", businessId)

        .eq("is_valid", true)

        .in("id", extraIds);

      for (const w of moreWaivers || []) addWaiver(w as Record<string, unknown>);

    }

  }



  return waivers.sort((a, b) => {

    const aMs = a.signed_at ? new Date(String(a.signed_at)).getTime() : 0;

    const bMs = b.signed_at ? new Date(String(b.signed_at)).getTime() : 0;

    return bMs - aMs;

  });

}



async function loadWaiverWithParticipants(

  supabase: ReturnType<typeof createClient>,

  businessId: string,

  waiverId: string,

) {

  const { data: waiver, error } = await supabase

    .from("waiver_signatures")

    .select("id, first_name, last_name, email, phone_number, signed_at, expires_at, is_valid, customer_id, template_id")

    .eq("id", waiverId)

    .eq("business_id", businessId)

    .maybeSingle();



  if (error) throw error;

  if (!waiver) return null;



  const { data: participants } = await supabase

    .from("waiver_participants")

    .select("id, first_name, last_name, participant_type, date_of_birth, email, phone_number, signed_at, participant_portal_access")

    .eq("waiver_id", waiverId)

    .order("created_at");



  return { waiver, participants: participants || [] };

}



async function loadWaiverContext(

  supabase: ReturnType<typeof createClient>,

  businessId: string,

  customerId: string,

) {

  const { data: template } = await supabase

    .from("waiver_templates")

    .select("id, template_name, template_key, version, fields_config, requires_digital_signature, waiver_title, waiver_content")

    .eq("business_id", businessId)

    .eq("is_active", true)

    .order("version", { ascending: false })

    .limit(1)

    .maybeSingle();



  const { data: attachedPeople } = await supabase.rpc("bookings_get_portal_participants", {

    p_customer_id: customerId,

    p_business_id: businessId,

  });



  const { data: waivers } = await supabase

    .from("waiver_signatures")

    .select(`

      id,

      signed_at,

      expires_at,

      is_valid,

      first_name,

      last_name,

      waiver_participants (

        id,

        first_name,

        last_name,

        participant_type,

        date_of_birth

      )

    `)

    .eq("business_id", businessId)

    .eq("customer_id", customerId)

    .order("signed_at", { ascending: false })

    .limit(20);



  const { data: customer } = await supabase

    .from("pos_loyalty_accounts")

    .select("id, customer_name, customer_email, customer_phone")

    .eq("id", customerId)

    .eq("business_id", businessId)

    .maybeSingle();



  return {

    template,

    attachedPeople: Array.isArray(attachedPeople) ? attachedPeople : attachedPeople ? [attachedPeople] : [],

    waivers: waivers || [],

    customer,

  };

}



type ParticipantInput = {

  type?: string;

  firstName?: string;

  lastName?: string;

  dateOfBirth?: string | null;

  email?: string | null;

  phone?: string | null;

  signatureBase64?: string | null;

  participantPortalAccess?: string | null;

};



async function submitMobileWaiver(

  supabase: ReturnType<typeof createClient>,

  businessId: string,

  customerId: string,

  templateId: string,

  signatureBase64: string,

  participants: ParticipantInput[],

  marketingOptIn: boolean,

  additionalAdultIntentAcknowledged = false,

) {

  const { data: customer } = await supabase

    .from("pos_loyalty_accounts")

    .select("customer_name, customer_email, customer_phone")

    .eq("id", customerId)

    .eq("business_id", businessId)

    .maybeSingle();



  if (!customer) throw new Error("Customer not found");



  const primary = participants.find((p) => p.type === "primary") || participants[0];

  if (!primary?.firstName || !primary?.lastName) {

    throw new Error("Primary signer name is required");

  }



  const hasAdditionalAdults = participants.some((p) => p.type === "additional_adult");

  if (hasAdditionalAdults && !additionalAdultIntentAcknowledged) {

    throw new Error("Additional adult intent acknowledgment is required");

  }



  for (const adult of participants.filter((p) => p.type === "additional_adult")) {

    if (!adult.firstName || !adult.lastName) {

      throw new Error("Additional adult name is required");

    }

    if (!adult.email?.trim()) throw new Error("Additional adult email is required");

    if (!adult.phone?.trim() || normalizePhone(adult.phone).length < 10) {

      throw new Error("Additional adult phone is required");

    }

    if (!adult.signatureBase64?.startsWith("data:image")) {

      throw new Error(`Signature required for ${adult.firstName} ${adult.lastName}`);

    }

  }



  const { data: signatureToken, error: tokenError } = await supabase.rpc(

    "waivers_create_signature_token",

    { business_uuid: businessId },

  );

  if (tokenError) throw tokenError;



  const waiverId = crypto.randomUUID();

  const signedAt = new Date();

  const signedAtIso = signedAt.toISOString();

  const expiryDays = await loadExpiryDays(supabase, businessId, templateId);

  const expiresAt = expiryDays

    ? new Date(signedAt.getTime() + expiryDays * 86400000).toISOString()

    : null;



  const primarySignatureUrl = await uploadSignaturePng(supabase, businessId, waiverId, signatureBase64, "-primary");

  const signerPhone = normalizePhone(primary.phone || customer.customer_phone);



  const waiverRow: Record<string, unknown> = {

    id: waiverId,

    client_submission_id: waiverId,

    business_id: businessId,

    template_id: templateId,

    signature_token: signatureToken,

    first_name: primary.firstName,

    last_name: primary.lastName,

    date_of_birth: primary.dateOfBirth || null,

    phone_number: signerPhone.length >= 10 ? signerPhone : null,

    email: primary.email || customer.customer_email || null,

    signature_image_url: primarySignatureUrl,

    signature_data: { imageUrl: signatureBase64 },

    customer_id: customerId,

    is_minor: false,

    is_valid: true,

    signed_at: signedAtIso,

    expires_at: expiresAt,

    ip_address: null,

    user_agent: "otwk-mobile-app",

    additional_adult_intent_acknowledgments: hasAdditionalAdults ? { mobile: true, at: signedAtIso } : null,

  };



  const participantRows = [];

  for (const p of participants.filter((p) => p.firstName && p.lastName)) {

    const isPrimary = p.type === "primary";

    const isAdult = p.type === "additional_adult";

    let sigUrl: string | null = null;

    let signedAtRow: string | null = null;



    if (isPrimary) {

      sigUrl = primarySignatureUrl;

      signedAtRow = signedAtIso;

    } else if (isAdult && p.signatureBase64) {

      sigUrl = await uploadSignaturePng(supabase, businessId, waiverId, p.signatureBase64, `-${p.firstName}`);

      signedAtRow = signedAtIso;

    }



    participantRows.push({

      waiver_id: waiverId,

      customer_id: customerId,

      business_id: businessId,

      participant_type: p.type || "minor",

      first_name: p.firstName,

      last_name: p.lastName,

      date_of_birth: p.dateOfBirth || null,

      phone_number: normalizePhone(p.phone || "").length >= 10 ? normalizePhone(p.phone) : null,

      email: p.email || null,

      signed_at: signedAtRow,

      is_required: isPrimary,

      is_account_owner: isPrimary,

      signature_image_url: sigUrl,

      participant_portal_access: isAdult ? (p.participantPortalAccess || "full_view") : null,

    });

  }



  if (participantRows.length === 0) {

    participantRows.push({

      waiver_id: waiverId,

      customer_id: customerId,

      business_id: businessId,

      participant_type: "primary",

      first_name: primary.firstName,

      last_name: primary.lastName,

      date_of_birth: primary.dateOfBirth || null,

      phone_number: signerPhone.length >= 10 ? signerPhone : null,

      email: primary.email || customer.customer_email || null,

      signed_at: signedAtIso,

      is_required: true,

      is_account_owner: true,

      signature_image_url: primarySignatureUrl,

    });

  }



  const consentRows = buildConsentRows(waiverId, signedAtIso, hasAdditionalAdults);

  if (marketingOptIn) {

    consentRows.push({

      waiver_id: waiverId,

      consent_type: "marketing",

      consent_given: true,

      acknowledged_at: signedAtIso,

    });

  }



  const { data, error } = await supabase.rpc("waivers_atomic_submit_package", {

    p_payload: {

      waiver: waiverRow,

      participants: participantRows,

      consents: consentRows,

    },

  });



  if (error) throw error;

  const row = data as Record<string, unknown> | null;

  if (!row || row.success !== true) {

    throw new Error(String(row?.error || "Waiver submit failed"));

  }



  return { waiverId, dedup: row.dedup };

}



serve(async (req) => {

  if (req.method === "OPTIONS") {

    return new Response("ok", { status: 200, headers: corsHeaders });

  }



  try {

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const action = String(body.action || "context").trim();

    const businessId = String(body.businessId || "").trim();



    if (!UUID_RE.test(businessId)) {

      return json({ error: "Invalid businessId" }, 400);

    }



    const supabase = createClient(

      Deno.env.get("SUPABASE_URL")!,

      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,

    );



    if (action === "lookup") {

      const phone = normalizePhone(body.phoneNumber ?? body.phone);

      if (phone.length < 10) return json({ error: "Invalid phone number" }, 400);



      const waivers = await searchWaiversByPhone(supabase, businessId, phone);

      if (waivers.length === 0) {

        return json({ ok: true, found: false });

      }



      const latest = waivers[0];

      return json({

        ok: true,

        found: true,

        waiverId: latest.id,

        signerName: `${latest.first_name || ""} ${latest.last_name || ""}`.trim(),

        signedAt: latest.signed_at,

        expiresAt: latest.expires_at,

      });

    }



    if (action === "sendOtp") {

      const phone = normalizePhone(body.phoneNumber ?? body.phone);

      const waiverId = String(body.waiverId || "").trim();

      if (phone.length < 10) return json({ error: "Invalid phone number" }, 400);



      let waiver: Record<string, unknown> | null = null;

      let participants: Array<Record<string, unknown>> = [];



      if (UUID_RE.test(waiverId)) {

        const loaded = await loadWaiverWithParticipants(supabase, businessId, waiverId);

        if (!loaded) return json({ error: "Waiver not found" }, 404);

        waiver = loaded.waiver as Record<string, unknown>;

        participants = loaded.participants as Array<Record<string, unknown>>;

      } else {

        const waivers = await searchWaiversByPhone(supabase, businessId, phone);

        if (waivers.length === 0) return json({ error: "No waiver found for this phone" }, 404);

        const loaded = await loadWaiverWithParticipants(supabase, businessId, String(waivers[0].id));

        if (!loaded) return json({ error: "Waiver not found" }, 404);

        waiver = loaded.waiver as Record<string, unknown>;

        participants = loaded.participants as Array<Record<string, unknown>>;

      }



      const delivery = resolveOtpDeliveryForExistingWaiver(waiver, participants, phone);

      if (!delivery.matched) {

        return json({ error: "This phone is not on file for that waiver" }, 400);

      }

      if (!delivery.email) {

        return json({ error: "No email on file to send a verification code" }, 400);

      }



      const customerId = delivery.matched === "signature" ? String(waiver.customer_id || "") : null;

      const rpcEmail = delivery.preferProvidedEmail ? delivery.email : null;



      const { data: otpCode, error: otpError } = await supabase.rpc("waivers_generate_otp", {

        p_business_id: businessId,

        p_phone_number: phone,

        p_email: rpcEmail,

        p_customer_id: customerId && UUID_RE.test(customerId) ? customerId : null,

        p_ip_address: null,

        p_user_agent: "otwk-mobile-app",

      });



      if (otpError) return json({ error: otpError.message }, 400);

      if (!otpCode) return json({ error: "Could not generate verification code" }, 500);



      await sendOtpEmail(businessId, delivery.email, String(otpCode), phone);



      return json({

        ok: true,

        maskedEmail: maskEmail(delivery.email),

        waiverId: waiver.id,

      });

    }



    if (action === "verifyOtp") {

      const phone = normalizePhone(body.phoneNumber ?? body.phone);

      const otpCode = String(body.otpCode || body.code || "").trim();

      const waiverId = String(body.waiverId || "").trim();

      if (phone.length < 10 || otpCode.length < 4) {

        return json({ error: "Phone and verification code required" }, 400);

      }



      const { data: verifyResult, error: verifyError } = await supabase.rpc("waivers_verify_otp", {

        p_phone_number: phone,

        p_otp_code: otpCode,

        p_business_id: businessId,

      });



      if (verifyError) return json({ error: verifyError.message }, 400);

      const result = verifyResult as Record<string, unknown> | null;

      if (!result?.valid) {

        return json({ error: String(result?.error || "Invalid code") }, 401);

      }



      let targetWaiverId = waiverId;

      if (!UUID_RE.test(targetWaiverId)) {

        const waivers = await searchWaiversByPhone(supabase, businessId, phone);

        if (waivers.length === 0) return json({ error: "No waiver found" }, 404);

        targetWaiverId = String(waivers[0].id);

      }



      const loaded = await loadWaiverWithParticipants(supabase, businessId, targetWaiverId);

      if (!loaded) return json({ error: "Waiver not found" }, 404);



      const viewerAccess = resolveWaiverViewerAccess(

        loaded.waiver as Record<string, unknown>,

        loaded.participants as Array<Record<string, unknown>>,

        phone,

      );



      const waiverViewerToken = await createWaiverViewerToken({ businessId, phone });



      return json({

        ok: true,

        waiverViewerToken,

        viewerAccess,

        waiver: {

          id: loaded.waiver.id,

          signerName: `${loaded.waiver.first_name} ${loaded.waiver.last_name}`.trim(),

          signedAt: loaded.waiver.signed_at,

          expiresAt: loaded.waiver.expires_at,

          isValid: loaded.waiver.is_valid,

          participants: (loaded.participants || []).map((p: Record<string, unknown>) => ({

            id: p.id,

            firstName: p.first_name,

            lastName: p.last_name,

            type: p.participant_type,

            dateOfBirth: p.date_of_birth,

            signedAt: p.signed_at,

          })),

        },

      });

    }



    if (action === "existingWaiver") {

      const waiverId = String(body.waiverId || "").trim();

      if (!UUID_RE.test(waiverId)) return json({ error: "Invalid waiverId" }, 400);



      const viewerToken =

        extractBearerToken(req) || req.headers.get("X-Waiver-Viewer")?.trim() || "";

      const viewer = viewerToken ? await verifyWaiverViewerToken(viewerToken) : null;

      if (!viewer || viewer.businessId !== businessId) {

        return json({ error: "Waiver access expired — verify your phone again" }, 401);

      }



      const loaded = await loadWaiverWithParticipants(supabase, businessId, waiverId);

      if (!loaded) return json({ error: "Waiver not found" }, 404);



      const viewerAccess = resolveWaiverViewerAccess(

        loaded.waiver as Record<string, unknown>,

        loaded.participants as Array<Record<string, unknown>>,

        viewer.phone,

      );



      return json({

        ok: true,

        viewerAccess,

        waiver: {

          id: loaded.waiver.id,

          signerName: `${loaded.waiver.first_name} ${loaded.waiver.last_name}`.trim(),

          signedAt: loaded.waiver.signed_at,

          expiresAt: loaded.waiver.expires_at,

          isValid: loaded.waiver.is_valid,

          participants: (loaded.participants || []).map((p: Record<string, unknown>) => ({

            id: p.id,

            firstName: p.first_name,

            lastName: p.last_name,

            type: p.participant_type,

            dateOfBirth: p.date_of_birth,

            signedAt: p.signed_at,

          })),

        },

      });

    }



    const session = await requireCustomerSession(req);

    if (isSessionResponse(session)) {

      return new Response(session.body, {

        status: session.status,

        headers: { ...corsHeaders, "Content-Type": "application/json" },

      });

    }

    if (session.businessId !== businessId) {

      return json({ error: "Session business mismatch" }, 403);

    }



    if (action === "context") {

      const context = await loadWaiverContext(supabase, businessId, session.customerId);

      return json({ ok: true, businessId, ...context });

    }



    if (action === "submit") {

      const templateId = String(body.templateId || "").trim();

      const signatureBase64 = String(body.signatureBase64 || "").trim();

      const participants = Array.isArray(body.participants) ? body.participants as ParticipantInput[] : [];

      const marketingOptIn = Boolean(body.marketingOptIn);

      const additionalAdultIntentAcknowledged = Boolean(body.additionalAdultIntentAcknowledged);



      if (!UUID_RE.test(templateId)) return json({ error: "Invalid templateId" }, 400);

      if (!signatureBase64.startsWith("data:image")) {

        return json({ error: "signatureBase64 PNG data URL required" }, 400);

      }



      const result = await submitMobileWaiver(

        supabase,

        businessId,

        session.customerId,

        templateId,

        signatureBase64,

        participants,

        marketingOptIn,

        additionalAdultIntentAcknowledged,

      );



      return json({ ok: true, ...result });

    }



    return json({ error: "Unknown action" }, 400);

  } catch (error) {

    console.error("[tavari-api-customer-waiver]", error);

    return json(

      { error: error instanceof Error ? error.message : "Server error" },

      500,

    );

  }

});


