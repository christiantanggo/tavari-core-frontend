import { BOOKING_TRANSACTIONAL_FROM_EMAIL } from "./bookingTransactionalMail.ts";
import { escapeHtml } from "./bookingTransactionalEmail.ts";
import {
  resolveBookingMailRecipients,
  withBookingMailRecipients,
  type BookingMailRecipients,
} from "./bookingRecipientEmail.ts";

export type ParticipantSummaryRow = {
  name: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  attending?: boolean;
};

export type BookerSummary = {
  name: string;
  email?: string | null;
  phone?: string | null;
  birthdayChild?: string | null;
};

export type BookingParticipantsSummaryInput = {
  businessName: string;
  bookingNumber: string;
  activityName: string;
  bookingDate: string;
  bookingTime: string;
  booker: BookerSummary;
  participants: ParticipantSummaryRow[];
};

const formatField = (value: string | null | undefined) => {
  const text = String(value || "").trim();
  return text ? escapeHtml(text) : "—";
};

export function buildBookingParticipantsSummaryEmail(input: BookingParticipantsSummaryInput) {
  const businessName = escapeHtml(input.businessName || "Tavari");
  const bookingNumber = escapeHtml(input.bookingNumber || "—");
  const activityName = escapeHtml(input.activityName || "Activity");
  const bookingDate = escapeHtml(input.bookingDate || "—");
  const bookingTime = escapeHtml(input.bookingTime || "—");

  const booker = input.booker || { name: "—" };
  const participants = Array.isArray(input.participants) ? input.participants : [];

  const participantRowsHtml = participants.length
    ? participants.map((participant) => {
      const attending = participant.attending !== false;
      const role = participant.role ? ` (${escapeHtml(participant.role)})` : "";
      const status = attending
        ? `<span style="color:#15803d;font-weight:600;">Attending</span>`
        : `<span style="color:#6b7280;">Not attending</span>`;
      const contactParts = [
        participant.email ? `Email: ${formatField(participant.email)}` : "",
        participant.phone ? `Phone: ${formatField(participant.phone)}` : "",
      ].filter(Boolean);

      return `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;vertical-align:top;">
            <div style="font-weight:600;color:#111827;">${formatField(participant.name)}${role}</div>
            ${contactParts.length
        ? `<div style="margin-top:4px;font-size:13px;color:#6b7280;">${contactParts.join(" · ")}</div>`
        : ""}
          </td>
          <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:right;vertical-align:top;font-size:13px;">
            ${status}
          </td>
        </tr>
      `;
    }).join("")
    : `<tr><td colspan="2" style="padding:12px 0;color:#6b7280;">No participants listed.</td></tr>`;

  const participantRowsText = participants.length
    ? participants.map((participant) => {
      const attending = participant.attending !== false ? "Attending" : "Not attending";
      const role = participant.role ? ` (${participant.role})` : "";
      const contactParts = [
        participant.email ? `Email: ${participant.email}` : "",
        participant.phone ? `Phone: ${participant.phone}` : "",
      ].filter(Boolean);
      return `- ${participant.name || "—"}${role} — ${attending}${contactParts.length ? ` — ${contactParts.join(", ")}` : ""}`;
    }).join("\n")
    : "No participants listed.";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #000;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      background-color: #fff;
    }
    .header {
      text-align: center;
      border-bottom: 1px solid #2563eb;
      padding-bottom: 8px;
      margin-bottom: 16px;
    }
    .company-name { font-size: 16px; font-weight: bold; color: #2563eb; margin-bottom: 2px; }
    .statement-title { font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; }
    .row { margin-bottom: 10px; font-size: 14px; }
    .label { font-weight: 600; color: #374151; margin-bottom: 2px; }
    .value { color: #111; }
    .section { margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
    .footer { margin-top: 24px; font-size: 11px; color: #6b7280; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="company-name">${businessName}</div>
    <div class="statement-title">Party participant summary</div>
  </div>
  <p style="font-size:14px;color:#374151;margin:0 0 16px;">
    Here is the party booker and participant information for this booking.
  </p>
  <div class="section" style="margin-top:0;padding-top:0;border-top:none;">
    <div class="label">Party booker</div>
    <div class="row"><span class="label">Name:</span> <span class="value">${formatField(booker.name)}</span></div>
    <div class="row"><span class="label">Birthday child:</span> <span class="value">${formatField(booker.birthdayChild)}</span></div>
    <div class="row"><span class="label">Email on file:</span> <span class="value">${formatField(booker.email)}</span></div>
    <div class="row"><span class="label">Phone on file:</span> <span class="value">${formatField(booker.phone)}</span></div>
  </div>
  <div class="section">
    <div class="label">Booking details</div>
    <div class="row"><span class="label">Booking number:</span> <span class="value">${bookingNumber}</span></div>
    <div class="row"><span class="label">Activity:</span> <span class="value">${activityName}</span></div>
    <div class="row"><span class="label">Date:</span> <span class="value">${bookingDate}</span></div>
    <div class="row"><span class="label">Time:</span> <span class="value">${bookingTime}</span></div>
  </div>
  <div class="section">
    <div class="label">Participants</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${participantRowsHtml}
    </table>
  </div>
  <div class="footer">This summary was sent by ${businessName} through Tavari.</div>
</body>
</html>`;

  const textBody = [
    `Party participant summary - ${input.bookingNumber || "Booking"}`,
    "",
    "Party booker",
    `Name: ${booker.name || "—"}`,
    `Birthday child: ${booker.birthdayChild || "—"}`,
    `Email on file: ${booker.email || "—"}`,
    `Phone on file: ${booker.phone || "—"}`,
    "",
    "Booking details",
    `Booking number: ${input.bookingNumber || "—"}`,
    `Activity: ${input.activityName || "Activity"}`,
    `Date: ${input.bookingDate || "—"}`,
    `Time: ${input.bookingTime || "—"}`,
    "",
    "Participants",
    participantRowsText,
    "",
    `This summary was sent by ${input.businessName || "Tavari"} through Tavari.`,
  ].join("\n");

  return { html, text: textBody };
}

export async function sendBookingParticipantsSummaryEmail(
  supabase: { from: (table: string) => any },
  supabaseUrl: string,
  serviceRoleKey: string,
  params: {
    businessId: string;
    bookingId: string;
    recipients: BookingMailRecipients;
    booker: BookerSummary;
    participants: ParticipantSummaryRow[];
  },
) {
  const { businessId, bookingId, recipients, booker, participants } = params;

  const { data: booking, error: bookingErr } = await supabase
    .from("bookings")
    .select("id, booking_number, booking_date, booking_time, activity_id, business_id")
    .eq("id", bookingId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (bookingErr || !booking) {
    return { ok: false as const, status: 404, error: "Booking not found" };
  }

  const [businessRes, activityRes] = await Promise.all([
    supabase.from("businesses").select("id, name").eq("id", businessId).maybeSingle(),
    booking.activity_id
      ? supabase.from("booking_activities").select("id, activity_name").eq("id", booking.activity_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const businessName = String(businessRes.data?.name || "Tavari");
  const activityName = String(activityRes.data?.activity_name || "Activity");
  const bookingNumber = String(booking.booking_number || booking.id).slice(0, 8);
  const bookingDateFormatted = booking.booking_date
    ? new Date(`${booking.booking_date}T12:00:00`).toLocaleDateString("en-CA", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })
    : String(booking.booking_date || "—");

  const { html, text } = buildBookingParticipantsSummaryEmail({
    businessName,
    bookingNumber,
    activityName,
    bookingDate: bookingDateFormatted,
    bookingTime: String(booking.booking_time || "—"),
    booker,
    participants,
  });

  const mailPayload = withBookingMailRecipients({
    businessId,
    campaignId: `participants-summary-${bookingId}`,
    contactId: `participants-summary-${bookingId}-${Date.now()}`,
    emailType: "transactional",
    fromEmail: BOOKING_TRANSACTIONAL_FROM_EMAIL,
    fromName: `${businessName} - Booking`,
    subject: `Party participant summary - ${bookingDateFormatted}`,
    html,
    text,
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
    return { ok: false as const, status: 502, error: errText || "Failed to send email" };
  }

  return {
    ok: true as const,
    status: 200,
    to: recipients.to,
    cc: recipients.cc || null,
  };
}
