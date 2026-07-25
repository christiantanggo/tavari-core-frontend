// Supabase Edge Function: Return status of a Helcim Pay pending session by checkout token.
// Used by the customer portal to poll for completion when the iframe closes (e.g. HIDE) before postMessage SUCCESS.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrCreateBookingSelfServiceToken } from "../_shared/bookingSelfService.ts";
import { syncPendingKioskHelcimFromHelcimApi } from "../_shared/kioskHelcimFinalization.ts";
import { syncPendingBookingHelcimFromHelcimApi } from "../_shared/bookingHelcimSync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    let token: string | null = null;
    if (req.method === "GET") {
      const url = new URL(req.url);
      const q = url.searchParams.get("checkoutToken") || url.searchParams.get("checkout_token");
      token = (q && String(q).trim()) ? String(q).trim() : null;
    } else {
      const body = await req.json().catch(() => ({})) as any;
      const b = body?.checkoutToken ?? body?.checkout_token;
      token = (b && String(b).trim()) ? String(b).trim() : null;
    }
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Missing checkoutToken" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: bookingRow, error: bookingErr } = await supabase
      .from("booking_pending_helcim")
      .select("status, booking_id")
      .eq("checkout_token", token)
      .maybeSingle();

    if (bookingErr) {
      console.error("[helcim-pay-status]", bookingErr);
      return new Response(
        JSON.stringify({ error: "Failed to look up status" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (bookingRow) {
      let status = bookingRow?.status ?? "pending";
      let bookingId = bookingRow?.booking_id ?? null;
      let synced = false;

      if (status === "pending") {
        const syncResult = await syncPendingBookingHelcimFromHelcimApi(supabase, token);
        if (syncResult?.synced) {
          status = "completed";
          bookingId = syncResult.bookingId ?? bookingId;
          synced = true;
        } else if (syncResult?.status) {
          status = syncResult.status;
        }
      }

      let manageToken: string | null = null;

      if (status === "completed" && bookingId) {
        const { data: bRow } = await supabase
          .from("bookings")
          .select("business_id")
          .eq("id", bookingId)
          .maybeSingle();

        if (bRow?.business_id) {
          manageToken = await getOrCreateBookingSelfServiceToken(
            supabase,
            bookingId,
            bRow.business_id,
          );
        }
      }

      return new Response(
        JSON.stringify({ status, bookingId, manageToken, sessionKind: "booking", synced }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: kioskRow, error: kioskErr } = await supabase
      .from("kiosk_helcim_pending")
      .select("status, id, amount, currency, invoice_number, business_id, checkout_token")
      .eq("checkout_token", token)
      .maybeSingle();

    if (kioskErr) {
      console.error("[helcim-pay-status] kiosk", kioskErr);
      return new Response(
        JSON.stringify({ error: "Failed to look up status" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (kioskRow) {
      let status = kioskRow.status ?? "pending";
      if (status === "pending") {
        const synced = await syncPendingKioskHelcimFromHelcimApi(supabase, token);
        if (synced?.status === "completed") status = "completed";
      }

      return new Response(
        JSON.stringify({
          status,
          bookingId: null,
          manageToken: null,
          sessionKind: "kiosk",
          pendingId: kioskRow.id,
          amount: kioskRow.amount,
          currency: kioskRow.currency,
          invoiceNumber: kioskRow.invoice_number,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: invoiceRow, error: invoiceErr } = await supabase
      .from("invoice_pending_helcim")
      .select("status, invoice_id, amount, currency, invoice_number")
      .eq("checkout_token", token)
      .maybeSingle();

    if (invoiceErr) {
      console.error("[helcim-pay-status] invoice", invoiceErr);
      return new Response(
        JSON.stringify({ error: "Failed to look up status" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (invoiceRow) {
      return new Response(
        JSON.stringify({
          status: invoiceRow.status ?? "pending",
          invoiceId: invoiceRow.invoice_id,
          sessionKind: "invoice",
          amount: invoiceRow.amount,
          currency: invoiceRow.currency,
          invoiceNumber: invoiceRow.invoice_number,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ status: "pending", bookingId: null, manageToken: null }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[helcim-pay-status]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
