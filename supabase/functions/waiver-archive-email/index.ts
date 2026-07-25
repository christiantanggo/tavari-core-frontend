import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type WaiverRow = Record<string, any>;
type ParticipantRow = Record<string, any>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(text: unknown): string {
  if (text == null || text === "") return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripScripts(html: string): string {
  return String(html || "").replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
}

function plainTextToPreservedHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\t/g, "&nbsp;&nbsp;&nbsp;&nbsp;")
    .replace(/ {2,}/g, (spaces) => "&nbsp;".repeat(spaces.length))
    .replace(/\r\n|\r|\n/g, "<br />");
}

function stripHtmlToText(html: string): string {
  return String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*\/\s*(td|th)\s*>/gi, "  ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join("\n");
}

function parseIsoCalendarDate(value: unknown) {
  if (value == null || value === "") return null;
  const head = String(value).trim().slice(0, 10);
  const m = head.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return { y, m: mo, d };
}

function formatDateOfBirthDisplay(value: unknown, locale = "en-CA"): string {
  if (value == null || value === "") return "N/A";
  const p = parseIsoCalendarDate(value);
  if (p) {
    return new Date(p.y, p.m - 1, p.d).toLocaleDateString(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString(locale);
}

function formatSigningSourceLabel(source: unknown): string {
  const s = String(source || "").toLowerCase();
  const map: Record<string, string> = {
    browser: "Online - customer web browser",
    browser_kiosk: "On-site browser kiosk",
    kiosk: "On-site waiver kiosk app",
    mobile_app: "Mobile app",
    in_person: "In person (staff-assisted)",
    off_site: "Off-site / remote",
    mobile_web: "Mobile web browser",
  };
  return map[s] || (source ? String(source) : "Not recorded");
}

function formatUserAgentSummary(ua: unknown): string {
  const u = String(ua || "").toLowerCase();
  if (!u) return "";
  let browser = "Web browser";
  if (u.includes("edg/")) browser = "Microsoft Edge";
  else if (u.includes("opr/") || u.includes("opera")) browser = "Opera";
  else if (u.includes("chrome") || u.includes("crios")) browser = "Chrome";
  else if (u.includes("firefox") || u.includes("fxios")) browser = "Firefox";
  else if (u.includes("safari") && !u.includes("chrome")) browser = "Safari";

  let os = "";
  if (u.includes("windows")) os = "Windows";
  else if (u.includes("mac os") || u.includes("macintosh")) os = "macOS";
  else if (u.includes("android")) os = "Android";
  else if (u.includes("iphone") || u.includes("ipad") || u.includes("ios")) os = "iOS";
  else if (u.includes("linux")) os = "Linux";
  return os ? `${browser} on ${os}` : browser;
}

function waiverBodyHtml(rawContent: unknown): string {
  const trimmed = String(rawContent || "").trim();
  if (!trimmed) return "<p><em>No waiver text on file.</em></p>";
  if (/<\s*[a-z][\s\S]*>/i.test(trimmed)) {
    return `<div class="waiver-legal-body waiver-legal-body-preserve">${stripScripts(trimmed)}</div>`;
  }
  return `<div class="waiver-legal-body waiver-legal-body-preserve">${plainTextToPreservedHtml(trimmed)}</div>`;
}

function getCanonicalSignedWaiverPdfStoragePath(businessId: string, waiverId: string) {
  return `waivers/${businessId}/${waiverId}.pdf`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function signedDateLabel(value: unknown): string {
  if (!value) return new Date().toLocaleDateString("en-CA");
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-CA");
}

function getBusinessTimezone(waiver: WaiverRow): string {
  return String(waiver?.businesses?.timezone || "America/Toronto").trim() || "America/Toronto";
}

function formatDateTimeDisplay(value: unknown, timeZone: string): string {
  if (!value) return "—";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime())
    ? String(value)
    : d.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone });
}

function formatDateLabelDisplay(value: unknown, timeZone: string): string {
  if (!value) return new Date().toLocaleDateString("en-CA", { timeZone });
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-CA", { timeZone });
}

function buildConsentStatusMap(consents: Record<string, any>[]) {
  const map: Record<string, boolean> = {};
  for (const row of Array.isArray(consents) ? consents : []) {
    const key = String(row?.consent_type || "").trim();
    if (!key) continue;
    map[key] = !!row?.consent_given;
  }
  return map;
}

function getConsentValue(
  consentMap: Record<string, boolean>,
  key: string,
  fallback = false,
) {
  return Object.prototype.hasOwnProperty.call(consentMap, key)
    ? !!consentMap[key]
    : fallback;
}

function getPrimaryConsentStatus(
  waiver: WaiverRow,
  consentMap: Record<string, boolean>,
) {
  const signedFallback = !!waiver?.signed_at;
  const marketingFallback = !!waiver?.marketing_opt_in;
  return {
    waiverTerms: getConsentValue(consentMap, "waiver_terms", signedFallback),
    electronicSignature: getConsentValue(
      consentMap,
      "electronic_signature",
      signedFallback,
    ),
    marketing: getConsentValue(consentMap, "marketing", marketingFallback),
  };
}

function checkboxHtml(checked: boolean, label: string) {
  return `<div style="margin:6px 0;font-size:12px;line-height:1.45;">${checked ? "&#9745;" : "&#9744;"} ${escapeHtml(label)}</div>`;
}

function checkboxText(checked: boolean, label: string) {
  return `${checked ? "[x]" : "[ ]"} ${label}`;
}

async function getAuthContext(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return {
      authHeader,
      isServiceRole: true,
      user: null,
      supabaseUser: null,
    };
  }
  if (!authHeader) {
    return {
      authHeader: null,
      isServiceRole: false,
      user: null,
      supabaseUser: null,
    };
  }

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await supabaseUser.auth.getUser();
  return {
    authHeader,
    isServiceRole: false,
    user: user || null,
    supabaseUser,
  };
}

async function requireWaiverPdfRepairAccess(
  authContext: Awaited<ReturnType<typeof getAuthContext>>,
  businessId: string,
) {
  if (authContext.isServiceRole) {
    return { ok: true, actorUserId: null, actorRole: "service_role" };
  }
  if (!authContext.user?.id || !authContext.supabaseUser) {
    return { ok: false, response: jsonResponse({ error: "Unauthorized repair request" }, 401) };
  }

  const [{ data: businessMembership }, { data: roleMembership }] = await Promise.all([
    authContext.supabaseUser
      .from("business_users")
      .select("role")
      .eq("business_id", businessId)
      .eq("user_id", authContext.user.id)
      .in("role", ["owner", "manager", "admin"])
      .limit(1)
      .maybeSingle(),
    authContext.supabaseUser
      .from("user_roles")
      .select("role")
      .eq("business_id", businessId)
      .eq("user_id", authContext.user.id)
      .in("role", ["owner", "manager", "admin"])
      .limit(1)
      .maybeSingle(),
  ]);

  const actorRole = businessMembership?.role || roleMembership?.role || null;
  if (!actorRole) {
    return {
      ok: false,
      response: jsonResponse({ error: "Access denied for archived PDF repair" }, 403),
    };
  }

  return {
    ok: true,
    actorUserId: authContext.user.id,
    actorRole,
  };
}

async function logWaiverPdfRepair(
  service: ReturnType<typeof createClient>,
  args: {
    actorUserId: string | null;
    waiverId: string;
    businessId: string;
    storagePath: string;
    repairReason?: string;
    repairedAt: string;
    actorRole?: string | null;
  },
) {
  try {
    await service.from("audit_logs").insert({
      user_id: args.actorUserId,
      event_type: "waiver.uploaded",
      details: JSON.stringify({
        action: "repair_archived_pdf",
        waiver_id: args.waiverId,
        business_id: args.businessId,
        storage_path: args.storagePath,
        repair_reason: args.repairReason || null,
        repaired_at: args.repairedAt,
        actor_role: args.actorRole || null,
      }),
    });
  } catch (error) {
    console.error("[waiver-archive-email] Failed to write repair audit log:", error);
  }
}

async function findRepairCandidateWaiverIds(
  service: ReturnType<typeof createClient>,
  businessId: string,
) {
  const { data: archivedWaivers, error: waiverError } = await service
    .from("waiver_signatures")
    .select("id, signed_at, marketing_opt_in, signed_pdf_uploaded_at")
    .eq("business_id", businessId)
    .not("signed_pdf_uploaded_at", "is", null)
    .not("signed_at", "is", null)
    .order("signed_pdf_uploaded_at", { ascending: false })
    .limit(5000);

  if (waiverError) {
    throw waiverError;
  }

  const waiverIds = (archivedWaivers || []).map((row) => row.id).filter(Boolean);
  if (!waiverIds.length) return [];

  const { data: consentRows, error: consentError } = await service
    .from("waiver_consents")
    .select("waiver_id, consent_type")
    .in("waiver_id", waiverIds);

  if (consentError) {
    throw consentError;
  }

  const consentTypesByWaiverId = new Map<string, Set<string>>();
  for (const row of consentRows || []) {
    const waiverId = String(row?.waiver_id || "").trim();
    const consentType = String(row?.consent_type || "").trim();
    if (!waiverId || !consentType) continue;
    if (!consentTypesByWaiverId.has(waiverId)) {
      consentTypesByWaiverId.set(waiverId, new Set());
    }
    consentTypesByWaiverId.get(waiverId)!.add(consentType);
  }

  return (archivedWaivers || [])
    .filter((waiver) => {
      const consentTypes = consentTypesByWaiverId.get(String(waiver.id || "").trim()) || new Set<string>();
      if (!consentTypes.has("waiver_terms")) return true;
      if (!consentTypes.has("electronic_signature")) return true;
      if (waiver?.marketing_opt_in && !consentTypes.has("marketing")) return true;
      return false;
    })
    .map((waiver) => waiver.id)
    .filter(Boolean);
}

function formatPortalAccessLabel(value: unknown): string {
  const raw = String(value || "").toLowerCase();
  if (raw === "co_primary") return "Can view and manage this waiver";
  if (raw === "full_view") return "Can view everyone on this waiver";
  if (raw === "self_only") return "Can only view their own waiver details";
  return value ? String(value) : "Not selected";
}

function formatParticipantTypeLabel(value: unknown): string {
  const raw = String(value || "").toLowerCase();
  if (raw === "additional_adult") return "Additional Adult";
  if (raw === "minor") return "Child";
  if (raw === "primary") return "Primary Adult";
  return value ? String(value) : "Participant";
}

/** Inline signature (jsonb string, JSON-quoted string, object, or raw base64) before storage URL. */
function extractInlineSignatureSrc(signatureData: unknown): string {
  if (signatureData == null || signatureData === "") return "";

  if (typeof signatureData === "string") {
    let t = String(signatureData).trim();
    if (!t) return "";
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
      try {
        const parsed = JSON.parse(t);
        if (typeof parsed === "string") t = parsed.trim();
        else t = t.slice(1, -1);
      } catch {
        t = t.slice(1, -1).trim();
      }
    }
    if (/^(data:|https?:\/\/)/i.test(t)) return t;
    const b64 = t.replace(/\s/g, "");
    if (/^[A-Za-z0-9+/=_-]+$/.test(b64) && b64.length >= 200) {
      return `data:image/png;base64,${b64}`;
    }
    return "";
  }

  if (typeof signatureData === "object" && signatureData !== null) {
    const o = signatureData as Record<string, unknown>;
    const keys = ["dataUrl", "dataURL", "imageUrl", "imageData", "image", "img", "base64", "data"];
    for (const k of keys) {
      const cand = o[k];
      if (typeof cand === "string") {
        const sub = extractInlineSignatureSrc(cand);
        if (sub) return sub;
      }
    }
  }

  return "";
}

function getSignatureDisplaySrc(signatureImageUrl: unknown, signatureData: unknown): string {
  const inline = extractInlineSignatureSrc(signatureData);
  if (inline) return inline;
  const direct = String(signatureImageUrl || "").trim();
  if (direct) return direct;
  return "";
}

function getAdditionalAdultDisclaimerText(acks: Record<string, any>[]) {
  const row = (Array.isArray(acks) ? acks : []).find(
    (ack) => String(ack?.kind || "").toLowerCase() !== "adult_signer_ack"
  );
  return String(row?.acknowledgment_text || "").trim();
}

function findAdultSignerAck(acks: Record<string, any>[], participantName: string) {
  const normalized = String(participantName || "").trim().toLowerCase();
  return (Array.isArray(acks) ? acks : []).find(
    (ack) =>
      String(ack?.kind || "").toLowerCase() === "adult_signer_ack" &&
      String(ack?.participant_name || "").trim().toLowerCase() === normalized
  ) || null;
}

function additionalAdultAckHtml(ack: Record<string, any>, timeZone: string, index: number) {
  const kind = String(ack?.kind || "").toLowerCase();
  if (kind === "adult_signer_ack") {
    const participantName = String(ack?.participant_name || `Additional adult ${index + 1}`).trim();
    return `<div style="margin-top:12px;padding:10px;background:#fff;border:1px solid #cbd5e1;border-radius:4px;font-size:11px;line-height:1.5;">
      <strong>${escapeHtml(participantName)}</strong><div style="margin-top:6px;color:#334155;">${escapeHtml(formatDateTimeDisplay(ack?.acknowledged_at || "—", timeZone))}</div>
      ${checkboxHtml(!!ack?.waiver_terms_accepted, `${participantName} confirmed they read and agreed to the waiver`)}
      ${checkboxHtml(!!ack?.electronic_signature_accepted, `${participantName} consented to use an electronic signature`)}
      ${checkboxHtml(!!ack?.signed_by_self_confirmed, `${participantName} confirmed they were the person who signed, not the primary adult`)}
    </div>`;
  }
  return `<div style="margin-top:12px;padding:10px;background:#fff;border:1px solid #cbd5e1;border-radius:4px;font-size:11px;line-height:1.5;"><strong>Additional adult setup</strong><div style="margin-top:6px;color:#334155;">${escapeHtml(formatDateTimeDisplay(ack?.acknowledged_at || "—", timeZone))}</div><div style="margin-top:8px;font-style:italic;color:#1e293b;">${escapeHtml(ack?.acknowledgment_text || formatPortalAccessLabel(ack?.participant_portal_access))}</div></div>`;
}

function buildWaiverRecordDocumentHtml(
  waiver: WaiverRow,
  participants: ParticipantRow[],
  businessName: string,
  consents: Record<string, any>[],
  businessLogoUrl = "",
) {
  const tpl = waiver.waiver_templates || {};
  const title = escapeHtml(tpl.waiver_title || tpl.template_name || "Waiver");
  const businessTimezone = getBusinessTimezone(waiver);
  const consentMap = buildConsentStatusMap(consents);
  const primaryConsentStatus = getPrimaryConsentStatus(waiver, consentMap);
  const signedPrimary = waiver.signed_at
    ? formatDateTimeDisplay(waiver.signed_at, businessTimezone)
    : "—";
  const parts = Array.isArray(participants) ? participants : [];
  const minors = parts.filter((p) => String(p.participant_type || "").toLowerCase() === "minor");
  const additionalAdults = parts.filter((p) => String(p.participant_type || "").toLowerCase() === "additional_adult");
  const hasAdditionalAdults = additionalAdults.length > 0;
  const deviceSummary = formatUserAgentSummary(waiver.user_agent);
  const acks = Array.isArray(waiver.additional_adult_intent_acknowledgments)
    ? waiver.additional_adult_intent_acknowledgments
    : [];
  const disclaimerText = getAdditionalAdultDisclaimerText(acks);
  const primaryParticipant = parts.find((p) => String(p.participant_type || "").toLowerCase() === "primary");
  const primarySigSrc =
    getSignatureDisplaySrc(waiver.signature_image_url, waiver.signature_data) ||
    (primaryParticipant
      ? getSignatureDisplaySrc(primaryParticipant.signature_image_url, primaryParticipant.signature_data)
      : "");

  const renderPersonBlock = (row: Record<string, any>, opts: { title: string; includeSignature: boolean; includePortalAccess?: boolean }) => {
    const fullName = `${row.first_name || ""} ${row.last_name || ""}`.trim() || "—";
    const signedAt = row.signed_at ? formatDateTimeDisplay(row.signed_at, businessTimezone) : "—";
    const mailing = [row.address, row.city, row.postal_code].filter(Boolean).join(", ") || "—";
    const signatureSrc = getSignatureDisplaySrc(row.signature_image_url, row.signature_data);
    const adultAck = findAdultSignerAck(acks, fullName);
    return `<div style="margin-top:14px;padding:14px;border:1px solid #dbe4ee;border-radius:8px;background:#fff;">
      <div style="font-weight:bold;font-size:13px;margin-bottom:8px;">${escapeHtml(fullName)}</div>
      <div style="font-size:12px;line-height:1.6;">
        <div><strong>Date of birth:</strong> ${escapeHtml(formatDateOfBirthDisplay(row.date_of_birth, "en-CA"))}</div>
        ${row.email ? `<div><strong>Email:</strong> ${escapeHtml(row.email)}</div>` : ""}
        ${row.phone_number ? `<div><strong>Phone:</strong> ${escapeHtml(row.phone_number)}</div>` : ""}
        <div><strong>Mailing address:</strong> ${escapeHtml(mailing)}</div>
        ${opts.includePortalAccess && row.participant_portal_access ? `<div><strong>Portal access:</strong> ${escapeHtml(formatPortalAccessLabel(row.participant_portal_access))}</div>` : ""}
        ${opts.includeSignature ? `<div><strong>Signed:</strong> ${escapeHtml(signedAt)}</div>` : ""}
      </div>
      ${opts.includeSignature ? `
        <div style="margin-top:10px;">
          ${
            adultAck
              ? checkboxHtml(!!adultAck.waiver_terms_accepted, "I agree to the waiver")
              : checkboxHtml(!!consentMap.waiver_terms, "I agree to the waiver")
          }
          ${
            adultAck
              ? checkboxHtml(!!adultAck.electronic_signature_accepted, "I agree to use an electronic signature")
              : checkboxHtml(!!consentMap.electronic_signature, "I agree to use an electronic signature")
          }
          ${
            adultAck
              ? checkboxHtml(
                  !!adultAck.signed_by_self_confirmed,
                  "I confirm the additional adult personally reviewed and signed this waiver"
                )
              : ""
          }
          ${
            adultAck && Object.prototype.hasOwnProperty.call(adultAck, "marketing_accepted")
              ? checkboxHtml(!!adultAck.marketing_accepted, "I agree to marketing communications")
              : ""
          }
          ${
            signatureSrc
              ? `<img src="${escapeHtml(signatureSrc)}" alt="${escapeHtml(opts.title)} signature" style="max-width:280px;max-height:120px;border:1px solid #ccc;" crossorigin="anonymous" />`
              : '<div style="color:#666;font-size:11px;">No signature image on file.</div>'
          }
        </div>
      ` : ""}
    </div>`;
  };

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>body{font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#111;margin:0;padding:16px}.waiver-legal-body{margin:16px 0}.waiver-legal-body-preserve{white-space:break-spaces;word-break:break-word}.waiver-legal-body p{margin:.5em 0}</style></head><body>
  ${hasAdditionalAdults ? '<div style="background:#FEF3C7;border:2px solid #F59E0B;border-radius:8px;padding:14px 16px;margin:0 0 20px 0;"><p style="margin:0 0 8px 0;font-weight:bold;font-size:13px;color:#92400e;">Additional adult signers</p><p style="margin:0;font-size:12px;line-height:1.55;color:#451a03;">Each additional adult listed on this waiver must have personally read, agreed to, and signed this document.</p></div>' : ""}
  <div style="text-align:center;border-bottom:2px solid #333;padding-bottom:12px;margin-bottom:20px;">
    ${businessLogoUrl ? `<div style="margin-bottom:12px;"><img src="${escapeHtml(businessLogoUrl)}" alt="${escapeHtml(businessName || "Business")} logo" style="max-width:140px;max-height:80px;" crossorigin="anonymous" /></div>` : ""}
    <div style="font-size:18px;font-weight:bold;">${escapeHtml(businessName || "Business")}</div>
    <div style="font-size:16px;font-weight:bold;margin-top:8px;">${title}</div>
  </div>
  <h2 style="font-size:14px;margin:20px 0 10px 0;">Waiver terms (full text)</h2>
  ${waiverBodyHtml(tpl.waiver_content)}
  <h2 style="font-size:14px;margin:24px 0 10px 0;">Waiver Acknowledgments</h2>
  <div style="padding:12px;border:1px solid #d1d5db;border-radius:8px;background:#fafafa;">
    ${checkboxHtml(primaryConsentStatus.waiverTerms, "I agree to the waiver")}
    ${checkboxHtml(primaryConsentStatus.electronicSignature, "I agree to use an electronic signature")}
    ${checkboxHtml(primaryConsentStatus.marketing, "I agree to marketing communications")}
  </div>
  ${minors.length ? `<h2 style="font-size:14px;margin:24px 0 10px 0;">Children</h2>${minors.map((child) => renderPersonBlock(child, { title: "Child", includeSignature: false })).join("")}` : ""}
  <h2 style="font-size:14px;margin:24px 0 10px 0;">Primary Adult</h2>
  <div style="padding:14px;border:1px solid #dbe4ee;border-radius:8px;background:#fff;">
    <div style="font-weight:bold;font-size:13px;margin-bottom:8px;">${escapeHtml(`${waiver.first_name || ""} ${waiver.last_name || ""}`.trim() || "—")}</div>
    <div style="font-size:12px;line-height:1.6;">
      <div><strong>Date of birth:</strong> ${escapeHtml(formatDateOfBirthDisplay(waiver.date_of_birth, "en-CA"))}</div>
      <div><strong>Email:</strong> ${escapeHtml(waiver.email || "—")}</div>
      <div><strong>Phone:</strong> ${escapeHtml(waiver.phone_number || "—")}</div>
      <div><strong>Mailing address:</strong> ${escapeHtml([waiver.address, waiver.city, waiver.postal_code].filter(Boolean).join(", ") || "—")}</div>
      <div><strong>Signed:</strong> ${escapeHtml(signedPrimary)}</div>
    </div>
    <div style="margin-top:10px;">
      ${checkboxHtml(primaryConsentStatus.waiverTerms, "I agree to the waiver")}
      ${checkboxHtml(primaryConsentStatus.electronicSignature, "I agree to use an electronic signature")}
      ${checkboxHtml(primaryConsentStatus.marketing, "I agree to marketing communications")}
      ${primarySigSrc ? `<img src="${escapeHtml(primarySigSrc)}" alt="Primary signature" style="max-width:280px;max-height:120px;border:1px solid #ccc;" crossorigin="anonymous" />` : '<div style="color:#666;font-size:11px;">No signature image on file for primary signer.</div>'}
    </div>
  </div>
  ${hasAdditionalAdults ? `<div style="margin-top:20px;padding:12px;border:2px solid #1e3a5f;border-radius:6px;background:#f0f7ff;"><div style="font-weight:bold;margin-bottom:10px;font-size:13px;color:#1e3a5f;">Additional Adult Liability Acknowledgment</div>${checkboxHtml(true, "I understand the additional adult must personally read and sign their own waiver")}<div style="padding:10px;background:#fff;border:1px solid #cbd5e1;border-radius:4px;font-size:11px;line-height:1.6;color:#1e293b;">${escapeHtml(disclaimerText || "The primary signer confirmed the additional adult liability acknowledgment before adding another adult to this waiver.")}</div></div>` : ""}
  ${additionalAdults.length ? `<h2 style="font-size:14px;margin:24px 0 10px 0;">Additional Adults</h2>${additionalAdults.map((adult) => renderPersonBlock(adult, { title: "Additional Adult", includeSignature: true, includePortalAccess: true })).join("")}` : ""}
  <div style="margin-top:20px;padding:12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;">
    <div style="font-weight:bold;margin-bottom:8px;font-size:13px;">Where & how this waiver was signed</div>
    <div style="margin-bottom:6px;font-size:12px;line-height:1.45;"><strong>Waiver ID:</strong> ${escapeHtml(String(waiver.id || ""))}</div>
    <div style="margin-bottom:6px;font-size:12px;line-height:1.45;"><strong>Signed:</strong> ${escapeHtml(signedPrimary)}</div>
    <div style="margin-bottom:6px;font-size:12px;line-height:1.45;"><strong>Signing method:</strong> ${escapeHtml(formatSigningSourceLabel(waiver.location_source))}</div>
    ${waiver.location_address ? `<div style="margin-bottom:6px;font-size:12px;line-height:1.45;"><strong>Approx. location:</strong> ${escapeHtml(waiver.location_address)}</div>` : ""}
    ${waiver.ip_address ? `<div style="margin-bottom:6px;font-size:12px;line-height:1.45;"><strong>IP address:</strong> ${escapeHtml(waiver.ip_address)}</div>` : ""}
    ${deviceSummary ? `<div style="margin-bottom:6px;font-size:12px;line-height:1.45;"><strong>Device summary:</strong> ${escapeHtml(deviceSummary)}</div>` : ""}
  </div>
  <div style="margin-top:28px;padding-top:12px;border-top:1px solid #ddd;font-size:10px;color:#666;"><p style="margin:4px 0;">Generated for email/PDF: ${escapeHtml(formatDateTimeDisplay(new Date().toISOString(), businessTimezone))}</p></div>
  </body></html>`;
}

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mime };
}

async function bytesFromUrl(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function resolveSignatureBytes(source: unknown): Promise<Uint8Array | null> {
  if (!source) return null;
  if (typeof source === "object") {
    const objectSource = getSignatureDisplaySrc(null, source);
    if (objectSource) {
      return await resolveSignatureBytes(objectSource);
    }
    return null;
  }
  const text = String(source);
  if (text.startsWith("data:")) {
    const decoded = decodeDataUrl(text);
    return decoded ? decoded.bytes : null;
  }
  if (/^https?:\/\//i.test(text)) {
    return await bytesFromUrl(text);
  }
  return null;
}

/** Split a token that is wider than maxWidth into segments that fit (proportional fonts). */
function breakLongWord(
  word: string,
  widthOf: (s: string) => number,
  maxWidth: number,
): string[] {
  if (!word.length) return [""];
  if (widthOf(word) <= maxWidth) return [word];
  const parts: string[] = [];
  let i = 0;
  while (i < word.length) {
    let j = i + 1;
    while (j <= word.length && widthOf(word.slice(i, j)) <= maxWidth) {
      j++;
    }
    j = Math.max(i + 1, j - 1);
    parts.push(word.slice(i, j));
    i = j;
  }
  return parts;
}

/**
 * Wrap plain text to fit within PDF content width (avoids right-edge clipping from char-count heuristics).
 */
function wrapTextToWidth(
  text: string,
  widthOf: (s: string) => number,
  maxWidth: number,
): string[] {
  const result: string[] = [];
  const paragraphs = String(text || "").replace(/\r/g, "").split("\n");

  for (const paragraph of paragraphs) {
    const words = paragraph.trim().length ? paragraph.split(/\s+/).filter(Boolean) : [];
    if (!words.length) {
      result.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const pieces = breakLongWord(word, widthOf, maxWidth);
      for (const piece of pieces) {
        const attempt = line ? `${line} ${piece}` : piece;
        if (widthOf(attempt) <= maxWidth) {
          line = attempt;
        } else {
          if (line) result.push(line);
          line = piece;
        }
      }
    }
    if (line) result.push(line);
  }
  return result.length ? result : [""];
}

async function buildWaiverPdfBytes(
  waiver: WaiverRow,
  participants: ParticipantRow[],
  businessName: string,
  consents: Record<string, any>[],
  businessLogoUrl = "",
) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [612, 792];
  const margin = 42;
  let page = doc.addPage(pageSize);
  let y = pageSize[1] - margin;

  function ensureRoom(height: number) {
    if (y - height < margin) {
      page = doc.addPage(pageSize);
      y = pageSize[1] - margin;
    }
  }

  const contentWidth = pageSize[0] - 2 * margin;

  function drawLine(text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number] } = {}) {
    const size = opts.size || 11;
    const lineHeight = size * 1.35;
    const pdfFont = opts.bold ? bold : font;
    const widthOf = (s: string) => pdfFont.widthOfTextAtSize(s, size);
    const lines = wrapTextToWidth(text, widthOf, contentWidth);
    for (const line of lines) {
      ensureRoom(lineHeight);
      page.drawText(line || " ", {
        x: margin,
        y,
        size,
        font: pdfFont,
        color: opts.color ? rgb(opts.color[0], opts.color[1], opts.color[2]) : rgb(0, 0, 0),
      });
      y -= lineHeight;
    }
  }

  async function drawSignatureBlock(title: string, imageSource: unknown, fallbackText: string) {
    drawLine(title, { bold: true, size: 11 });
    const bytes = await resolveSignatureBytes(imageSource);
    if (!bytes) {
      drawLine(fallbackText);
      y -= 4;
      return;
    }
    try {
      let img;
      try {
        img = await doc.embedPng(bytes);
      } catch {
        img = await doc.embedJpg(bytes);
      }
      const scale = Math.min(220 / img.width, 90 / img.height, 1);
      const width = img.width * scale;
      const height = img.height * scale;
      ensureRoom(height + 16);
      page.drawRectangle({
        x: margin,
        y: y - height - 4,
        width: width + 8,
        height: height + 8,
        borderWidth: 1,
        borderColor: rgb(0.8, 0.8, 0.8),
      });
      page.drawImage(img, { x: margin + 4, y: y - height, width, height });
      y -= height + 16;
    } catch {
      drawLine(fallbackText);
      y -= 4;
    }
  }

  const businessTimezone = getBusinessTimezone(waiver);
  const consentMap = buildConsentStatusMap(consents);
  const primaryConsentStatus = getPrimaryConsentStatus(waiver, consentMap);
  const waiverText = stripHtmlToText((waiver.waiver_templates || {}).waiver_content || "");
  const signedAt = waiver.signed_at ? formatDateTimeDisplay(waiver.signed_at, businessTimezone) : "—";
  const parts = Array.isArray(participants) ? participants : [];
  const minors = parts.filter((p) => String(p.participant_type || "").toLowerCase() === "minor");
  const additionalAdults = parts.filter((p) => String(p.participant_type || "").toLowerCase() === "additional_adult");
  const acks = Array.isArray(waiver.additional_adult_intent_acknowledgments)
    ? waiver.additional_adult_intent_acknowledgments
    : [];
  const disclaimerText = getAdditionalAdultDisclaimerText(acks);

  if (businessLogoUrl) {
    const logoBytes = await bytesFromUrl(businessLogoUrl);
    if (logoBytes) {
      try {
        let logoImg;
        try {
          logoImg = await doc.embedPng(logoBytes);
        } catch {
          logoImg = await doc.embedJpg(logoBytes);
        }
        const scale = Math.min(140 / logoImg.width, 60 / logoImg.height, 1);
        const width = logoImg.width * scale;
        const height = logoImg.height * scale;
        ensureRoom(height + 12);
        page.drawImage(logoImg, { x: margin, y: y - height, width, height });
        y -= height + 12;
      } catch {
        // Ignore logo rendering failures and continue generating the waiver.
      }
    }
  }

  drawLine(businessName || "Business", { bold: true, size: 18 });
  drawLine((waiver.waiver_templates || {}).waiver_title || (waiver.waiver_templates || {}).template_name || "Waiver", { bold: true, size: 16 });
  y -= 8;
  drawLine("Waiver terms", { bold: true, size: 13 });
  drawLine(waiverText || "No waiver text on file.", { size: 11 });
  y -= 8;
  drawLine("Waiver acknowledgments", { bold: true, size: 13 });
  drawLine(checkboxText(primaryConsentStatus.waiverTerms, "I agree to the waiver"));
  drawLine(checkboxText(primaryConsentStatus.electronicSignature, "I agree to use an electronic signature"));
  drawLine(checkboxText(primaryConsentStatus.marketing, "I agree to marketing communications"));
  y -= 8;

  if (minors.length) {
    drawLine("Children", { bold: true, size: 13 });
    for (const child of minors) {
      drawLine(`${(child.first_name || "")} ${(child.last_name || "")}`.trim() || "—", { bold: true });
      drawLine(`Date of birth: ${formatDateOfBirthDisplay(child.date_of_birth, "en-CA")}`);
      y -= 4;
    }
  }

  drawLine("Primary adult", { bold: true, size: 13 });
  drawLine(`Name: ${(waiver.first_name || "")} ${(waiver.last_name || "")}`.trim());
  drawLine(`Date of birth: ${formatDateOfBirthDisplay(waiver.date_of_birth, "en-CA")}`);
  drawLine(`Email: ${waiver.email || "—"}`);
  drawLine(`Phone: ${waiver.phone_number || "—"}`);
  drawLine(`Mailing address: ${[waiver.address, waiver.city, waiver.postal_code].filter(Boolean).join(", ") || "—"}`);
  drawLine(`Signed: ${signedAt}`);
  drawLine(checkboxText(primaryConsentStatus.waiverTerms, "I agree to the waiver"));
  drawLine(checkboxText(primaryConsentStatus.electronicSignature, "I agree to use an electronic signature"));
  drawLine(checkboxText(primaryConsentStatus.marketing, "I agree to marketing communications"));
  await drawSignatureBlock(
    "Primary signature",
    getSignatureDisplaySrc(waiver.signature_image_url, waiver.signature_data),
    "No signature image on file for primary signer."
  );

  if (additionalAdults.length) {
    drawLine("Additional adult liability acknowledgment", { bold: true, size: 13 });
    drawLine(checkboxText(true, "I understand the additional adult must personally read and sign their own waiver"));
    drawLine(disclaimerText || "The primary signer confirmed the additional adult liability acknowledgment before adding another adult to this waiver.");
    y -= 8;

    drawLine("Additional adults", { bold: true, size: 13 });
    for (const adult of additionalAdults) {
      const fullName = `${adult.first_name || ""} ${adult.last_name || ""}`.trim() || "—";
      const adultAck = findAdultSignerAck(acks, fullName);
      drawLine(fullName, { bold: true });
      drawLine(`Date of birth: ${formatDateOfBirthDisplay(adult.date_of_birth, "en-CA")}`);
      drawLine(`Email: ${adult.email || "—"}`);
      drawLine(`Phone: ${adult.phone_number || "—"}`);
      drawLine(`Mailing address: ${[adult.address, adult.city, adult.postal_code].filter(Boolean).join(", ") || "—"}`);
      if (adult.participant_portal_access) {
        drawLine(`Portal access: ${formatPortalAccessLabel(adult.participant_portal_access)}`);
      }
      drawLine(`Signed: ${adult.signed_at ? formatDateTimeDisplay(adult.signed_at, businessTimezone) : "—"}`);
      drawLine(
        checkboxText(
          adultAck ? !!adultAck.waiver_terms_accepted : !!consentMap.waiver_terms,
          "I agree to the waiver"
        )
      );
      drawLine(
        checkboxText(
          adultAck ? !!adultAck.electronic_signature_accepted : !!consentMap.electronic_signature,
          "I agree to use an electronic signature"
        )
      );
      if (adultAck) {
        drawLine(
          checkboxText(
            !!adultAck.signed_by_self_confirmed,
            "I confirm the additional adult personally reviewed and signed this waiver"
          )
        );
        if (Object.prototype.hasOwnProperty.call(adultAck, "marketing_accepted")) {
          drawLine(
            checkboxText(
              !!adultAck.marketing_accepted,
              "I agree to marketing communications"
            )
          );
        }
      }
      await drawSignatureBlock(
        `${formatParticipantTypeLabel(adult.participant_type)} signature`,
        getSignatureDisplaySrc(adult.signature_image_url, adult.signature_data),
        "No signature image on file."
      );
    }
  }

  drawLine("Where and how this waiver was signed", { bold: true, size: 13 });
  drawLine(`Waiver ID: ${waiver.id || ""}`);
  drawLine(`Signed: ${signedAt}`);
  drawLine(`Signing method: ${formatSigningSourceLabel(waiver.location_source)}`);
  if (waiver.location_address) drawLine(`Approx. location: ${waiver.location_address}`);
  if (waiver.ip_address) drawLine(`IP address: ${waiver.ip_address}`);
  const uaSummary = formatUserAgentSummary(waiver.user_agent);
  if (uaSummary) drawLine(`Device summary: ${uaSummary}`);
  y -= 8;
  drawLine(`Generated for archive/email: ${formatDateTimeDisplay(new Date().toISOString(), businessTimezone)}`, { size: 10 });
  return await doc.save();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      waiverId?: string;
      businessId?: string;
      waiverIds?: string[];
      signatureToken?: string;
      recipientEmail?: string;
      sendEmail?: boolean;
      repairReason?: string;
    };
    const action = String(body?.action || "archive").trim().toLowerCase();
    const waiverId = body?.waiverId?.trim();
    const businessId = body?.businessId?.trim();
    if (!businessId) {
      return jsonResponse({ error: "businessId is required" }, 400);
    }

    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const authContext = await getAuthContext(req);

    if (action === "find_repair_candidates") {
      const access = await requireWaiverPdfRepairAccess(authContext, businessId);
      if (!access.ok) return access.response;
      const candidateWaiverIds = await findRepairCandidateWaiverIds(service, businessId);
      return jsonResponse({
        success: true,
        candidateWaiverIds,
        count: candidateWaiverIds.length,
      });
    }

    if (action === "repair") {
      const access = await requireWaiverPdfRepairAccess(authContext, businessId);
      if (!access.ok) return access.response;

      const waiverIds = Array.from(
        new Set(
          [
            ...(Array.isArray(body.waiverIds) ? body.waiverIds : []),
            waiverId,
          ].map((value) => String(value || "").trim()).filter(Boolean),
        ),
      );

      if (!waiverIds.length) {
        return jsonResponse({ error: "waiverId or waiverIds is required for repair" }, 400);
      }

      const repairedWaiverIds: string[] = [];
      const failedWaivers: Array<{ waiverId: string; error: string }> = [];
      for (const currentWaiverId of waiverIds) {
        try {
          const { data: waiver, error: waiverErr } = await service
            .from("waiver_signatures")
            .select(`
              *,
              waiver_templates:template_id (
                template_name,
                waiver_title,
                waiver_content
              ),
              businesses:business_id (
                name,
                timezone
              )
            `)
            .eq("id", currentWaiverId)
            .eq("business_id", businessId)
            .single();
          if (waiverErr || !waiver) {
            throw new Error(waiverErr?.message || "Waiver not found");
          }

          const [{ data: participants }, { data: branding }, { data: consents }] = await Promise.all([
            service
              .from("waiver_participants")
              .select("*")
              .eq("waiver_id", currentWaiverId)
              .order("created_at", { ascending: true }),
            service
              .from("app_branding")
              .select("logo_url")
              .eq("business_id", businessId)
              .maybeSingle(),
            service
              .from("waiver_consents")
              .select("consent_type, consent_given, consent_text, acknowledged_at")
              .eq("waiver_id", currentWaiverId)
              .order("acknowledged_at", { ascending: true }),
          ]);

          const currentStoragePath =
            waiver.signed_pdf_storage_path ||
            getCanonicalSignedWaiverPdfStoragePath(businessId, currentWaiverId);
          const businessName = String(waiver.businesses?.name || "").trim() || "Tavari";
          const businessLogoUrl = String(branding?.logo_url || "").trim();
          const repairedBytes = await buildWaiverPdfBytes(
            waiver,
            participants || [],
            businessName,
            consents || [],
            businessLogoUrl,
          );

          const { error: uploadError } = await service.storage
            .from("waivers")
            .upload(currentStoragePath, repairedBytes, {
              contentType: "application/pdf",
              upsert: true,
            });
          if (uploadError) {
            throw uploadError;
          }

          const repairedAt = new Date().toISOString();
          await logWaiverPdfRepair(service, {
            actorUserId: access.actorUserId,
            actorRole: access.actorRole,
            waiverId: currentWaiverId,
            businessId,
            storagePath: currentStoragePath,
            repairReason: body.repairReason,
            repairedAt,
          });
          repairedWaiverIds.push(currentWaiverId);
        } catch (error) {
          failedWaivers.push({
            waiverId: currentWaiverId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return jsonResponse({
        success: failedWaivers.length === 0,
        repairedWaiverIds,
        repairedCount: repairedWaiverIds.length,
        failedWaivers,
      }, failedWaivers.length ? 207 : 200);
    }

    if (!waiverId) {
      return jsonResponse({ error: "waiverId and businessId are required" }, 400);
    }

    const { data: waiver, error: waiverErr } = await service
      .from("waiver_signatures")
      .select(`
        *,
        waiver_templates:template_id (
          template_name,
          waiver_title,
          waiver_content
        ),
        businesses:business_id (
          name,
          timezone
        )
      `)
      .eq("id", waiverId)
      .eq("business_id", businessId)
      .single();
    if (waiverErr || !waiver) {
      return jsonResponse({ error: "Waiver not found" }, 404);
    }
    const isAuthedUser = !!authContext.user;
    if (!isAuthedUser && !authContext.isServiceRole && (!body.signatureToken || body.signatureToken !== waiver.signature_token)) {
      return jsonResponse({ error: "Unauthorized waiver archive request" }, 401);
    }

    const { data: participants } = await service
      .from("waiver_participants")
      .select("*")
      .eq("waiver_id", waiverId)
      .order("created_at", { ascending: true });
    const { data: branding } = await service
      .from("app_branding")
      .select("logo_url")
      .eq("business_id", businessId)
      .maybeSingle();
    const { data: consents } = await service
      .from("waiver_consents")
      .select("consent_type, consent_given, consent_text, acknowledged_at")
      .eq("waiver_id", waiverId)
      .order("acknowledged_at", { ascending: true });

    const businessName =
      String(waiver.businesses?.name || "").trim() || "Tavari";
    const businessTimezone = getBusinessTimezone(waiver);
    const businessLogoUrl = String(branding?.logo_url || "").trim();
    const fromName = businessName;

    const storagePath =
      waiver.signed_pdf_storage_path || getCanonicalSignedWaiverPdfStoragePath(businessId, waiverId);

    let pdfBytes: Uint8Array | null = null;
    let archived = false;
    if (waiver.signed_pdf_uploaded_at && waiver.signed_pdf_storage_path) {
      const { data: existingFile } = await service.storage.from("waivers").download(waiver.signed_pdf_storage_path);
      if (existingFile) {
        pdfBytes = new Uint8Array(await existingFile.arrayBuffer());
      }
    }

    if (!pdfBytes) {
      pdfBytes = await buildWaiverPdfBytes(waiver, participants || [], businessName, consents || [], businessLogoUrl);
      const { error: uploadError } = await service.storage
        .from("waivers")
        .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: false });
      const uploadMsg = String(uploadError?.message || "");
      if (uploadError && !/already exists|duplicate|409/i.test(uploadMsg)) {
        return jsonResponse({ error: `Failed to archive PDF: ${uploadMsg}` }, 500);
      }
      if (!waiver.signed_pdf_uploaded_at) {
        const uploadedAt = new Date().toISOString();
        const { error: updateError } = await service
          .from("waiver_signatures")
          .update({
            signed_pdf_storage_path: storagePath,
            signed_pdf_uploaded_at: uploadedAt,
          })
          .eq("id", waiverId)
          .eq("business_id", businessId);
        if (updateError) {
          return jsonResponse({ error: `PDF archived but waiver row update failed: ${updateError.message}` }, 500);
        }
        archived = true;
      }
    }

    let emailed = false;
    let messageId: string | null = null;
    const emailToSendTo = String(body.recipientEmail || waiver.email || "").trim();
    const emailSubject = `Your Waiver from ${businessName}`;
    const emailHTML = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111827;">
<p style="margin:0 0 12px 0;">Here is your waiver from <strong>${escapeHtml(businessName)}</strong>.</p>
<p style="margin:0;">A PDF copy is attached for your records. Thanks for coming out to <strong>${escapeHtml(businessName)}</strong>.</p>
</div>`;
    const emailBody = `Here is your waiver from ${businessName}.

A PDF copy is attached for your records. Thanks for coming out to ${businessName}.`;

    if (body.sendEmail !== false && emailToSendTo) {
      const { data: syncData, error: syncError } = await service.rpc("sync_waiver_mail_contact", {
        p_business_id: businessId,
        p_waiver_id: waiverId,
        p_email: emailToSendTo,
      });
      if (syncError) {
        return jsonResponse({ error: `Failed to sync waiver mail contact: ${syncError.message}` }, 500);
      }

      const syncedContactId =
        syncData && typeof syncData === "object" && "contact_id" in syncData
          ? String(syncData.contact_id || "").trim() || null
          : null;
      const base64Pdf = bytesToBase64(pdfBytes);
      const mailPayload = {
        businessId,
        campaignId: `waiver-${waiverId}-${Date.now()}`,
        contactId: syncedContactId,
        emailType: "transactional",
        to: emailToSendTo,
        fromEmail: "noreply@tavarios.ca",
        fromName,
        subject: emailSubject,
        html: emailHTML,
        text: emailBody,
        attachments: [
          {
            filename: `Waiver - ${waiver.first_name || ""} ${waiver.last_name || ""} - ${formatDateLabelDisplay(waiver.signed_at, businessTimezone)}.pdf`,
            content: base64Pdf,
            contentType: "application/pdf",
          },
        ],
      };
      const mailRes = await fetch(`${SUPABASE_URL}/functions/v1/mail-send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify(mailPayload),
      });
      const mailJson = await mailRes.json().catch(() => null);
      if (!mailRes.ok || !mailJson?.ok) {
        return jsonResponse({
          archived: true,
          emailed: false,
          storagePath,
          error: mailJson?.error || "Failed to send waiver email",
        }, 500);
      }
      emailed = true;
      messageId = mailJson?.messageId || null;

      const contactId = syncedContactId;
      if (contactId) {
        await service.from("mail_contact_communications").insert({
          contact_id: contactId,
          communication_type: "email",
          direction: "outbound",
          subject: emailSubject,
          content: emailBody,
          status: "sent",
          sent_at: new Date().toISOString(),
        });
      }
    }

    return jsonResponse({
      success: true,
      archived: archived || !!waiver.signed_pdf_uploaded_at,
      emailed,
      messageId,
      storagePath,
      recipientEmail: emailToSendTo || null,
    });
  } catch (error) {
    console.error("[waiver-archive-email] Unhandled error:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
