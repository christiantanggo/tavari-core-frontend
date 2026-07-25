import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_PUBLIC_SITE_URL = "https://tavarios.ca";
const DEFAULT_FROM_EMAIL = "noreply@tavarios.ca";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-forms-alert-email-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: corsHeaders });

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function resolvePublicSiteUrl() {
  const raw = (Deno.env.get("PUBLIC_SITE_URL") || Deno.env.get("VITE_PUBLIC_SITE_URL") || "").trim();
  if (raw) return raw.replace(/\/$/, "");
  return DEFAULT_PUBLIC_SITE_URL;
}

async function authorize(req: Request, admin: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return true;

  const requestSecret = (req.headers.get("x-forms-alert-email-secret") || "").trim();
  if (!requestSecret) return false;

  const { data } = await admin
    .from("system_runtime_secrets")
    .select("secret_value")
    .eq("key_name", "forms_alert_email_secret")
    .maybeSingle();

  return Boolean(data?.secret_value && data.secret_value === requestSecret);
}

async function resolveManagerRecipients(admin: ReturnType<typeof createClient>, businessId: string) {
  const [{ data: businessUsers, error: buError }, { data: roleUsers, error: roleError }] = await Promise.all([
    admin
      .from("business_users")
      .select("users!business_users_user_id_fkey(id,full_name,email), role")
      .eq("business_id", businessId)
      .in("role", ["owner", "manager", "admin", "hr_admin"]),
    admin
      .from("user_roles")
      .select("users!user_roles_user_id_fkey(id,full_name,email), role")
      .eq("business_id", businessId)
      .eq("active", true)
      .in("role", ["owner", "manager", "admin", "hr_admin"]),
  ]);
  if (buError) throw buError;
  if (roleError) throw roleError;

  const byEmail = new Map<string, { id: string; name: string; email: string }>();
  [...(businessUsers || []), ...(roleUsers || [])].forEach((entry: Record<string, unknown>) => {
    const user = entry.users as Record<string, unknown> | null;
    const email = String(user?.email || "").trim().toLowerCase();
    if (email) {
      byEmail.set(email, {
        id: String(user?.id || ""),
        name: String(user?.full_name || "Manager"),
        email: String(user?.email || ""),
      });
    }
  });
  return Array.from(byEmail.values());
}

async function resolveRecipients(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  notifyEmployeeId: string | null,
) {
  if (notifyEmployeeId) {
    const { data, error } = await admin
      .from("users")
      .select("id,full_name,email")
      .eq("id", notifyEmployeeId)
      .maybeSingle();
    if (error) throw error;
    if (data?.email) {
      return [{
        id: data.id,
        name: data.full_name || "Reviewer",
        email: data.email,
      }];
    }
  }
  return resolveManagerRecipients(admin, businessId);
}

const formatYesNo = (value: unknown) => {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "yes") return "Yes";
  if (raw === "no") return "No";
  if (raw === "na") return "N/A";
  return String(value ?? "—");
};

const formatUrgency = (value: unknown) => {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "immediate") return "Immediate";
  if (raw === "moderate") return "Moderate";
  if (raw === "cautionary") return "Cautionary";
  return String(value ?? "—");
};

const renderMediaLinks = (urls: unknown, label: string) => {
  if (!Array.isArray(urls) || urls.length === 0) return "";
  return `
    <p style="margin:8px 0 0;color:#374151;font-size:13px;line-height:1.5;">
      <strong>${escapeHtml(label)}:</strong>
      ${urls.map((url, index) => `<a href="${escapeHtml(url)}" style="color:#0f766e;">${escapeHtml(label)} ${index + 1}</a>`).join(" · ")}
    </p>
  `;
};

function buildEmailContent(input: {
  businessName: string;
  formTitle: string;
  alertMessage: string;
  submitterName: string;
  submittedAt: string;
  outOfRangeFields: Array<Record<string, unknown>>;
  dashboardUrl: string;
}) {
  const fieldBlocks = input.outOfRangeFields.map((field) => {
    const issueType = String(field.issue_type || "out_of_range");
    const escalation = (field.escalation || {}) as Record<string, unknown>;
    const unit = field.unit ? ` ${field.unit}` : "";
    const issueSummary = issueType === "incorrect_answer"
      ? `Answered ${formatYesNo(field.value)} · expected ${formatYesNo(field.expected)}`
      : `Reading ${escapeHtml(field.value)}${escapeHtml(unit)} · expected ${escapeHtml(field.min ?? "—")} – ${escapeHtml(field.max ?? "—")}${escapeHtml(unit)}`;

    return `
      <div style="padding:16px 0;border-bottom:1px solid #e5e7eb;">
        <div style="font-size:15px;font-weight:700;color:#111827;">${escapeHtml(field.field_label)}</div>
        <div style="margin-top:6px;color:#b45309;font-size:14px;font-weight:700;">${issueSummary}</div>
        <div style="margin-top:10px;padding:12px;border-radius:10px;background:#fff7ed;border:1px solid #fed7aa;">
          <div style="font-size:12px;font-weight:700;color:#9a3412;text-transform:uppercase;letter-spacing:0.08em;">Follow-up details</div>
          <p style="margin:8px 0 0;color:#374151;font-size:13px;line-height:1.5;"><strong>Location:</strong> ${escapeHtml(escalation.location || "—")}</p>
          <p style="margin:4px 0 0;color:#374151;font-size:13px;line-height:1.5;"><strong>Urgency:</strong> ${escapeHtml(formatUrgency(escalation.urgency))}</p>
          <p style="margin:4px 0 0;color:#374151;font-size:13px;line-height:1.5;"><strong>Submit maintenance request:</strong> ${escapeHtml(formatYesNo(escalation.submit_maintenance_request))}</p>
          <p style="margin:4px 0 0;color:#374151;font-size:13px;line-height:1.5;"><strong>Action taken:</strong> ${escapeHtml(escalation.action_taken || "—")}</p>
          ${renderMediaLinks(escalation.photo_urls, "Photo")}
          ${renderMediaLinks(escalation.video_urls, "Video")}
        </div>
      </div>
    `;
  }).join("");

  const textFields = input.outOfRangeFields.map((field) => {
    const issueType = String(field.issue_type || "out_of_range");
    const escalation = (field.escalation || {}) as Record<string, unknown>;
    const unit = field.unit ? ` ${field.unit}` : "";
    const issueSummary = issueType === "incorrect_answer"
      ? `Answered ${formatYesNo(field.value)} (expected ${formatYesNo(field.expected)})`
      : `${field.value}${unit} (expected ${field.min ?? "—"} to ${field.max ?? "—"}${unit})`;

    const lines = [
      `- ${field.field_label}: ${issueSummary}`,
      `  Location: ${escalation.location || "—"}`,
      `  Urgency: ${formatUrgency(escalation.urgency)}`,
      `  Submit maintenance request: ${formatYesNo(escalation.submit_maintenance_request)}`,
      `  Action taken: ${escalation.action_taken || "—"}`,
    ];

    if (Array.isArray(escalation.photo_urls) && escalation.photo_urls.length) {
      lines.push(`  Photos: ${escalation.photo_urls.join(", ")}`);
    }
    if (Array.isArray(escalation.video_urls) && escalation.video_urls.length) {
      lines.push(`  Videos: ${escalation.video_urls.join(", ")}`);
    }

    return lines.join("\n");
  }).join("\n\n");

  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.10);">
            <tr>
              <td style="background:#b45309;padding:28px 32px;color:#ffffff;">
                <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;opacity:0.9;">Tavari Forms Alert</div>
                <h1 style="margin:10px 0 0;font-size:26px;line-height:1.2;font-weight:800;">Flagged form response</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 8px;">
                <p style="margin:0 0 12px;color:#374151;font-size:16px;line-height:1.6;">
                  ${escapeHtml(input.alertMessage)}
                </p>
                <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.6;">
                  Submitted by <strong>${escapeHtml(input.submitterName)}</strong> at ${escapeHtml(input.submittedAt)}.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0;">
                ${fieldBlocks || `<p style="padding:12px 0;color:#6b7280;">Open Tavari Forms for full submission details.</p>`}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px;">
                <a href="${escapeHtml(input.dashboardUrl)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 22px;border-radius:999px;">
                  Review in Tavari Forms
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;color:#9ca3af;font-size:12px;">${escapeHtml(input.businessName)} · Tavari Forms</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    "Tavari Forms — flagged form response",
    "",
    input.alertMessage,
    `Submitted by ${input.submitterName} at ${input.submittedAt}.`,
    "",
    textFields || "Open Tavari Forms for full submission details.",
    "",
    `Review: ${input.dashboardUrl}`,
  ].join("\n");

  return {
    subject: `[Tavari Forms] Review required — ${input.formTitle}`,
    html,
    text,
  };
}

async function sendEmail(input: {
  businessId: string;
  fromEmail: string;
  fromName: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  alertId: string;
}) {
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      businessId: input.businessId,
      campaignId: `forms-alert-${input.alertId}`,
      emailType: "transactional",
      to: input.to,
      fromEmail: input.fromEmail,
      fromName: input.fromName,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  const payload = await response.json().catch(() => null);
  return {
    to: input.to,
    ok: response.ok && payload?.ok === true,
    messageId: payload?.messageId || null,
    error: response.ok ? payload?.error || null : payload?.error || `mail-send HTTP ${response.status}`,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (!(await authorize(req, admin))) {
      return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const alertId = String(body.alertId || "").trim();
    if (!alertId) return json({ error: "Missing alertId" }, 400);

    const { data: alert, error: alertError } = await admin
      .from("forms_manager_alerts")
      .select(`
        id,
        business_id,
        alert_type,
        message,
        details,
        created_at,
        notify_employee_id,
        form_template_id,
        form_submission_id
      `)
      .eq("id", alertId)
      .maybeSingle();

    if (alertError) throw alertError;
    if (!alert) return json({ error: "Alert not found" }, 404);

    const [{ data: business }, { data: mailSettings }, { data: template }, { data: submission }] = await Promise.all([
      admin.from("businesses").select("id,name").eq("id", alert.business_id).maybeSingle(),
      admin.from("mail_settings").select("from_email,from_name").eq("business_id", alert.business_id).maybeSingle(),
      alert.form_template_id
        ? admin.from("forms_templates").select("id,title").eq("id", alert.form_template_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      alert.form_submission_id
        ? admin.from("forms_submissions").select("id,submitted_at,responses").eq("id", alert.form_submission_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const details = (alert.details || {}) as Record<string, unknown>;
    const outOfRangeFields = Array.isArray(details.out_of_range_fields)
      ? details.out_of_range_fields as Array<Record<string, unknown>>
      : [];

    const recipients = await resolveRecipients(admin, alert.business_id, alert.notify_employee_id);
    if (recipients.length === 0) {
      await admin
        .from("forms_manager_alerts")
        .update({
          details: {
            ...details,
            email_sent_at: null,
            email_error: "No recipient email found for designated reviewer or managers",
          },
        })
        .eq("id", alertId);
      return json({ ok: false, alertId, error: "No recipient email found" }, 200);
    }

    const dashboardUrl = `${resolvePublicSiteUrl()}/dashboard/forms`;
    const submittedAt = submission?.submitted_at
      ? new Date(String(submission.submitted_at)).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })
      : new Date(String(alert.created_at)).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });

    const emailContent = buildEmailContent({
      businessName: business?.name || "Business",
      formTitle: template?.title || "Form",
      alertMessage: alert.message,
      submitterName: String(details.submitter_name || "Staff"),
      submittedAt,
      outOfRangeFields,
      dashboardUrl,
    });

    const fromEmail = mailSettings?.from_email || DEFAULT_FROM_EMAIL;
    const fromName = mailSettings?.from_name || business?.name || "Tavari";

    const emailResults = [];
    for (const recipient of recipients) {
      emailResults.push(await sendEmail({
        businessId: alert.business_id,
        fromEmail,
        fromName,
        to: recipient.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
        alertId,
      }));
    }

    const successful = emailResults.filter((result) => result.ok);
    await admin
      .from("forms_manager_alerts")
      .update({
        details: {
          ...details,
          email_sent_at: successful.length > 0 ? new Date().toISOString() : null,
          email_results: emailResults,
          email_error: successful.length > 0 ? null : emailResults.map((result) => result.error).filter(Boolean).join("; ") || "Email send failed",
        },
      })
      .eq("id", alertId);

    return json({
      ok: successful.length > 0,
      alertId,
      recipients: recipients.map((recipient) => recipient.email),
      emailResults,
    });
  } catch (error) {
    console.error("[forms-send-alert-email] error", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
