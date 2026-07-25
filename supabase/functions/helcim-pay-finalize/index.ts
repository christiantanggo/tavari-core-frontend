// Complete customer-portal booking using HelcimPay.js SUCCESS payload (hash-validated).
// Does not rely on webhooks — fixes stuck UI when Helcim approved payment but finalize never ran.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { finalizePendingBooking } from "../_shared/bookingFinalization.ts";
import { getOrCreateBookingSelfServiceToken } from "../_shared/bookingSelfService.ts";
import { syncBookingHelcimCardFromInvoices } from "../_shared/bookingHelcimSync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function timingSafeEqualHex(a: string, b: string): boolean {
  const aa = String(a || "").toLowerCase().trim();
  const bb = String(b || "").toLowerCase().trim();
  if (aa.length !== bb.length) return false;
  let x = 0;
  for (let i = 0; i < aa.length; i++) x |= aa.charCodeAt(i) ^ bb.charCodeAt(i);
  return x === 0;
}

async function sha256HexUtf8(message: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message));
  return Array.from(new Uint8Array(buf))
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("");
}

function stableSortedStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return `[${obj.map(stableSortedStringify).join(",")}]`;
  }
  const o = obj as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableSortedStringify(o[k])}`).join(",")}}`;
}

/** Helcim: SHA256( canonical_json(transactionData) + secretToken ) === hash */
async function helcimHashMatches(
  transactionData: Record<string, unknown>,
  secretToken: string,
  expectedHash: string,
): Promise<boolean> {
  const variants = [
    JSON.stringify(transactionData),
    stableSortedStringify(transactionData),
  ];
  for (const json of variants) {
    const ours = await sha256HexUtf8(json + secretToken);
    if (timingSafeEqualHex(ours, expectedHash)) return true;
  }
  return false;
}

function extractTxnAndHash(raw: unknown): {
  hash: string | null;
  txn: Record<string, unknown>;
} | null {
  if (raw == null) return null;

  let root: Record<string, unknown>;
  try {
    root = typeof raw === "string"
      ? (JSON.parse(raw) as Record<string, unknown>)
      : (raw as Record<string, unknown>);
  } catch {
    return null;
  }
  if (!root || typeof root !== "object") return null;

  let hash: string | null =
    typeof root.hash === "string" && root.hash.trim() ? root.hash.trim() : null;

  // { hash, data: { ...txn fields } }
  if (typeof root.data === "object" && root.data !== null) {
    const d = root.data as Record<string, unknown>;
    if (typeof d.hash === "string" && d.hash.trim()) hash = d.hash.trim();

    const innerData = d.data;
    if (typeof innerData === "object" && innerData !== null) {
      const txn = innerData as Record<string, unknown>;
      if (typeof txn.invoiceNumber === "string" || txn.transactionId != null) {
        return { hash, txn };
      }
    }

    if (typeof d.invoiceNumber === "string" || d.transactionId != null) {
      return { hash, txn: d };
    }
  }

  if (typeof root.invoiceNumber === "string" || root.transactionId != null) {
    return { hash, txn: root };
  }

  return null;
}

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
    const checkoutToken = String(body.checkoutToken ?? body.checkout_token ?? "").trim();
    const eventMessage = body.eventMessage ?? body.event_message ?? body.payload;

    if (!checkoutToken || checkoutToken.length !== 22) {
      return new Response(JSON.stringify({ error: "Missing or invalid checkoutToken" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (eventMessage === undefined || eventMessage === null) {
      return new Response(JSON.stringify({ error: "Missing eventMessage from HelcimPay SUCCESS" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: pending, error: pendingErr } = await supabase
      .from("booking_pending_helcim")
      .select("id, invoice_number, secret_token, status, booking_id, customer_id, business_id")
      .eq("checkout_token", checkoutToken)
      .maybeSingle();

    if (pendingErr) {
      console.error("[helcim-pay-finalize] load pending:", pendingErr);
      return new Response(JSON.stringify({ error: "Database error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!pending) {
      return new Response(JSON.stringify({ error: "Checkout session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (pending.status === "completed" && pending.booking_id) {
      const { data: bookingRow } = await supabase
        .from("bookings")
        .select("business_id")
        .eq("id", pending.booking_id)
        .maybeSingle();
      let manageToken: string | null = null;
      if (bookingRow?.business_id) {
        manageToken = await getOrCreateBookingSelfServiceToken(
          supabase,
          pending.booking_id,
          bookingRow.business_id,
        );
      }
      return new Response(
        JSON.stringify({
          ok: true,
          alreadyCompleted: true,
          bookingId: pending.booking_id,
          manageToken,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const extracted = extractTxnAndHash(eventMessage);
    if (!extracted) {
      return new Response(JSON.stringify({ error: "Could not parse Helcim payment response" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { hash, txn } = extracted;
    const secretToken = typeof pending.secret_token === "string" ? pending.secret_token.trim() : "";

    if (!secretToken) {
      return new Response(
        JSON.stringify({
          error:
            "Checkout session is missing secrets — start checkout again or contact support with your payment receipt.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!hash) {
      return new Response(JSON.stringify({ error: "Missing hash on Helcim payment response" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const valid = await helcimHashMatches(txn, secretToken, hash);
    if (!valid) {
      console.error("[helcim-pay-finalize] Hash mismatch — rejecting finalize");
      return new Response(JSON.stringify({ error: "Invalid payment signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const invoiceNumber = String(txn.invoiceNumber ?? "").trim();
    if (invoiceNumber !== pending.invoice_number) {
      return new Response(JSON.stringify({ error: "Invoice mismatch" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const st = String(txn.status ?? "").toUpperCase();
    if (!st.includes("APPROVED") && !st.includes("APPROVAL")) {
      return new Response(JSON.stringify({ error: "Payment not approved in Helcim response" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const finalized = await finalizePendingBooking({
      supabase,
      pendingId: pending.id,
      transactionId: txn.transactionId != null ? String(txn.transactionId) : null,
      amount: txn.amount,
      approvalCode: txn.approvalCode != null ? String(txn.approvalCode) : null,
      recoverPaidCheckout: true,
    });

    if (!finalized.ok) {
      return new Response(
        JSON.stringify({
          error: finalized.message,
          detail: finalized.status,
        }),
        {
          status: finalized.status >= 400 ? finalized.status : 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const customerCodeFromTxn = String(txn.customerCode ?? txn.customer_code ?? "").trim();
    if (customerCodeFromTxn && pending.customer_id && pending.business_id) {
      await supabase
        .from("pos_loyalty_accounts")
        .update({ helcim_customer_code: customerCodeFromTxn })
        .eq("id", pending.customer_id)
        .eq("business_id", pending.business_id);
    } else if (finalized.bookingId && pending.business_id) {
      await syncBookingHelcimCardFromInvoices(supabase, pending.business_id, finalized.bookingId);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        bookingId: finalized.bookingId,
        manageToken: finalized.manageToken,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[helcim-pay-finalize]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
