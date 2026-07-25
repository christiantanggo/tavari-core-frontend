import { escapeHtml } from "./reminderEmail.ts";

export type ReminderActionPageVariant = "success" | "warning" | "error";

export type ReminderActionPageInput = {
  title: string;
  message: string;
  variant?: ReminderActionPageVariant;
  reminderTitle?: string;
  detail?: string;
};

const ACCENT = "#0f766e";

function iconSvg(variant: ReminderActionPageVariant): string {
  if (variant === "success") {
    return `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="#ffffff" stroke-width="2"/>
      <path d="M8 12.5l2.5 2.5L16 9" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  if (variant === "warning") {
    return `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="#ffffff" stroke-width="2"/>
      <path d="M12 8v5M12 16h.01" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
    </svg>`;
  }
  return `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="10" stroke="#ffffff" stroke-width="2"/>
    <path d="M12 8v4M12 16h.01" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`;
}

function headerBg(variant: ReminderActionPageVariant): string {
  if (variant === "error") return "linear-gradient(135deg,#b91c1c 0%,#991b1b 100%)";
  if (variant === "warning") return "linear-gradient(135deg,#d97706 0%,#b45309 100%)";
  return `linear-gradient(135deg,${ACCENT} 0%,#0d9488 100%)`;
}

export function buildReminderActionPageHtml(input: ReminderActionPageInput): string {
  const variant = input.variant ?? "success";
  const title = escapeHtml(input.title);
  const message = escapeHtml(input.message);
  const reminderTitle = input.reminderTitle ? escapeHtml(input.reminderTitle) : "";
  const detail = input.detail ? escapeHtml(input.detail) : "";

  let bodyInner = "";
  if (reminderTitle) {
    bodyInner +=
            '<div style="margin:0 0 20px;padding:14px 16px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:12px;">' +
      '<span style="display:block;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#0f766e;margin:0 0 4px;">Reminder</span>' +
      `<strong style="font-size:16px;color:#134e4a;line-height:1.35;">${reminderTitle}</strong>` +
      "</div>";
  }
  bodyInner += `<p style="margin:0;color:#374151;font-size:16px;line-height:1.65;">${message}</p>`;
  if (detail) {
    bodyInner +=
      '<div style="margin:20px 0 0;padding:16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;text-align:center;">' +
      '<span style="display:block;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6b7280;margin:0 0 6px;">Next reminder</span>' +
      `<span style="display:block;font-size:18px;font-weight:800;color:#111827;">${detail}</span>` +
      "</div>";
  }
  

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title} · Tavari Reminder</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;min-height:100vh;padding:32px 16px;">
    <tr>
      <td align="center" valign="middle">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,0.12);">
          <tr>
            <td style="background:${headerBg(variant)};padding:32px 28px 28px;text-align:center;color:#ffffff;">
              <div style="display:inline-block;width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,0.22);line-height:64px;margin:0 auto 16px;">
                ${iconSvg(variant)}
              </div>
              <span style="display:block;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;opacity:0.92;margin:0 0 8px;">Tavari Reminder</span>
              <h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:800;">${title}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 24px;">${bodyInner}</td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px;">
              <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:14px 16px;font-size:13px;color:#6b7280;line-height:1.5;text-align:center;">
                You can close this window. Sent through <strong style="color:#111827;">Tavari</strong>.
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