// Initialize HelcimPay.js for a Tavari invoice (public pay link or dashboard).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getHelcimCredentialsForBusiness } from "../_shared/helcimBusinessCredentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const payToken = String(body.payToken ?? body.pay_token ?? "").trim();
    const invoiceId = String(body.invoiceId ?? body.invoice_id ?? "").trim();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let invoiceQuery = supabase.from("tavari_invoices").select("*");
    if (payToken) invoiceQuery = invoiceQuery.eq("pay_token", payToken);
    else if (invoiceId) invoiceQuery = invoiceQuery.eq("id", invoiceId);
    else {
      return new Response(JSON.stringify({ error: "Missing payToken or invoiceId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: invoice, error: invoiceError } = await invoiceQuery.maybeSingle();
    if (invoiceError || !invoice) {
      return new Response(JSON.stringify({ error: "Invoice not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (["void", "paid", "refunded"].includes(String(invoice.status))) {
      return new Response(JSON.stringify({ error: "Invoice is not payable" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const balanceDue = amountToNumber(invoice.balance_due ?? invoice.total);
    if (balanceDue <= 0) {
      return new Response(JSON.stringify({ error: "No balance due" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const creds = await getHelcimCredentialsForBusiness(supabase, invoice.business_id);
    if (!creds?.apiToken) {
      return new Response(JSON.stringify({ error: "Online payments are not configured for this business" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pendingId = crypto.randomUUID();
    const invoiceNumber = `IP-${pendingId}`;
    const currency = "CAD";
    const amt = Number(balanceDue.toFixed(2));

    const { error: pendingInsertError } = await supabase.from("invoice_pending_helcim").insert({
      id: pendingId,
      invoice_number: invoiceNumber,
      invoice_id: invoice.id,
      business_id: invoice.business_id,
      amount: amt,
      currency,
      status: "pending",
    });

    if (pendingInsertError) {
      console.error("[invoice-helcim-pay-init]", pendingInsertError);
      return new Response(JSON.stringify({ error: "Could not start payment session" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase
      .from("tavari_invoices")
      .update({ helcim_pending_id: pendingId, updated_at: new Date().toISOString() })
      .eq("id", invoice.id);

    const invoiceRequest = {
      currency,
      invoiceNumber,
      lineItems: [{
        description: `Invoice ${invoice.invoice_number}`,
        quantity: 1,
        price: amt,
        total: amt,
      }],
    };

    const payload = {
      paymentType: "purchase",
      amount: amt,
      currency,
      invoiceRequest,
      customStyling: { appearance: "light", brandColor: "008080", cornerRadius: "rounded", ctaButtonText: "pay" },
      confirmationScreen: true,
    };

    const initRes = await fetch("https://api.helcim.com/v2/helcim-pay/initialize", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-token": creds.apiToken,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const raw = await initRes.text();
    let data: Record<string, unknown> = {};
    try {
      data = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    } catch {
      data = {};
    }

    if (!initRes.ok) {
      await supabase
        .from("invoice_pending_helcim")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", pendingId);
      return new Response(JSON.stringify({ error: data?.message || raw || "Helcim init failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const checkoutToken = (data.checkoutToken ?? data.checkout_token) as string | undefined;
    const secretToken = (data.secretToken ?? data.secret_token) as string | undefined;
    if (!checkoutToken) {
      await supabase
        .from("invoice_pending_helcim")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", pendingId);
      return new Response(JSON.stringify({ error: "No checkout token from Helcim" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase
      .from("invoice_pending_helcim")
      .update({
        checkout_token: checkoutToken,
        secret_token: secretToken ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pendingId);

    return new Response(
      JSON.stringify({
        checkoutToken,
        amount: amt,
        currency,
        invoiceNumber: invoice.invoice_number,
        businessId: invoice.business_id,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[invoice-helcim-pay-init]", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function amountToNumber(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
