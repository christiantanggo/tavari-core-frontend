// Finalize Tavari invoice payment from HelcimPay.js SUCCESS payload.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { finalizePendingInvoice } from "../_shared/invoiceHelcimFinalization.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  return Array.from(new Uint8Array(buf)).map((c) => c.toString(16).padStart(2, "0")).join("");
}

function stableSortedStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableSortedStringify).join(",")}]`;
  const o = obj as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableSortedStringify(o[k])}`).join(",")}}`;
}

async function helcimHashMatches(
  transactionData: Record<string, unknown>,
  secretToken: string,
  expectedHash: string,
): Promise<boolean> {
  for (const json of [JSON.stringify(transactionData), stableSortedStringify(transactionData)]) {
    const ours = await sha256HexUtf8(json + secretToken);
    if (timingSafeEqualHex(ours, expectedHash)) return true;
  }
  return false;
}

function extractTxnAndHash(raw: unknown): { hash: string | null; txn: Record<string, unknown> } | null {
  if (raw == null) return null;
  let root: Record<string, unknown>;
  try {
    root = typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown> : raw as Record<string, unknown>;
  } catch {
    return null;
  }
  let hash = typeof root.hash === "string" ? root.hash.trim() : null;
  if (typeof root.data === "object" && root.data) {
    const d = root.data as Record<string, unknown>;
    if (typeof d.hash === "string") hash = d.hash.trim();
    if (typeof d.invoiceNumber === "string" || d.transactionId != null) return { hash, txn: d };
  }
  if (typeof root.invoiceNumber === "string" || root.transactionId != null) return { hash, txn: root };
  return null;
}

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
    const checkoutToken = String(body.checkoutToken ?? body.checkout_token ?? "").trim();
    const eventMessage = body.eventMessage ?? body.event_message ?? body.payload;

    if (!checkoutToken || checkoutToken.length !== 22) {
      return new Response(JSON.stringify({ error: "Invalid checkoutToken" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: pending, error: pendingError } = await supabase
      .from("invoice_pending_helcim")
      .select("*")
      .eq("checkout_token", checkoutToken)
      .maybeSingle();

    if (pendingError || !pending) {
      return new Response(JSON.stringify({ error: "Pending session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = extractTxnAndHash(eventMessage);
    if (!parsed) {
      return new Response(JSON.stringify({ error: "Invalid Helcim payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { hash, txn } = parsed;
    if (pending.secret_token && hash) {
      const ok = await helcimHashMatches(txn, pending.secret_token, hash);
      if (!ok) {
        return new Response(JSON.stringify({ error: "Hash validation failed" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const invoiceNumber = String(txn.invoiceNumber ?? txn.invoice_number ?? "");
    if (invoiceNumber && invoiceNumber !== pending.invoice_number) {
      return new Response(JSON.stringify({ error: "Invoice number mismatch" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const status = String(txn.status ?? txn.approvalStatus ?? "").toUpperCase();
    if (status && !["APPROVED", "SUCCESS", "COMPLETED"].some((s) => status.includes(s))) {
      return new Response(JSON.stringify({ error: "Payment not approved" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await finalizePendingInvoice({
      supabase,
      pendingId: pending.id,
      transactionId: txn.transactionId ?? txn.transaction_id ?? null,
      amount: txn.amount ?? pending.amount,
      approvalCode: txn.approvalCode ?? txn.approval_code ?? null,
    });

    if (!result.ok) {
      return new Response(JSON.stringify({ error: result.message }), {
        status: result.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, invoiceId: result.invoiceId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[invoice-helcim-pay-finalize]", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
