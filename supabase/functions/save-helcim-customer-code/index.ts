// Supabase Edge Function: Save Helcim customer code to pos_loyalty_accounts after payment.
// Called from customer portal when Helcim returns customerCode in the SUCCESS message.
// Uses checkoutToken to look up the pending row and customer_id, then updates the loyalty account.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getHelcimCredentialsForBusiness } from "../_shared/helcimBusinessCredentials.ts";
import { fetchHelcimDefaultCard } from "../_shared/helcimCardOnFile.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
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
    const body = (await req.json().catch(() => ({}))) as any;
    const action = String(body?.action || "sync").trim();
    const checkoutToken = (body?.checkoutToken ?? body?.checkout_token)?.trim();
    const customerCode = (body?.customerCode ?? body?.customer_code)?.trim();
    const businessId = String(body?.businessId ?? body?.business_id ?? "").trim();
    const directCustomerId = String(body?.customerId ?? body?.customer_id ?? "").trim();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const fetchDefaultCard = async (
      resolvedCustomerCode: string | null,
      helcimApiToken: string | null,
    ) => {
      if (!resolvedCustomerCode || !helcimApiToken) return null;
      return fetchHelcimDefaultCard(resolvedCustomerCode, helcimApiToken);
    };

    const resolveCustomerRecord = async () => {
      if (directCustomerId && businessId) {
        const { data, error } = await supabase
          .from("pos_loyalty_accounts")
          .select("id, helcim_customer_code, business_id")
          .eq("id", directCustomerId)
          .eq("business_id", businessId)
          .maybeSingle();

        if (error || !data) {
          throw new Error("Customer not found for this business");
        }

        return data;
      }

      if (!checkoutToken) {
        throw new Error("Missing checkoutToken or customerId/businessId");
      }

      const { data: pending, error: pendingError } = await supabase
        .from("booking_pending_helcim")
        .select("customer_id, business_id")
        .eq("checkout_token", checkoutToken)
        .maybeSingle();

      if (pendingError || !pending?.customer_id) {
        throw new Error("Pending not found or no customer");
      }

      const { data, error } = await supabase
        .from("pos_loyalty_accounts")
        .select("id, helcim_customer_code, business_id")
        .eq("id", pending.customer_id)
        .maybeSingle();

      if (error || !data) {
        throw new Error("Customer account not found");
      }

      return data;
    };

    const customerRecord = await resolveCustomerRecord();

    const resolvedBusinessId =
      businessId ||
      String((customerRecord as { business_id?: string }).business_id || "").trim();
    const helcimCreds = await getHelcimCredentialsForBusiness(
      supabase,
      resolvedBusinessId || undefined,
    );
    const helcimApiToken = helcimCreds?.apiToken ?? null;

    const nextCustomerCode = customerCode || customerRecord.helcim_customer_code || null;

    if (action !== "getDefaultCard" && customerCode) {
      const { error: updateError } = await supabase
        .from("pos_loyalty_accounts")
        .update({ helcim_customer_code: customerCode })
        .eq("id", customerRecord.id);

      if (updateError) {
        console.error("[save-helcim-customer-code]", updateError);
        return new Response(
          JSON.stringify({ ok: false, error: updateError.message }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    let defaultCard = null;
    try {
      defaultCard = await fetchDefaultCard(nextCustomerCode, helcimApiToken);
    } catch (cardError) {
      console.error("[save-helcim-customer-code] fetchDefaultCard error", cardError);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        customerCode: nextCustomerCode,
        defaultCard,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[save-helcim-customer-code]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
