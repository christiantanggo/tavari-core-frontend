// Public invoice summary by pay_token (no auth).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });

  try {
    let payToken = "";
    if (req.method === "GET") {
      const url = new URL(req.url);
      payToken = String(url.searchParams.get("payToken") ?? url.searchParams.get("pay_token") ?? "").trim();
    } else {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      payToken = String(body.payToken ?? body.pay_token ?? "").trim();
    }

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
      .select(`
        id,
        invoice_number,
        invoice_type,
        status,
        recipient_name,
        recipient_company,
        total,
        balance_due,
        due_date,
        footer_terms,
        notes,
        pay_token,
        email_tracking_token,
        etransfer_customer_notified_at,
        business_id,
        tavari_invoice_line_items ( name, quantity, unit_price, total_price, participant_name )
      `)
      .eq("pay_token", payToken)
      .maybeSingle();

    if (error || !invoice) {
      return new Response(JSON.stringify({ error: "Invoice not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: business } = await supabase
      .from("businesses")
      .select("id, name, business_email, business_phone, business_address, business_city, business_state, business_postal, tax_number")
      .eq("id", invoice.business_id)
      .maybeSingle();

    const { data: settings } = await supabase
      .from("tavari_invoice_settings")
      .select("doing_business_as, e_transfer_password_hint")
      .eq("business_id", invoice.business_id)
      .maybeSingle();

    const { data: branding } = await supabase
      .from("app_branding")
      .select("logo_url")
      .eq("business_id", invoice.business_id)
      .maybeSingle();

    return new Response(
      JSON.stringify({
        invoice,
        business: business ? {
          name: business.name,
          email: business.business_email,
          phone: business.business_phone,
          address: business.business_address,
          city: business.business_city,
          state: business.business_state,
          postal: business.business_postal,
          tax_number: business.tax_number,
          logo_url: branding?.logo_url ?? null,
          dba: settings?.doing_business_as ?? null,
          e_transfer_password_hint: settings?.e_transfer_password_hint ?? "Tanggo",
        } : null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[invoice-public-view]", err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
