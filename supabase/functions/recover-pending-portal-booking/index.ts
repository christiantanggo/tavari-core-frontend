import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { finalizePendingBooking } from "../_shared/bookingFinalization.ts";
import { getHelcimCredentialsForBusiness } from "../_shared/helcimBusinessCredentials.ts";
import { syncBookingHelcimCardFromInvoices } from "../_shared/bookingHelcimSync.ts";
import { searchHelcimApprovedTransaction } from "../_shared/kioskHelcimFinalization.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const pendingId = String(body.pendingId || body.pending_id || "").trim();
    const transactionId = String(body.transactionId || body.transaction_id || "").trim() || null;
    const amount = body.amount != null ? Number(body.amount) : null;

    if (!pendingId) {
      return new Response(JSON.stringify({ error: "pendingId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: pending } = await supabase
      .from("booking_pending_helcim")
      .select("id, invoice_number, amount, business_id, status, booking_id, created_at")
      .eq("id", pendingId)
      .maybeSingle();

    if (!pending) {
      return new Response(JSON.stringify({ error: "Pending row not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (pending.status === "completed" && pending.booking_id) {
      return new Response(JSON.stringify({
        ok: true,
        alreadyCompleted: true,
        bookingId: pending.booking_id,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let txnId = transactionId;
    let txnAmount = amount;
    let approvalCode: string | null = null;
    let customerCode: string | null = null;

    if (!txnId && pending.invoice_number) {
      const creds = await getHelcimCredentialsForBusiness(supabase, pending.business_id);
      if (creds?.apiToken) {
        const hit = await searchHelcimApprovedTransaction(creds.apiToken, pending.invoice_number, {
          amount: Number(pending.amount),
          dateFrom: pending.created_at,
          dateTo: new Date().toISOString(),
        });
        if (hit) {
          txnId = hit.transactionId;
          txnAmount = hit.amount;
          approvalCode = hit.approvalCode;
          customerCode = hit.customerCode;
        }
      }
    }

    if (!txnId) {
      return new Response(JSON.stringify({
        error: "No approved Helcim transaction found. Pass transactionId manually.",
        pending,
      }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const finalized = await finalizePendingBooking({
      supabase,
      pendingId,
      transactionId: txnId,
      amount: txnAmount ?? pending.amount,
      approvalCode,
      customerCode,
      recoverPaidCheckout: true,
    });

    let cardSynced = false;
    if (finalized.ok && finalized.bookingId) {
      const cardResult = await syncBookingHelcimCardFromInvoices(
        supabase,
        pending.business_id,
        finalized.bookingId,
      );
      cardSynced = cardResult.synced;
    }

    return new Response(JSON.stringify({ ...finalized, transactionId: txnId, cardSynced }), {
      status: finalized.ok ? 200 : (finalized.status >= 400 ? finalized.status : 500),
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
