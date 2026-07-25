// Manager confirms e-transfer received — marks invoice paid.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { finalizeInvoiceManualPayment } from "../_shared/invoiceManualPaymentFinalization.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });

  try {
    let confirmToken = "";
    if (req.method === "GET") {
      const url = new URL(req.url);
      confirmToken = String(url.searchParams.get("token") ?? url.searchParams.get("confirmToken") ?? "").trim();
    } else if (req.method === "POST") {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      confirmToken = String(body.confirmToken ?? body.confirm_token ?? body.token ?? "").trim();
    } else {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!confirmToken) {
      return new Response(JSON.stringify({ error: "Missing confirm token" }), {
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
      .select(`
        id,
        invoice_number,
        recipient_name,
        recipient_email,
        total,
        balance_due,
        status,
        due_date,
        business_id,
        etransfer_customer_notified_at,
        etransfer_confirmed_at,
        tavari_invoice_line_items ( name, quantity, total_price, unit_price )
      `)
      .eq("etransfer_confirm_token", confirmToken)
      .maybeSingle();

    if (error || !invoice) {
      return new Response(JSON.stringify({ error: "Invalid or expired confirmation link" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: business } = await supabase
      .from("businesses")
      .select("name")
      .eq("id", invoice.business_id)
      .maybeSingle();

    if (req.method === "GET") {
      return new Response(JSON.stringify({
        ok: true,
        invoice,
        business: business ? { name: business.name } : null,
        canConfirm: invoice.status !== "paid" && Number(invoice.balance_due) > 0.01,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await finalizeInvoiceManualPayment(supabase, invoice.id, {
      paymentMethod: "e_transfer",
      referenceNumber: `ET-${invoice.invoice_number}`,
      confirmedVia: "etransfer_manager_confirm",
    });

    if (!result.ok) {
      return new Response(JSON.stringify({ error: result.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      invoiceId: result.invoiceId,
      alreadyPaid: !!result.alreadyPaid,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[invoice-etransfer-confirm]", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
