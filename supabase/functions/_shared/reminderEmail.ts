export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type ReminderEmailButton = { label: string; url: string };

export function buildReminderEmailHtml(input: {
  businessName: string;
  title: string;
  body: string;
  buttons: ReminderEmailButton[];
}) {
  const accent = "#0f766e";
  const buttonWidthPx = 280;
  const bodyHtml = escapeHtml(input.body).replace(/\n/g, "<br/>");
  const buttonStyle = [
    `display:block`,
    `width:${buttonWidthPx}px`,
    `max-width:100%`,
    `margin:0 auto`,
    `box-sizing:border-box`,
    `text-align:center`,
    `background:${accent}`,
    `color:#ffffff`,
    `text-decoration:none`,
    `font-weight:700`,
    `font-size:14px`,
    `padding:12px 20px`,
    `border-radius:999px`,
  ].join(";");
  const buttonRows = input.buttons.map((btn) => `
    <tr>
      <td align="center" style="padding:8px 32px 0;">
        <a href="${escapeHtml(btn.url)}" style="${buttonStyle}">
          ${escapeHtml(btn.label)}
        </a>
      </td>
    </tr>
  `).join("");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.10);">
            <tr>
              <td style="background:${accent};padding:28px 32px;color:#ffffff;">
                <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;opacity:0.9;">Tavari Reminder</div>
                <h1 style="margin:10px 0 0;font-size:26px;line-height:1.2;font-weight:800;">${escapeHtml(input.title)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 32px 8px;">
                <p style="margin:0;color:#374151;font-size:16px;line-height:1.6;">${bodyHtml}</p>
              </td>
            </tr>
            ${buttonRows}
            <tr>
              <td style="padding:24px 32px 32px;">
                <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:16px;font-size:13px;color:#6b7280;line-height:1.5;">
                  This reminder was sent by <strong style="color:#111827;">${escapeHtml(input.businessName)}</strong> through Tavari.
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
