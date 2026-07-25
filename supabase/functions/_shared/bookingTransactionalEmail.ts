import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const BOOKING_EMAIL_ACCENT = "#008080";

export interface BookingEmailBusinessContext {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  addressLine: string | null;
  logoUrl: string | null;
}

export interface BookingEmailDetailRow {
  label: string;
  value: string;
}

export interface BookingEmailAction {
  label: string;
  url: string;
}

export interface BookingTransactionalEmailInput {
  business: BookingEmailBusinessContext;
  eyebrow: string;
  headline: string;
  intro: string;
  details: BookingEmailDetailRow[];
  steps?: string[];
  note?: string;
  primaryAction?: BookingEmailAction;
  secondaryAction?: BookingEmailAction;
  /** When true, secondary CTA is styled as a second primary button (equal prominence). */
  equalActions?: boolean;
  footerNote?: string;
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatMoney(value: number) {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

export function formatBookingDateLabel(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString("en-CA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatBookingTimeLabel(value: string | null | undefined) {
  if (!value) return "—";
  const raw = String(value).trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return raw;
  const hours = Number.parseInt(match[1], 10);
  const minutes = match[2];
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes} ${suffix}`;
}

export async function loadBookingEmailBusinessContext(
  supabase: SupabaseClient,
  businessId: string,
): Promise<BookingEmailBusinessContext> {
  const [{ data: business }, { data: branding }] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, business_email, business_phone, business_website, business_address, business_city, business_state, business_postal")
      .eq("id", businessId)
      .single(),
    supabase
      .from("app_branding")
      .select("logo_url")
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);

  const street = String(business?.business_address || "").trim();
  const city = String(business?.business_city || "").trim();
  const region = String(business?.business_state || "").trim();
  const postal = String(business?.business_postal || "").trim();
  const cityLine = [city, region, postal].filter(Boolean).join(", ");
  const addressLine = [street, cityLine].filter(Boolean).join(", ") || null;

  return {
    id: businessId,
    name: String(business?.name || "Tavari").trim() || "Tavari",
    email: String(business?.business_email || "").trim() || null,
    phone: String(business?.business_phone || "").trim() || null,
    website: String(business?.business_website || "").trim() || null,
    addressLine,
    logoUrl: String(branding?.logo_url || "").trim() || null,
  };
}

export async function resolveBookingRecipientName(
  supabase: SupabaseClient,
  booking: {
    customer_id?: string | null;
    customer_email?: string | null;
  },
  businessId: string,
): Promise<string | null> {
  if (booking.customer_id) {
    const { data: loyalty } = await supabase
      .from("pos_loyalty_accounts")
      .select("customer_name")
      .eq("id", booking.customer_id)
      .eq("business_id", businessId)
      .maybeSingle();
    const name = String(loyalty?.customer_name || "").trim();
    if (name) return name;
  }

  const email = String(booking.customer_email || "").trim();
  if (email.includes("@")) {
    return email.split("@")[0].replace(/[._-]+/g, " ").trim() || null;
  }

  return null;
}

function buildContactLines(business: BookingEmailBusinessContext) {
  const lines: string[] = [];
  if (business.phone) lines.push(`Phone: ${business.phone}`);
  if (business.email) lines.push(`Email: ${business.email}`);
  if (business.website) lines.push(`Website: ${business.website}`);
  if (business.addressLine) lines.push(`Address: ${business.addressLine}`);
  return lines;
}

function buildContactHtml(business: BookingEmailBusinessContext) {
  const items: string[] = [];
  if (business.phone) {
    items.push(`<div style="margin-bottom:6px;"><strong style="color:#111827;">Phone:</strong> ${escapeHtml(business.phone)}</div>`);
  }
  if (business.email) {
    items.push(`<div style="margin-bottom:6px;"><strong style="color:#111827;">Email:</strong> <a href="mailto:${escapeHtml(business.email)}" style="color:${BOOKING_EMAIL_ACCENT};text-decoration:none;">${escapeHtml(business.email)}</a></div>`);
  }
  if (business.website) {
    const href = business.website.startsWith("http") ? business.website : `https://${business.website}`;
    items.push(`<div style="margin-bottom:6px;"><strong style="color:#111827;">Website:</strong> <a href="${escapeHtml(href)}" style="color:${BOOKING_EMAIL_ACCENT};text-decoration:none;">${escapeHtml(business.website)}</a></div>`);
  }
  if (business.addressLine) {
    items.push(`<div><strong style="color:#111827;">Address:</strong> ${escapeHtml(business.addressLine)}</div>`);
  }
  return items.join("");
}

export function buildBookingTransactionalEmailHtml(input: BookingTransactionalEmailInput) {
  const detailRows = input.details.length
    ? input.details.map((item) => `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;width:42%;vertical-align:top;">${escapeHtml(item.label)}</td>
          <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-size:14px;font-weight:600;text-align:right;vertical-align:top;">${escapeHtml(item.value)}</td>
        </tr>
      `).join("")
    : "";

  const stepsBlock = input.steps?.length
    ? `
        <tr>
          <td style="padding:18px 32px 0;">
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:18px 20px;">
              <div style="font-size:13px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;">What happens next</div>
              <ol style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.7;">
                ${input.steps.map((step) => `<li style="margin-bottom:8px;">${escapeHtml(step)}</li>`).join("")}
              </ol>
            </div>
          </td>
        </tr>
      `
    : "";

  const noteBlock = input.note
    ? `
        <tr>
          <td style="padding:18px 32px 0;">
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:14px;padding:16px 18px;color:#92400e;font-size:14px;line-height:1.6;">
              ${escapeHtml(input.note)}
            </div>
          </td>
        </tr>
      `
    : "";

  const primaryActionBlock = input.primaryAction
    ? `
        <tr>
          <td style="padding:24px 32px 0;" align="center">
            <a href="${escapeHtml(input.primaryAction.url)}" style="display:inline-block;background:${BOOKING_EMAIL_ACCENT};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:999px;">
              ${escapeHtml(input.primaryAction.label)}
            </a>
          </td>
        </tr>
      `
    : "";

  const secondaryActionBlock = input.secondaryAction
    ? (
      input.equalActions
        ? `
        <tr>
          <td style="padding:12px 32px 0;" align="center">
            <a href="${escapeHtml(input.secondaryAction.url)}" style="display:inline-block;background:${BOOKING_EMAIL_ACCENT};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:999px;">
              ${escapeHtml(input.secondaryAction.label)}
            </a>
          </td>
        </tr>
      `
        : `
        <tr>
          <td style="padding:14px 32px 0;" align="center">
            <a href="${escapeHtml(input.secondaryAction.url)}" style="color:${BOOKING_EMAIL_ACCENT};text-decoration:none;font-size:14px;font-weight:600;">
              ${escapeHtml(input.secondaryAction.label)}
            </a>
          </td>
        </tr>
      `
    )
    : "";

  const logoBlock = input.business.logoUrl
    ? `
        <tr>
          <td style="padding:24px 32px 0;" align="center">
            <img src="${escapeHtml(input.business.logoUrl)}" alt="${escapeHtml(input.business.name)}" width="160" style="display:block;max-width:160px;height:auto;border:0;" />
          </td>
        </tr>
      `
    : "";

  const contactHtml = buildContactHtml(input.business);
  const footerNote = input.footerNote
    || `This message was sent by ${input.business.name} regarding your booking. Please keep this email for your records.`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(input.headline)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.10);">
            <tr>
              <td style="background:${BOOKING_EMAIL_ACCENT};padding:28px 32px;color:#ffffff;">
                <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;opacity:0.92;">${escapeHtml(input.eyebrow)}</div>
                <h1 style="margin:10px 0 0;font-size:28px;line-height:1.25;font-weight:800;">${escapeHtml(input.headline)}</h1>
                <div style="margin-top:8px;font-size:15px;opacity:0.95;">${escapeHtml(input.business.name)}</div>
              </td>
            </tr>
            ${logoBlock}
            <tr>
              <td style="padding:30px 32px 8px;">
                <p style="margin:0;color:#374151;font-size:16px;line-height:1.65;">${escapeHtml(input.intro)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px 8px;">
                <div style="font-size:13px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Booking details</div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  ${detailRows}
                </table>
              </td>
            </tr>
            ${stepsBlock}
            ${noteBlock}
            ${primaryActionBlock}
            ${secondaryActionBlock}
            <tr>
              <td style="padding:28px 32px 32px;">
                <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:18px 20px;">
                  <div style="font-size:13px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;">Questions?</div>
                  <div style="font-size:14px;color:#4b5563;line-height:1.6;">
                    ${contactHtml || `<div>If you need help with your booking, reply to this email or contact ${escapeHtml(input.business.name)} directly.</div>`}
                  </div>
                </div>
                <div style="margin-top:16px;font-size:12px;color:#9ca3af;line-height:1.6;text-align:center;">
                  ${escapeHtml(footerNote)}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function buildBookingTransactionalEmailText(input: BookingTransactionalEmailInput) {
  const detailText = input.details.map((item) => `${item.label}: ${item.value}`).join("\n");
  const stepsText = input.steps?.length
    ? ["", "What happens next", ...input.steps.map((step, index) => `${index + 1}. ${step}`)].join("\n")
    : "";
  const contactText = buildContactLines(input.business).join("\n");
  const footerNote = input.footerNote
    || `This message was sent by ${input.business.name} regarding your booking. Please keep this email for your records.`;

  return [
    input.headline,
    input.business.name,
    "",
    input.intro,
    "",
    "Booking details",
    detailText,
    stepsText,
    input.note ? ["", input.note].join("\n") : "",
    input.primaryAction ? ["", `${input.primaryAction.label}: ${input.primaryAction.url}`].join("\n") : "",
    input.secondaryAction ? `${input.secondaryAction.label}: ${input.secondaryAction.url}` : "",
    contactText ? ["", "Questions?", contactText].join("\n") : "",
    "",
    footerNote,
  ].filter(Boolean).join("\n");
}

export function buildBookingRequestReceivedEmail(input: {
  business: BookingEmailBusinessContext;
  recipientName: string | null;
  bookingNumber: string;
  activityName: string;
  bookingDate: string;
  bookingTime: string;
  participantCount: number;
  orderTotal: number | null;
  manageUrl: string;
  /** When true, mention that a separate Terms & Conditions email is on the way. */
  termsRequired?: boolean;
}) {
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : "Hello,";
  const dateLabel = formatBookingDateLabel(input.bookingDate);
  const timeLabel = formatBookingTimeLabel(input.bookingTime);
  const termsRequired = Boolean(input.termsRequired);

  const details: BookingEmailDetailRow[] = [
    { label: "Booking number", value: input.bookingNumber },
    { label: "Activity", value: input.activityName },
    { label: "Date", value: dateLabel },
    { label: "Time", value: timeLabel },
    { label: "Guests", value: String(input.participantCount || 1) },
    { label: "Status", value: termsRequired ? "Pending — Terms & Conditions required" : "Pending review" },
  ];

  if (input.orderTotal != null && input.orderTotal > 0) {
    details.push({ label: "Estimated total", value: formatMoney(input.orderTotal) });
  }

  const steps = termsRequired
    ? [
      "You'll receive a separate email next asking you to acknowledge and sign our Terms & Conditions.",
      "After you sign, our team will review your request and confirm availability.",
      "You'll receive another email once your booking is approved.",
      "If a deposit is required, that email will include a secure payment link and due date.",
    ]
    : [
      "Our team will review your booking request and confirm availability.",
      "You'll receive another email once your booking is approved.",
      "If a deposit is required, that email will include a secure payment link and due date.",
      "You can manage your booking anytime using the button below.",
    ];

  const emailInput: BookingTransactionalEmailInput = {
    business: input.business,
    eyebrow: "Booking request received",
    headline: "We've received your booking request",
    intro: termsRequired
      ? `${greeting} thank you for choosing ${input.business.name}. Your request has been received and your spot is being held. Next, watch for a separate email to acknowledge and sign our Terms & Conditions — we can't approve your booking until that step is complete.`
      : `${greeting} thank you for choosing ${input.business.name}. Your request has been received and your spot is being held while our team reviews the details.`,
    details,
    steps,
    note: termsRequired
      ? "No payment is required right now. Use Manage my booking to review details, update food options, upload guest list names, and more."
      : "No payment is required right now. Use Manage my booking to review details, update food options, upload guest list names, and more.",
    primaryAction: {
      label: "Manage my booking",
      url: input.manageUrl,
    },
    footerNote: `This confirmation was sent by ${input.business.name}. Your booking request is not fully confirmed until you receive approval from our team.`,
  };

  return {
    subject: `Booking request received for ${dateLabel}`,
    html: buildBookingTransactionalEmailHtml(emailInput),
    text: buildBookingTransactionalEmailText(emailInput),
  };
}

/**
 * Paid / confirmed booking email (drop-in, party after payment, staff-sent confirmation).
 * Uses the same teal card template as party request / payment emails.
 */
export function buildBookingConfirmationEmail(input: {
  business: BookingEmailBusinessContext;
  recipientName: string | null;
  bookingNumber: string;
  activityName: string;
  bookingDate: string;
  bookingTime: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  ticketSummary?: Array<{ name: string; qty: number }>;
  guestCount?: number | null;
  orderTotal?: number | null;
  totalPaid?: number | null;
  balanceOwing?: number | null;
  manageUrl: string;
  thankYouMessage?: string | null;
}) {
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : "Hello,";
  const dateLabel = formatBookingDateLabel(input.bookingDate);
  const timeLabel = formatBookingTimeLabel(input.bookingTime);
  const tickets = (input.ticketSummary || []).filter((row) => row && (row.qty || 0) > 0);
  const ticketLabel = tickets.length
    ? tickets.map((row) => `${row.name} × ${row.qty}`).join(", ")
    : null;

  const details: BookingEmailDetailRow[] = [
    { label: "Booking number", value: input.bookingNumber },
    { label: "Activity", value: input.activityName },
    { label: "Date", value: dateLabel },
    { label: "Time", value: timeLabel },
    { label: "Status", value: "Confirmed" },
  ];

  if (input.contactName?.trim()) {
    details.push({ label: "Guest / contact", value: input.contactName.trim() });
  }
  if (input.contactEmail?.trim()) {
    details.push({ label: "Email", value: input.contactEmail.trim() });
  }
  if (input.contactPhone?.trim()) {
    details.push({ label: "Phone", value: input.contactPhone.trim() });
  }
  if (ticketLabel) {
    details.push({ label: "Tickets", value: ticketLabel });
  } else if (input.guestCount != null && input.guestCount > 0) {
    details.push({ label: "Guests", value: String(input.guestCount) });
  }
  if (input.orderTotal != null && input.orderTotal > 0) {
    details.push({ label: "Booking total", value: formatMoney(input.orderTotal) });
  }
  if (input.totalPaid != null) {
    details.push({ label: "Total paid", value: formatMoney(input.totalPaid) });
  }
  if (input.balanceOwing != null && input.balanceOwing > 0.009) {
    details.push({ label: "Balance owing", value: formatMoney(input.balanceOwing) });
  }

  const thankYou = String(input.thankYouMessage || "").trim();
  const emailInput: BookingTransactionalEmailInput = {
    business: input.business,
    eyebrow: "Booking confirmed",
    headline: "Your booking is confirmed",
    intro: `${greeting} thank you for booking with ${input.business.name}. Your reservation is confirmed — we look forward to seeing you.`,
    details,
    steps: [
      "Save this email for your records.",
      "Arrive a few minutes early so we can check you in smoothly.",
      "Use Manage my booking if you need to review details or make changes.",
    ],
    note: thankYou || undefined,
    primaryAction: {
      label: "Manage my booking",
      url: input.manageUrl,
    },
    footerNote: `This confirmation was sent by ${input.business.name}. Please keep this email for your records.`,
  };

  return {
    subject: `Booking confirmed for ${dateLabel}`,
    html: buildBookingTransactionalEmailHtml(emailInput),
    text: buildBookingTransactionalEmailText(emailInput),
  };
}

/**
 * Dedicated action email: customer must acknowledge/sign Terms & Conditions.
 */
export function buildBookingTermsRequiredEmail(input: {
  business: BookingEmailBusinessContext;
  recipientName: string | null;
  bookingNumber: string;
  activityName: string;
  bookingDate: string;
  bookingTime: string;
  participantCount: number;
  manageUrl: string;
  termsUrl: string;
}) {
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : "Hello,";
  const dateLabel = formatBookingDateLabel(input.bookingDate);
  const timeLabel = formatBookingTimeLabel(input.bookingTime);

  const details: BookingEmailDetailRow[] = [
    { label: "Booking number", value: input.bookingNumber },
    { label: "Activity", value: input.activityName },
    { label: "Date", value: dateLabel },
    { label: "Time", value: timeLabel },
    { label: "Guests", value: String(input.participantCount || 1) },
    { label: "Status", value: "Action required — sign Terms & Conditions" },
  ];

  const emailInput: BookingTransactionalEmailInput = {
    business: input.business,
    eyebrow: "Action required",
    headline: "Almost there: acknowledge Terms & Conditions now",
    intro: `${greeting} your booking request for ${input.activityName} on ${dateLabel} is held, but we can't approve it until you review and sign our Terms & Conditions.`,
    details,
    steps: [
      "Open the Terms & Conditions link and acknowledge each section.",
      "Sign electronically to confirm your agreement.",
      "Once signed, our team can review and approve your booking.",
      "Need to update food, guest list names, or other details? Use Manage my booking anytime.",
    ],
    note: "This step only takes a few minutes. Your booking cannot be approved until Terms & Conditions are signed.",
    primaryAction: {
      label: "Acknowledge Terms & Conditions now",
      url: input.termsUrl,
    },
    secondaryAction: {
      label: "Manage my booking",
      url: input.manageUrl,
    },
    equalActions: true,
    footerNote: `This message was sent by ${input.business.name}. If you already signed, you can ignore this email.`,
  };

  return {
    subject: `Almost there: acknowledge Terms & Conditions for ${dateLabel}`,
    html: buildBookingTransactionalEmailHtml(emailInput),
    text: buildBookingTransactionalEmailText(emailInput),
  };
}

/**
 * Companion email after day camp confirmation: prep notes + Day Camp Guide link.
 */
export function buildBookingCampGuideEmail(input: {
  business: BookingEmailBusinessContext;
  recipientName: string | null;
  bookingNumber: string;
  activityName: string;
  bookingDate: string;
  bookingTime: string;
  manageUrl: string;
  guideUrl: string;
}) {
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : "Hello,";
  const dateLabel = formatBookingDateLabel(input.bookingDate);
  const timeLabel = formatBookingTimeLabel(input.bookingTime);

  const details: BookingEmailDetailRow[] = [
    { label: "Booking number", value: input.bookingNumber },
    { label: "Activity", value: input.activityName },
    { label: "Date", value: dateLabel },
    { label: "Time", value: timeLabel },
  ];

  const emailInput: BookingTransactionalEmailInput = {
    business: input.business,
    eyebrow: "Camp day prep",
    headline: "Your Day Camp Information Guide",
    intro: `${greeting} your spot for ${input.activityName} on ${dateLabel} is confirmed. Please review our Day Camp Information Guide for hours, drop-off and pick-up, what to bring, and other important details before camp day.`,
    details,
    steps: [
      "Open the Day Camp Guide for the full parent information.",
      "Have socks ready — Off The Wall Kids is a socks-only facility.",
      "Send a personal water bottle only (lunch and snacks are provided).",
      "Use Manage my booking anytime to review your booking details.",
    ],
    note: "Keep this email handy for camp morning. If anything changes, contact us as soon as possible.",
    primaryAction: {
      label: "Open Day Camp Guide",
      url: input.guideUrl,
    },
    secondaryAction: {
      label: "Manage my booking",
      url: input.manageUrl,
    },
    equalActions: true,
    footerNote: `This guide email was sent by ${input.business.name} through Tavari.`,
  };

  return {
    subject: `Day Camp Guide for ${dateLabel}`,
    html: buildBookingTransactionalEmailHtml(emailInput),
    text: buildBookingTransactionalEmailText(emailInput),
  };
}

export function buildBookingPaymentRequestEmail(input: {
  business: BookingEmailBusinessContext;
  recipientName: string | null;
  bookingNumber: string;
  activityName: string;
  bookingDate: string;
  bookingTime: string;
  requestType: "deposit" | "full" | "custom";
  amount: number;
  orderTotal: number | null;
  balanceDue: number | null;
  dueLabel: string;
  payUrl: string;
  manageUrl: string;
  approved: boolean;
}) {
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : "Hello,";
  const dateLabel = formatBookingDateLabel(input.bookingDate);
  const timeLabel = formatBookingTimeLabel(input.bookingTime);
  const amountLabel = formatMoney(input.amount);

  const requestTypeLabel = input.requestType === "full"
    ? "Full balance"
    : input.requestType === "custom"
      ? "Custom amount"
      : "Deposit";

  const headline = input.approved
    ? (input.requestType === "full" ? "Your booking is approved — payment is due" : "Your booking is approved — deposit due")
    : (input.requestType === "full" ? "Payment is due for your booking" : "Payment requested for your booking");

  const intro = input.approved
    ? `${greeting} great news — your booking with ${input.business.name} has been approved. Please complete your ${requestTypeLabel.toLowerCase()} of ${amountLabel} by ${input.dueLabel} to secure your reservation.`
    : `${greeting} ${input.business.name} has sent you a payment request for your booking. Please pay ${amountLabel} by ${input.dueLabel}.`;

  const details: BookingEmailDetailRow[] = [
    { label: "Booking number", value: input.bookingNumber },
    { label: "Activity", value: input.activityName },
    { label: "Date", value: dateLabel },
    { label: "Time", value: timeLabel },
    { label: "Payment type", value: requestTypeLabel },
    { label: "Amount due", value: amountLabel },
    { label: "Due by", value: input.dueLabel },
  ];

  if (input.orderTotal != null && input.orderTotal > 0) {
    details.push({ label: "Booking total", value: formatMoney(input.orderTotal) });
  }
  if (input.balanceDue != null && input.balanceDue > input.amount + 0.005) {
    details.push({ label: "Remaining after payment", value: formatMoney(input.balanceDue - input.amount) });
  }

  const emailInput: BookingTransactionalEmailInput = {
    business: input.business,
    eyebrow: input.approved ? "Booking approved" : "Payment request",
    headline,
    intro,
    details,
    steps: [
      "Click the secure payment button below to pay online.",
      "You'll receive a confirmation email once your payment is complete.",
      "Your booking remains subject to our standard cancellation and reschedule policies.",
      "If you have already paid, you can safely ignore this message or contact us.",
    ],
    note: `Please complete payment by ${input.dueLabel} to keep your booking confirmed.`,
    primaryAction: {
      label: input.requestType === "full" ? "Pay full balance" : "Pay now",
      url: input.payUrl,
    },
    secondaryAction: {
      label: "View booking details",
      url: input.manageUrl,
    },
    footerNote: `This payment request was sent by ${input.business.name}. Payments are processed securely online.`,
  };

  const subjectPrefix = input.approved ? "Booking approved — payment due" : "Payment due";
  return {
    subject: `${subjectPrefix} for ${dateLabel}`,
    html: buildBookingTransactionalEmailHtml(emailInput),
    text: buildBookingTransactionalEmailText(emailInput),
  };
}

export type BookingPaymentFollowUpType = "overdue" | "pending" | "balance_after_party";

export function buildBookingPaymentFollowUpEmail(input: {
  business: BookingEmailBusinessContext;
  recipientName: string | null;
  bookingNumber: string;
  activityName: string;
  bookingDate: string;
  bookingTime: string;
  followUpType: BookingPaymentFollowUpType;
  amountDue: number;
  dueLabel: string | null;
  payUrl: string;
  manageUrl: string;
}) {
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : "Hello,";
  const dateLabel = formatBookingDateLabel(input.bookingDate);
  const timeLabel = formatBookingTimeLabel(input.bookingTime);
  const amountLabel = formatMoney(input.amountDue);
  const dueText = input.dueLabel || "as soon as possible";

  const details: BookingEmailDetailRow[] = [
    { label: "Booking number", value: input.bookingNumber },
    { label: "Activity", value: input.activityName },
    { label: "Date", value: dateLabel },
    { label: "Time", value: timeLabel },
    { label: "Amount due", value: amountLabel },
  ];

  if (input.dueLabel) {
    details.push({ label: "Due by", value: input.dueLabel });
  }

  let eyebrow = "Payment follow-up";
  let headline = "Reminder: payment due for your booking";
  let intro = `${greeting} we're following up regarding your booking with ${input.business.name}. A payment of ${amountLabel} is due by ${dueText}. Please complete your payment at your earliest convenience.`;
  let note = `Please complete payment by ${dueText} to keep your booking confirmed.`;
  let primaryLabel = "Pay now";
  let subject = `Payment follow-up for ${dateLabel}`;

  if (input.followUpType === "overdue") {
    eyebrow = "Payment overdue";
    headline = "Your payment is overdue";
    intro = `${greeting} this is a reminder that your payment of ${amountLabel} for your booking with ${input.business.name} is now overdue${input.dueLabel ? ` (due ${input.dueLabel})` : ""}. Please pay as soon as possible to keep your booking confirmed.`;
    note = "Your payment is past due. Please complete payment immediately to avoid cancellation.";
    primaryLabel = "Pay overdue amount";
    subject = `Payment overdue for ${dateLabel}`;
  } else if (input.followUpType === "balance_after_party") {
    eyebrow = "Balance overdue";
    headline = "Your balance is overdue — please pay immediately";
    intro = `${greeting} your party on ${dateLabel} has passed and a balance of ${amountLabel} remains on your booking with ${input.business.name}. Please pay immediately to close out your account.`;
    note = "This balance is overdue. Please pay immediately.";
    primaryLabel = "Pay balance now";
    subject = `Balance overdue — please pay immediately`;
  }

  const emailInput: BookingTransactionalEmailInput = {
    business: input.business,
    eyebrow,
    headline,
    intro,
    details,
    steps: [
      "Click the secure payment button below to pay online.",
      "You'll receive a confirmation email once your payment is complete.",
      "If you have already paid, you can safely ignore this message or contact us.",
    ],
    note,
    primaryAction: {
      label: primaryLabel,
      url: input.payUrl,
    },
    secondaryAction: {
      label: "View booking details",
      url: input.manageUrl,
    },
    footerNote: `This follow-up was sent by ${input.business.name}. Payments are processed securely online.`,
  };

  return {
    subject,
    html: buildBookingTransactionalEmailHtml(emailInput),
    text: buildBookingTransactionalEmailText(emailInput),
  };
}

export function formatDateTimeInBusinessTimezone(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "America/Toronto",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString("en-CA");
  }
}

export function buildBookingPaymentCancelWarningEmail(input: {
  business: BookingEmailBusinessContext;
  recipientName: string | null;
  bookingNumber: string;
  activityName: string;
  bookingDate: string;
  bookingTime: string;
  amountDue: number;
  cancelDeadlineLabel: string;
  payUrl: string;
  manageUrl: string;
}) {
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : "Hello,";
  const dateLabel = formatBookingDateLabel(input.bookingDate);
  const timeLabel = formatBookingTimeLabel(input.bookingTime);
  const amountLabel = formatMoney(input.amountDue);

  const details: BookingEmailDetailRow[] = [
    { label: "Booking number", value: input.bookingNumber },
    { label: "Activity", value: input.activityName },
    { label: "Date", value: dateLabel },
    { label: "Time", value: timeLabel },
    { label: "Amount due", value: amountLabel },
    { label: "Pay by", value: input.cancelDeadlineLabel },
  ];

  const emailInput: BookingTransactionalEmailInput = {
    business: input.business,
    eyebrow: "Final payment notice",
    headline: "Your booking will be cancelled without payment",
    intro: `${greeting} your deposit of ${amountLabel} for your booking with ${input.business.name} is overdue. If we do not receive payment by ${input.cancelDeadlineLabel}, your booking will be automatically cancelled and your time slot may be released.`,
    details,
    steps: [
      "Click the secure payment button below to pay before the deadline.",
      "If you have already paid, contact us immediately so we can confirm your booking.",
      "After the deadline, this booking will be cancelled automatically if payment is still outstanding.",
    ],
    note: `Payment must be received by ${input.cancelDeadlineLabel} to keep this booking.`,
    primaryAction: {
      label: "Pay now to keep booking",
      url: input.payUrl,
    },
    secondaryAction: {
      label: "View booking details",
      url: input.manageUrl,
    },
    footerNote: `This notice was sent by ${input.business.name}. The cancellation deadline is shown in your local venue time.`,
  };

  return {
    subject: `Booking will be cancelled without payment by ${input.cancelDeadlineLabel}`,
    html: buildBookingTransactionalEmailHtml(emailInput),
    text: buildBookingTransactionalEmailText(emailInput),
  };
}

export type BookingCancellationSource = "staff" | "customer" | "system";

export function buildBookingCancellationEmail(input: {
  business: BookingEmailBusinessContext;
  recipientName: string | null;
  bookingNumber: string;
  activityName: string;
  bookingDate: string;
  bookingTime: string;
  cancelledBy: BookingCancellationSource;
  reason: string | null;
  manageUrl: string;
}) {
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : "Hello,";
  const dateLabel = formatBookingDateLabel(input.bookingDate);
  const timeLabel = formatBookingTimeLabel(input.bookingTime);

  const details: BookingEmailDetailRow[] = [
    { label: "Booking number", value: input.bookingNumber },
    { label: "Activity", value: input.activityName },
    { label: "Date", value: dateLabel },
    { label: "Time", value: timeLabel },
  ];

  if (input.reason?.trim()) {
    details.push({ label: "Reason", value: input.reason.trim() });
  }

  let eyebrow = "Booking cancelled";
  let headline = "Your booking has been cancelled";
  let intro = `${greeting} your booking with ${input.business.name} on ${dateLabel} at ${timeLabel} has been cancelled.`;
  let note: string | undefined;
  const steps = [
    "Your time slot has been released and is no longer reserved.",
    "If you paid a deposit or balance, refund timing depends on your payment method and our cancellation policy.",
    "Contact us if you have questions or would like to book again.",
  ];

  if (input.cancelledBy === "staff") {
    intro = `${greeting} your booking with ${input.business.name} on ${dateLabel} at ${timeLabel} has been cancelled by our team.`;
    note = "If you believe this was a mistake or would like to rebook, please contact us.";
  } else if (input.cancelledBy === "customer") {
    eyebrow = "Cancellation confirmed";
    headline = "Your booking cancellation is confirmed";
    intro = `${greeting} we've processed your cancellation for your booking with ${input.business.name} on ${dateLabel} at ${timeLabel}.`;
    note = "If eligible refunds or store credit apply under our policy, they will be processed separately.";
  } else if (input.cancelledBy === "system") {
    eyebrow = "Booking cancelled";
    headline = "Your booking was cancelled automatically";
    intro = `${greeting} your booking with ${input.business.name} on ${dateLabel} at ${timeLabel} was automatically cancelled because required payment was not received by the deadline.`;
    note = input.reason?.trim() || "Payment was not received by the deadline shown in your prior notices.";
  }

  const emailInput: BookingTransactionalEmailInput = {
    business: input.business,
    eyebrow,
    headline,
    intro,
    details,
    steps,
    note,
    primaryAction: {
      label: "View booking details",
      url: input.manageUrl,
    },
    footerNote: `This notice was sent by ${input.business.name}.`,
  };

  return {
    subject: "Your booking has been cancelled",
    html: buildBookingTransactionalEmailHtml(emailInput),
    text: buildBookingTransactionalEmailText(emailInput),
  };
}

export function buildBookingAbandonedCartEmail(input: {
  business: BookingEmailBusinessContext;
  recipientName: string | null;
  activityName: string;
  resumeUrl: string;
  extraMessage?: string | null;
}) {
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : "Hello,";
  const details: BookingEmailDetailRow[] = [
    { label: "Activity", value: input.activityName },
  ];

  const steps = [
    "Click the button below to return to your booking.",
    "Choose your date and time again if your session timed out.",
    "Complete payment to confirm your reservation.",
  ];

  let note = "Your checkout session may have timed out — you can pick up where you left off.";
  if (input.extraMessage?.trim()) {
    note = `${note} ${input.extraMessage.trim()}`;
  }

  const emailInput: BookingTransactionalEmailInput = {
    business: input.business,
    eyebrow: "Complete your booking",
    headline: "You left a booking unfinished",
    intro: `${greeting} we saved your selection for ${input.activityName} at ${input.business.name}. You can still complete your booking online.`,
    details,
    steps,
    note,
    primaryAction: {
      label: "Continue booking",
      url: input.resumeUrl,
    },
    footerNote: `This reminder was sent by ${input.business.name}.`,
  };

  return {
    subject: `Complete your booking: ${input.activityName}`,
    html: buildBookingTransactionalEmailHtml(emailInput),
    text: buildBookingTransactionalEmailText(emailInput),
  };
}
