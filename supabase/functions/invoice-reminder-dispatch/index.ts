import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_PUBLIC_SITE_URL = "https://tavarios.ca";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-invoice-reminder-dispatch-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

type ReminderRule = {
  days_before_due?: number;
  days_after_due?: number;
  recipient?: string;
};

function resolvePublicSiteUrl() {
  const raw = (Deno.env.get("PUBLIC_SITE_URL") || Deno.env.get("VITE_PUBLIC_SITE_URL") || "").trim();
  return raw ? raw.replace(/\/$/, "") : DEFAULT_PUBLIC_SITE_URL;
}

function dateOnlyInTz(isoOrDate: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date(isoOrDate.includes("T") ? isoOrDate : `${isoOrDate}T12:00:00`));
  } catch {
    return isoOrDate.slice(0, 10);
  }
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function authorizeCron(req: Request, admin: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return true;
  const requestSecret = (req.headers.get("x-invoice-reminder-dispatch-cron-secret") || "").trim();
  if (!requestSecret) return false;
  const { data } = await admin
    .from("system_runtime_secrets")
    .select("secret_value")
    .eq("key_name", "invoice_reminder_dispatch_cron_secret")
    .maybeSingle();
  return Boolean(data?.secret_value && data.secret_value === requestSecret);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  if (!(await authorizeCron(req, admin))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const siteUrl = resolvePublicSiteUrl();
  let sent = 0;
  let scanned = 0;

  const { data: invoices, error } = await admin
    .from("tavari_invoices")
    .select(`
      id, business_id, invoice_number, recipient_name, recipient_email,
      balance_due, due_date, first_sent_at, pay_token, status, total
    `)
    .gt("balance_due", 0)
    .in("status", ["sent", "viewed", "overdue", "partially_paid"]);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }

  for (const invoice of invoices || []) {
    scanned += 1;
    const { data: business } = await admin
      .from("businesses")
      .select("name, business_email, timezone")
      .eq("id", invoice.business_id)
      .maybeSingle();
    const tz = business?.timezone || "America/Toronto";
    const today = dateOnlyInTz(new Date().toISOString(), tz);
    const dueDate = invoice.due_date || dateOnlyInTz(invoice.first_sent_at || new Date().toISOString(), tz);

    const { data: settings } = await admin
      .from("tavari_invoice_settings")
      .select("reminder_schedule")
      .eq("business_id", invoice.business_id)
      .maybeSingle();

    const rules = (Array.isArray(settings?.reminder_schedule) ? settings.reminder_schedule : []) as ReminderRule[];
    if (!rules.length) continue;

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      const before = Number(rule.days_before_due) || 0;
      const after = Number(rule.days_after_due) || 0;
      const scheduleKey = `rule-${i}-b${before}-a${after}`;

      const fireDates = new Set<string>();
      if (before > 0) fireDates.add(addDays(dueDate, -before));
      if (after >= 0) fireDates.add(addDays(dueDate, after));

      if (!fireDates.has(today)) continue;

      const { data: already } = await admin
        .from("tavari_invoice_reminder_log")
        .select("id")
        .eq("invoice_id", invoice.id)
        .eq("schedule_key", scheduleKey)
        .gte("sent_at", `${today}T00:00:00`)
        .limit(1);

      if (already?.length) continue;

      const recipientMode = String(rule.recipient || "both").toLowerCase();
      const payUrl = invoice.pay_token ? `${siteUrl}/pay/invoice/${invoice.pay_token}` : null;
      const subject = `Reminder: Invoice ${invoice.invoice_number} — $${Number(invoice.balance_due).toFixed(2)} due`;
      const html = `
        <p>Hello${invoice.recipient_name ? ` ${invoice.recipient_name}` : ""},</p>
        <p>This is a reminder that invoice <strong>${invoice.invoice_number}</strong> has a balance of
        <strong>$${Number(invoice.balance_due).toFixed(2)}</strong> due.</p>
        ${payUrl ? `<p><a href="${payUrl}">Pay now</a></p>` : ""}
        <p>Thank you,<br>${business?.name || "Tavari Business"}</p>`;

      const targets: { type: string; email: string }[] = [];
      if ((recipientMode === "both" || recipientMode === "customer") && invoice.recipient_email) {
        targets.push({ type: "customer", email: invoice.recipient_email });
      }
      if ((recipientMode === "both" || recipientMode === "business") && business?.business_email) {
        targets.push({ type: "business", email: business.business_email });
      }

      for (const target of targets) {
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/mail-send`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              apikey: SUPABASE_SERVICE_ROLE_KEY,
            },
            body: JSON.stringify({
              business_id: invoice.business_id,
              to: target.email,
              subject,
              html,
            }),
          });
          if (!res.ok) {
            console.warn("[invoice-reminder-dispatch] mail failed", await res.text());
            continue;
          }
          await admin.from("tavari_invoice_reminder_log").insert({
            invoice_id: invoice.id,
            business_id: invoice.business_id,
            recipient_type: target.type,
            recipient_email: target.email,
            schedule_key: scheduleKey,
          });
          sent += 1;
        } catch (e) {
          console.warn("[invoice-reminder-dispatch]", e);
        }
      }

      if (invoice.status !== "overdue" && after > 0 && today > dueDate) {
        await admin.from("tavari_invoices").update({ status: "overdue" }).eq("id", invoice.id);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, scanned, sent }), { status: 200, headers: corsHeaders });
});
