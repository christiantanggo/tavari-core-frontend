import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getDateInTimeZone } from "../_shared/invoiceRecurringSchedule.ts";
import {
  generateRecurringInvoice,
  resolvePublicSiteUrl,
} from "../_shared/recurringInvoiceGeneration.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-invoice-recurring-dispatch-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

async function authorizeCron(req: Request, admin: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return true;
  const requestSecret = (req.headers.get("x-invoice-recurring-dispatch-cron-secret") || "").trim();
  if (!requestSecret) return false;
  const { data } = await admin
    .from("system_runtime_secrets")
    .select("secret_value")
    .eq("key_name", "invoice_recurring_dispatch_cron_secret")
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
  let scanned = 0;
  let generated = 0;
  let skipped = 0;
  const errors: { templateId: string; error: string }[] = [];

  const { data: templates, error } = await admin
    .from("tavari_recurring_invoices")
    .select(`
      *,
      tavari_recurring_invoice_line_items (*)
    `)
    .eq("status", "active");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }

  for (const template of templates || []) {
    scanned += 1;

    const { data: business } = await admin
      .from("businesses")
      .select("timezone")
      .eq("id", template.business_id)
      .maybeSingle();

    const tz = business?.timezone || "America/Toronto";
    const today = getDateInTimeZone(new Date(), tz);
    const plannedDate = template.next_run_date;

    if (!plannedDate || plannedDate > today) {
      skipped += 1;
      continue;
    }

    const result = await generateRecurringInvoice(admin, template, plannedDate, {
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
      siteUrl,
    });

    if (result.ok && !result.skipped) {
      generated += 1;
    } else if (result.skipped) {
      skipped += 1;
    } else if (result.error) {
      errors.push({ templateId: template.id, error: result.error });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, scanned, generated, skipped, errors }),
    { status: 200, headers: corsHeaders },
  );
});
