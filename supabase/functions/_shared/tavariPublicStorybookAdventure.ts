import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveBusinessAddress,
  resolveBusinessName,
} from "./mailBusinessProfile.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STORYBOOK_FROM_NAME = "Tanggo's Storybook Adventure";
const STORYBOOK_EMAIL_SUBJECT =
  "Your Promo Code for 50% off Admission At Off The Wall Kids";

export type StorybookFulfillmentInput = {
  businessId: string;
  entryId: string;
  email: string;
  parentFirstName: string;
  childFirstName?: string | null;
  promoCode: string;
  promoOffer: string;
  promoExpiry?: string | null;
  bookNowUrl?: string | null;
  consentContact: boolean;
  consentEmailMarketing?: boolean;
  phone?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  consentText?: string | null;
};

export type StorybookFulfillmentResult = {
  ok: boolean;
  emailSent: boolean;
  emailSkippedReason?: string | null;
  contactId?: string | null;
  marketingSubscribed: boolean;
  alreadyFulfilled?: boolean;
};

function normalizeEmail(value: string) {
  return String(value || "").trim().toLowerCase();
}

function splitFirstName(fullName: string) {
  const trimmed = String(fullName || "").trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  const parts = trimmed.split(/\s+/);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" ") || "",
  };
}

function formatPromoExpiry(value?: string | null) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  return parsed.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Toronto",
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildPromoEmailHtml(params: {
  businessName: string;
  businessAddress: string;
  parentFirstName: string;
  childFirstName?: string | null;
  promoCode: string;
  promoOffer: string;
  promoExpiry?: string | null;
  bookNowUrl?: string | null;
}) {
  const greetingName = escapeHtml(params.parentFirstName.trim() || "Explorer");
  const childLine = params.childFirstName?.trim()
    ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#334155;">Thanks for helping <strong>${escapeHtml(params.childFirstName.trim())}</strong> complete Tanggo&apos;s Storybook Explorer Adventure!</p>`
    : `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#334155;">Thanks for completing Tanggo&apos;s Storybook Explorer Adventure!</p>`;
  const expiryLine = params.promoExpiry
    ? `<p style="margin:14px 0 0;font-size:14px;line-height:1.5;color:#64748b;">Use by <strong style="color:#0f172a;">${escapeHtml(params.promoExpiry)}</strong></p>`
    : "";
  const bookNowUrl = String(params.bookNowUrl || "").trim();
  const bookNowBlock = bookNowUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px auto 8px;">
        <tr>
          <td align="center" style="border-radius:999px;background:#f97316;">
            <a href="${escapeHtml(bookNowUrl)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">Book Now</a>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#64748b;text-align:center;">Enter your promo code at checkout to save 50% on one child&apos;s admission.</p>`
    : "";

  return `
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f8fafc;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fafc;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr>
              <td style="background:linear-gradient(135deg,#0f2b4a 0%,#1e3a5f 55%,#f97316 160%);padding:28px 24px;text-align:center;">
                <div style="font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:#fed7aa;margin-bottom:8px;">Adventure complete</div>
                <div style="font-size:28px;line-height:1.2;font-weight:800;color:#ffffff;">Tanggo&apos;s Storybook Adventure</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 24px 12px;">
                <p style="margin:0 0 12px;font-size:18px;line-height:1.5;color:#0f172a;font-weight:700;">Hi ${greetingName},</p>
                ${childLine}
                <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#334155;">Your reward is ready. Use the promo code below for <strong>50% off one child&apos;s general admission</strong> at ${escapeHtml(params.businessName)}.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 8px;">
                  <tr>
                    <td align="center" style="padding:22px 18px;border:2px dashed #fb923c;border-radius:16px;background:#fff7ed;">
                      <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#9a3412;font-weight:700;">Promo code</div>
                      <div style="margin-top:10px;font-size:34px;line-height:1.1;font-weight:800;letter-spacing:5px;color:#0f2b4a;">${escapeHtml(params.promoCode)}</div>
                      <div style="margin-top:12px;font-size:16px;line-height:1.5;color:#7c2d12;font-weight:600;">${escapeHtml(params.promoOffer)}</div>
                      ${expiryLine}
                    </td>
                  </tr>
                </table>
                ${bookNowBlock}
              </td>
            </tr>
            <tr>
              <td style="padding:8px 24px 28px;">
                <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">Valid for one child&apos;s general admission per family. Cannot be combined with other offers.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;text-align:center;">
                  ${escapeHtml(params.businessName)}<br>
                  ${escapeHtml(params.businessAddress)}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();
}

function buildPromoEmailText(params: {
  businessName: string;
  businessAddress: string;
  parentFirstName: string;
  childFirstName?: string | null;
  promoCode: string;
  promoOffer: string;
  promoExpiry?: string | null;
  bookNowUrl?: string | null;
}) {
  const greetingName = params.parentFirstName.trim() || "Explorer";
  const childLine = params.childFirstName?.trim()
    ? `Thanks for helping ${params.childFirstName.trim()} complete Tanggo's Storybook Explorer Adventure!`
    : "Thanks for completing Tanggo's Storybook Explorer Adventure!";
  const expiryLine = params.promoExpiry ? `\nUse by: ${params.promoExpiry}` : "";
  const bookNowUrl = String(params.bookNowUrl || "").trim();
  const bookNowLine = bookNowUrl ? `\nBook now: ${bookNowUrl}` : "";

  return [
    `Hi ${greetingName},`,
    "",
    childLine,
    "",
    "Your reward is ready:",
    `Promo code: ${params.promoCode}`,
    params.promoOffer,
    expiryLine,
    bookNowLine,
    "",
    "Valid for one child's general admission per family. Cannot be combined with other offers.",
    "",
    params.businessName,
    params.businessAddress,
  ].filter(Boolean).join("\n");
}

async function hasExistingPromoEmail(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  entryId: string,
) {
  const { data, error } = await supabase
    .from("system_email_log")
    .select("id")
    .eq("business_id", businessId)
    .eq("source_module", "storybook_adventure")
    .eq("source_id", entryId)
    .eq("status", "sent")
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.id);
}

async function sendPromoEmail(
  supabase: ReturnType<typeof createClient>,
  input: StorybookFulfillmentInput,
  contactId: string | null,
) {
  const [{ data: business }, { data: settings }] = await Promise.all([
    supabase
      .from("businesses")
      .select("name, business_address")
      .eq("id", input.businessId)
      .maybeSingle(),
    supabase
      .from("mail_settings")
      .select("from_email, from_name, business_address, configuration_set")
      .eq("business_id", input.businessId)
      .maybeSingle(),
  ]);

  const businessName = resolveBusinessName(business, settings, "Off The Wall Kids");
  const businessAddress = resolveBusinessAddress(settings, business);
  const fromEmail = String(settings?.from_email || "noreply@tavarios.ca").trim();
  const promoExpiry = formatPromoExpiry(input.promoExpiry);
  const html = buildPromoEmailHtml({
    businessName,
    businessAddress,
    parentFirstName: input.parentFirstName,
    childFirstName: input.childFirstName,
    promoCode: input.promoCode,
    promoOffer: input.promoOffer,
    promoExpiry,
    bookNowUrl: input.bookNowUrl,
  });
  const text = buildPromoEmailText({
    businessName,
    businessAddress,
    parentFirstName: input.parentFirstName,
    childFirstName: input.childFirstName,
    promoCode: input.promoCode,
    promoOffer: input.promoOffer,
    promoExpiry,
    bookNowUrl: input.bookNowUrl,
  });

  const mailResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || ""}`,
    },
    body: JSON.stringify({
      businessId: input.businessId,
      contactId,
      campaignId: `storybook-adventure-${input.entryId}`,
      emailType: "transactional",
      sourceModule: "storybook_adventure",
      sourceId: input.entryId,
      to: input.email,
      fromEmail,
      fromName: STORYBOOK_FROM_NAME,
      subject: STORYBOOK_EMAIL_SUBJECT,
      html,
      text,
      configurationSet: settings?.configuration_set || undefined,
    }),
  });

  const mailPayload = await mailResponse.json().catch(() => ({}));
  if (!mailResponse.ok) {
    throw new Error(
      String((mailPayload as { error?: string }).error || `mail-send failed (${mailResponse.status})`),
    );
  }

  return true;
}

async function syncMailContact(
  supabase: ReturnType<typeof createClient>,
  input: StorybookFulfillmentInput,
) {
  const email = normalizeEmail(input.email);
  const { firstName, lastName } = splitFirstName(input.parentFirstName);
  const nowIso = new Date().toISOString();
  const marketingOptIn = Boolean(input.consentEmailMarketing);
  const consentText = String(input.consentText || "").trim()
    || (marketingOptIn
      ? "Email marketing consent granted during Storybook Explorer Adventure submission."
      : null);

  const { data: existingContact, error: lookupError } = await supabase
    .from("mail_contacts")
    .select("id, email, subscribed")
    .eq("business_id", input.businessId)
    .ilike("email", email)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lookupError) throw lookupError;

  let contactId = existingContact?.id || null;

  if (contactId) {
    const updatePayload: Record<string, unknown> = {
      first_name: firstName || null,
      last_name: lastName || null,
      phone: input.phone || null,
      source: "storybook_adventure",
      updated_at: nowIso,
    };

    if (marketingOptIn) {
      Object.assign(updatePayload, {
        subscribed: true,
        unsubscribed_at: null,
        consent_source: "storybook_adventure",
        consent_timestamp: nowIso,
        consent_ip_address: input.ipAddress || null,
        consent_user_agent: input.userAgent || null,
        consent_method: "express",
        consent_text: consentText,
      });
    }

    const { error: updateError } = await supabase
      .from("mail_contacts")
      .update(updatePayload)
      .eq("id", contactId)
      .eq("business_id", input.businessId);

    if (updateError) throw updateError;
  } else {
    const { data: insertedContact, error: insertError } = await supabase
      .from("mail_contacts")
      .insert({
        business_id: input.businessId,
        email,
        first_name: firstName || null,
        last_name: lastName || null,
        phone: input.phone || null,
        subscribed: marketingOptIn,
        unsubscribed_at: null,
        source: "storybook_adventure",
        consent_source: marketingOptIn ? "storybook_adventure" : null,
        consent_timestamp: marketingOptIn ? nowIso : null,
        consent_ip_address: marketingOptIn ? input.ipAddress || null : null,
        consent_user_agent: marketingOptIn ? input.userAgent || null : null,
        consent_method: marketingOptIn ? "express" : null,
        consent_text: marketingOptIn ? consentText : null,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id")
      .single();

    if (insertError) throw insertError;
    contactId = insertedContact.id;
  }

  if (marketingOptIn && contactId) {
    await supabase
      .from("mail_unsubscribes")
      .delete()
      .eq("business_id", input.businessId)
      .eq("email", email);

    const { error: logError } = await supabase
      .from("mail_consent_log")
      .insert({
        business_id: input.businessId,
        contact_id: contactId,
        email_address: email,
        action: "subscribe",
        consent_source: "storybook_adventure",
        consent_method: "express",
        consent_text: consentText,
        ip_address: input.ipAddress || null,
        user_agent: input.userAgent || null,
        additional_data: {
          entry_id: input.entryId,
          child_first_name: input.childFirstName || null,
        },
      });

    if (logError) throw logError;
  }

  return {
    contactId,
    marketingSubscribed: marketingOptIn || Boolean(existingContact?.subscribed),
  };
}

export function validateStorybookFulfillmentInput(
  raw: Record<string, unknown>,
): { ok: true; input: StorybookFulfillmentInput } | { ok: false; error: string } {
  const businessId = String(raw.businessId ?? raw.business_id ?? "").trim();
  const entryId = String(raw.entryId ?? raw.entry_id ?? "").trim();
  const email = normalizeEmail(String(raw.email ?? ""));
  const parentFirstName = String(raw.parentFirstName ?? raw.parent_first_name ?? "").trim();
  const promoCode = String(raw.promoCode ?? raw.promo_code ?? "STORYBOOK50").trim() || "STORYBOOK50";
  const promoOffer = String(raw.promoOffer ?? raw.promo_offer ?? "").trim();

  if (!businessId) return { ok: false, error: "businessId is required." };
  if (!entryId) return { ok: false, error: "entryId is required." };
  if (!email || !EMAIL_RE.test(email)) return { ok: false, error: "A valid email is required." };
  if (!parentFirstName) return { ok: false, error: "parentFirstName is required." };
  if (!promoOffer) return { ok: false, error: "promoOffer is required." };

  const consentContact = raw.consentContact ?? raw.consent_contact;
  const consentEmailMarketing = raw.consentEmailMarketing ?? raw.consent_email_marketing;

  return {
    ok: true,
    input: {
      businessId,
      entryId,
      email,
      parentFirstName,
      childFirstName: String(raw.childFirstName ?? raw.child_first_name ?? "").trim() || null,
      promoCode,
      promoOffer,
      promoExpiry: String(raw.promoExpiry ?? raw.promo_expiry ?? "").trim() || null,
      bookNowUrl: String(raw.bookNowUrl ?? raw.book_now_url ?? "").trim() || null,
      consentContact: consentContact === true || consentContact === "true" || consentContact === 1,
      consentEmailMarketing:
        consentEmailMarketing === true
        || consentEmailMarketing === "true"
        || consentEmailMarketing === 1,
      phone: String(raw.phone ?? "").trim() || null,
      ipAddress: String(raw.ipAddress ?? raw.ip_address ?? "").trim() || null,
      userAgent: String(raw.userAgent ?? raw.user_agent ?? "").trim() || null,
      consentText: String(raw.consentText ?? raw.consent_text ?? "").trim() || null,
    },
  };
}

export async function fulfillStorybookAdventureSubmission(
  supabase: ReturnType<typeof createClient>,
  input: StorybookFulfillmentInput,
): Promise<StorybookFulfillmentResult> {
  const alreadyFulfilled = await hasExistingPromoEmail(supabase, input.businessId, input.entryId);
  const { contactId, marketingSubscribed } = await syncMailContact(supabase, input);

  if (alreadyFulfilled) {
    return {
      ok: true,
      emailSent: false,
      emailSkippedReason: "already_fulfilled",
      contactId,
      marketingSubscribed,
      alreadyFulfilled: true,
    };
  }

  if (!input.consentContact) {
    return {
      ok: true,
      emailSent: false,
      emailSkippedReason: "contact_consent_required",
      contactId,
      marketingSubscribed,
    };
  }

  await sendPromoEmail(supabase, input, contactId);

  return {
    ok: true,
    emailSent: true,
    contactId,
    marketingSubscribed,
  };
}
