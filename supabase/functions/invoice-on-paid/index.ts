// Post-payment hooks: ERPNext AR sync + accounting batch alignment.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  alignPosSaleToPaymentDate,
  syncPaidInvoiceToErpNext,
} from "../_shared/invoiceErpNextSync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
    const invoiceId = String(body.invoice_id ?? body.invoiceId ?? "").trim();
    if (!invoiceId) {
      return new Response(JSON.stringify({ error: "Missing invoice_id" }), {
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
      .select("id, business_id, pos_sale_id, status, balance_due")
      .eq("id", invoiceId)
      .maybeSingle();

    if (error || !invoice) {
      return new Response(JSON.stringify({ error: "Invoice not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (invoice.pos_sale_id) {
      await alignPosSaleToPaymentDate(supabase, invoice.pos_sale_id, invoice.business_id);
    }

    let erpResult: Record<string, unknown> = { ok: true, skipped: true };
    if (invoice.status === "paid" || Number(invoice.balance_due) <= 0.01) {
      const sync = await syncPaidInvoiceToErpNext(supabase, invoiceId);
      erpResult = sync.ok
        ? {
            ok: true,
            salesInvoiceName: sync.salesInvoiceName,
            paymentEntryName: sync.paymentEntryName,
            skipped: !!sync.skipped,
          }
        : { ok: false, error: sync.error };
    }

    return new Response(JSON.stringify({ ok: true, erp: erpResult }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[invoice-on-paid]", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
