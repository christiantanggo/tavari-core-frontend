// Customer tapped "I'll pay by e-transfer" — notify business manager.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolvePublicSiteUrl } from "../_shared/invoicePublicSiteUrl.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BOOKING_FROM = "noreply@tavarios.ca";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const payToken = String(body.payToken ?? body.pay_token ?? "").trim();
    const siteUrl = resolvePublicSiteUrl(String(body.siteUrl ?? body.site_url ?? ""));

    if (!payToken) {
      return new Response(JSON.stringify({ error: "Missing payToken" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: invoice, error } = await supabase
      .from("tavari_invoices")
      .select("id, business_id, invoice_number, recipient_name, recipient_email, total, balance_due, status, pay_token, etransfer_confirm_token, etransfer_customer_notified_at")
      .eq("pay_token", payToken)
      .maybeSingle();

    if (error || !invoice) {
      return new Response(JSON.stringify({ error: "Invoice not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (invoice.status === "paid" || Number(invoice.balance_due) <= 0.01) {
      return new Response(JSON.stringify({ ok: true, alreadyPaid: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const confirmToken = invoice.etransfer_confirm_token || crypto.randomUUID();
    const notifiedAt = new Date().toISOString();

    await supabase
      .from("tavari_invoices")
      .update({
        etransfer_confirm_token: confirmToken,
        etransfer_customer_notified_at: notifiedAt,
        updated_at: notifiedAt,
      })
      .eq("id", invoice.id);

    const { data: business } = await supabase
      .from("businesses")
      .select("name, business_email")
      .eq("id", invoice.business_id)
      .maybeSingle();

    const managerEmail = String(business?.business_email || "").trim();
    if (!managerEmail) {
      return new Response(JSON.stringify({
        ok: true,
        notified: false,
        warning: "Business email is not configured — manager was not notified",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const confirmUrl = `${siteUrl}/pay/invoice/etransfer-confirm/${confirmToken}`;
    const amount = Number(invoice.balance_due ?? invoice.total ?? 0).toFixed(2);
    const businessName = business?.name || "Your business";

    const html = `
      <p><strong>${invoice.recipient_name || "A customer"}</strong> indicated they will pay invoice
      <strong>${invoice.invoice_number}</strong> ($${amount}) by e-transfer.</p>
      <p>Customer email: ${invoice.recipient_email || "Not provided"}</p>
      <p>When the e-transfer arrives in your bank account, confirm receipt to mark the invoice paid:</p>
      <p style="margin:24px 0;">
        <a href="${confirmUrl}" style="display:inline-block;padding:12px 24px;background:#008080;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">
          E-transfer received
        </a>
      </p>
      <p style="font-size:13px;color:#666;">Or open: <a href="${confirmUrl}">${confirmUrl}</a></p>
    `;

    const mailRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mail-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      },
      body: JSON.stringify({
        businessId: invoice.business_id,
        emailType: "transactional",
        to: managerEmail,
        fromEmail: BOOKING_FROM,
        fromName: businessName,
        subject: `E-transfer pending — Invoice ${invoice.invoice_number} (${invoice.recipient_name || "customer"})`,
        html,
        sourceModule: "invoices",
        sourceId: invoice.id,
      }),
    });

    if (!mailRes.ok) {
      const errText = await mailRes.text();
      console.error("[invoice-etransfer-notify] mail-send failed:", errText);
      return new Response(JSON.stringify({ error: "Could not notify manager by email" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mailJson = await mailRes.json().catch(() => ({}));
    if (!mailJson?.ok) {
      return new Response(JSON.stringify({ error: mailJson?.error || "Email send rejected" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, notified: true, notifiedAt }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[invoice-etransfer-notify]", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
