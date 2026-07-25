import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  normalizeBookingEmail,
  resolveBookingMailRecipients,
  withBookingMailRecipients,
} from "../_shared/bookingRecipientEmail.ts";
import { BOOKING_TRANSACTIONAL_FROM_EMAIL } from "../_shared/bookingTransactionalMail.ts";
import { formatDateTimeInBusinessTimezone } from "../_shared/bookingTransactionalEmail.ts";
import { getBusinessTimezone } from "../_shared/bookingScheduleResources.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const DIGITAL_ACK =
  "I acknowledge that this is my digital signature and has the same legal effect as a handwritten signature";
const SIGNING_CONFIRMATION =
  "By signing, the signer confirmed that they have read and agree to all Terms & Conditions steps for this booking.";

function jsonResponse(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatSignedAt(iso: string | null | undefined, timeZone: string) {
  if (!iso) return "—";
  return formatDateTimeInBusinessTimezone(String(iso), timeZone);
}

function paragraphsHtml(body: string) {
  const text = String(body || "").trim();
  if (!text) return '<p style="margin:0 0 4px;color:#6b7280;">(No content)</p>';
  return text
    .split(/\n+/)
    .filter(Boolean)
    .map((paragraph) => `<p style="margin:0 0 4px;line-height:1.25;">${esc(paragraph)}</p>`)
    .join("");
}

function buildDocumentHtml(input: {
  businessName: string;
  packageName: string;
  packageDescription: string;
  bookingNumber: string;
  activityName: string;
  timeZone: string;
  sections: Array<{
    title: string;
    body: string;
    acknowledgedAt: string | null;
  }>;
  signerName: string;
  signedAt: string | null;
  signatureImageUrl: string;
  signedIp: string | null;
}) {
  const sectionsHtml = input.sections.map((section, index) => `
    <section style="margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid #e5e7eb;">
      <h2 style="margin:0 0 4px;font-size:11px;font-weight:700;color:#111827;line-height:1.2;">
        ${index + 1}. ${esc(section.title)}
      </h2>
      <div style="font-size:9px;color:#374151;">${paragraphsHtml(section.body)}</div>
      <div style="margin-top:4px;padding:3px 6px;border-radius:4px;background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;font-size:8px;font-weight:600;line-height:1.2;">
        Acknowledged${section.acknowledgedAt ? ` · ${esc(formatSignedAt(section.acknowledgedAt, input.timeZone))}` : ""}
      </div>
    </section>
  `).join("");

  return `
  <div style="max-width:720px;margin:0 auto;padding:14px 12px;font-family:Arial,Helvetica,sans-serif;color:#111827;background:#ffffff;font-size:9px;line-height:1.25;">
    <div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1.5px solid #0d9488;">
      <div style="font-size:8px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#0d9488;margin-bottom:2px;">
        ${esc(input.businessName)}
      </div>
      <h1 style="margin:0;font-size:14px;font-weight:800;line-height:1.15;">${esc(input.packageName)}</h1>
      ${input.packageDescription
        ? `<p style="margin:4px 0 0;font-size:9px;color:#4b5563;line-height:1.25;">${esc(input.packageDescription)}</p>`
        : ""}
      <p style="margin:3px 0 0;font-size:8px;color:#6b7280;line-height:1.2;">
        ${esc(input.activityName || "Activity")}${input.bookingNumber ? ` · Booking #${esc(input.bookingNumber)}` : ""}
      </p>
      <p style="margin:3px 0 0;font-size:8px;font-weight:600;color:#065f46;line-height:1.2;">Status: Signed</p>
    </div>
    ${sectionsHtml || '<p style="color:#6b7280;font-size:9px;">No terms sections found.</p>'}
    <section style="margin-top:4px;">
      <h2 style="margin:0 0 4px;font-size:11px;font-weight:700;line-height:1.2;">Signature</h2>
      <p style="margin:0 0 4px;font-size:9px;line-height:1.25;color:#374151;">${esc(SIGNING_CONFIRMATION)}</p>
      <div style="margin:0 0 6px;padding:4px 6px;border-radius:4px;background:#f0fdfa;border:1px solid #99f6e4;font-size:8px;color:#0f766e;font-weight:600;line-height:1.2;">
        ${esc(DIGITAL_ACK)}
      </div>
      <div style="font-size:9px;margin-bottom:6px;line-height:1.25;">
        <div><strong>Signer:</strong> ${esc(input.signerName || "—")}</div>
        <div><strong>Signed:</strong> ${esc(formatSignedAt(input.signedAt, input.timeZone))}</div>
        ${input.signedIp ? `<div><strong>IP address:</strong> ${esc(input.signedIp)}</div>` : ""}
      </div>
      ${input.signatureImageUrl
        ? `<div style="border:1px solid #d1d5db;border-radius:6px;padding:6px;background:#fff;max-width:220px;">
            <img src="${esc(input.signatureImageUrl)}" alt="Signature" style="max-width:100%;max-height:72px;height:auto;display:block;" />
          </div>`
        : '<p style="color:#6b7280;font-size:9px;margin:0;">No signature image on file.</p>'}
    </section>
  </div>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const businessId = String(body.businessId || body.business_id || "").trim();
    const bookingId = String(body.bookingId || body.booking_id || "").trim();
    const sendToCustomer = body.sendToCustomer !== false && body.send_to_customer !== false;

    if (!businessId || !bookingId) {
      return jsonResponse({ error: "Missing businessId or bookingId" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user?.id) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const { data: membership } = await supabase
      .from("business_users")
      .select("role")
      .eq("business_id", businessId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select(`
        id,
        booking_number,
        customer_email,
        secondary_customer_email,
        customer_id,
        activity_id,
        terms_package_id,
        terms_status,
        terms_signed_at,
        terms_signer_name,
        terms_signature_data,
        terms_signed_ip
      `)
      .eq("id", bookingId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (bookingErr || !booking) {
      return jsonResponse({ error: "Booking not found" }, 404);
    }

    if (booking.terms_status !== "signed") {
      return jsonResponse({ error: "Terms & Conditions have not been signed yet." }, 400);
    }
    if (!booking.terms_package_id) {
      return jsonResponse({ error: "This booking has no Terms & Conditions package." }, 400);
    }

    let recipients = await resolveBookingMailRecipients(supabase, booking, businessId);
    if (!sendToCustomer) {
      const overrideEmail = normalizeBookingEmail(body.recipientEmail || body.recipient_email);
      if (!overrideEmail) {
        return jsonResponse({ error: "A valid recipient email is required" }, 400);
      }
      recipients = { to: overrideEmail };
    }
    if (!recipients) {
      return jsonResponse({ error: "No customer email on this booking" }, 400);
    }

    const [
      { data: pkg },
      { data: acknowledgments },
      { data: business },
      { data: activity },
      businessTimezone,
    ] = await Promise.all([
      supabase
        .from("booking_terms_packages")
        .select("id, name, description")
        .eq("id", booking.terms_package_id)
        .eq("business_id", businessId)
        .maybeSingle(),
      supabase
        .from("booking_terms_acknowledgments")
        .select("step_order, step_title_snapshot, step_body_snapshot, acknowledged_at")
        .eq("booking_id", bookingId)
        .eq("business_id", businessId)
        .order("step_order", { ascending: true }),
      supabase.from("businesses").select("name").eq("id", businessId).maybeSingle(),
      booking.activity_id
        ? supabase.from("booking_activities").select("activity_name").eq("id", booking.activity_id).maybeSingle()
        : Promise.resolve({ data: null }),
      getBusinessTimezone(supabase, businessId),
    ]);

    const signatureData = booking.terms_signature_data && typeof booking.terms_signature_data === "object"
      ? booking.terms_signature_data as Record<string, unknown>
      : {};
    const signatureImageUrl = typeof signatureData.imageUrl === "string"
      ? signatureData.imageUrl
      : typeof signatureData.image_url === "string"
      ? signatureData.image_url
      : "";

    const businessName = String(business?.name || "Tavari");
    const packageName = String(pkg?.name || "Terms & Conditions");
    const bookingNumber = String(booking.booking_number || "").trim();
    const activityName = String(activity?.activity_name || "Activity");

    const documentHtml = buildDocumentHtml({
      businessName,
      packageName,
      packageDescription: String(pkg?.description || ""),
      bookingNumber,
      activityName,
      timeZone: businessTimezone,
      sections: (acknowledgments || []).map((row) => ({
        title: String(row.step_title_snapshot || "Section"),
        body: String(row.step_body_snapshot || ""),
        acknowledgedAt: row.acknowledged_at || null,
      })),
      signerName: String(booking.terms_signer_name || ""),
      signedAt: booking.terms_signed_at || null,
      signatureImageUrl,
      signedIp: booking.terms_signed_ip || null,
    });

    const signedLabel = formatSignedAt(booking.terms_signed_at, businessTimezone);
    const intro = sendToCustomer
      ? `Attached is a copy of the signed Terms & Conditions for booking #${bookingNumber || bookingId}.`
      : `A copy of the signed Terms & Conditions for booking #${bookingNumber || bookingId} (${businessName}) is below.`;

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:12px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:720px;margin:0 auto;">
    <p style="margin:0 0 8px;font-size:12px;color:#334155;line-height:1.35;">${esc(intro)}</p>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      ${documentHtml}
    </div>
  </div>
</body>
</html>`;

    const text = [
      intro,
      "",
      `Package: ${packageName}`,
      `Booking: #${bookingNumber || bookingId}`,
      `Signer: ${booking.terms_signer_name || "—"}`,
      `Signed: ${signedLabel}`,
      "",
      DIGITAL_ACK,
      "",
      `Sent by ${businessName} through Tavari.`,
    ].join("\n");

    const attachments: Array<{ filename: string; content: string; contentType: string }> = [];
    const attachment = body.attachment && typeof body.attachment === "object"
      ? body.attachment as Record<string, unknown>
      : null;
    if (attachment) {
      const filename = String(attachment.filename || "Terms-and-Conditions.pdf").trim() || "Terms-and-Conditions.pdf";
      const content = String(attachment.content || "").trim();
      const contentType = String(attachment.contentType || attachment.content_type || "application/pdf").trim()
        || "application/pdf";
      if (content) {
        attachments.push({ filename, content, contentType });
      }
    }

    const mailPayload = withBookingMailRecipients({
      businessId,
      campaignId: `booking-terms-doc-${bookingId}`,
      contactId: `booking-terms-doc-${bookingId}-${Date.now()}`,
      emailType: "transactional" as const,
      fromEmail: BOOKING_TRANSACTIONAL_FROM_EMAIL,
      fromName: `${businessName} - Booking`,
      subject: `Signed Terms & Conditions - ${bookingNumber || "Booking"}`,
      html,
      text,
      ...(attachments.length ? { attachments } : {}),
    }, recipients);

    const mailResponse = await fetch(`${supabaseUrl}/functions/v1/mail-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify(mailPayload),
    });

    if (!mailResponse.ok) {
      const errText = await mailResponse.text();
      return jsonResponse({ error: errText || "Failed to send email" }, 502);
    }

    return jsonResponse({
      sent: true,
      to: recipients.to,
      cc: recipients.cc || null,
    }, 200);
  } catch (error) {
    console.error("send-booking-terms-document error:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Internal error" }, 500);
  }
});
