import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveBookingSelfServiceToken } from "../_shared/bookingSelfService.ts";
import { loadBookingSelfServicePayload } from "../_shared/bookingSelfServicePayload.ts";
import { getHelcimCredentialsForBusiness } from "../_shared/helcimBusinessCredentials.ts";
import {
  hoursUntilBooking,
  normalizeCancellationRules,
  resolveSettlementOnCancel,
  type PaymentSummaryRow,
} from "../_shared/bookingCancellationRules.ts";
import { sendBookingCancellationEmail } from "../_shared/bookingCancellationEmail.ts";
import { insertBookingHistory } from "../_shared/bookingHistoryLog.ts";

const HELCIM_V2 = "https://api.helcim.com/v2";
const TX_STORE_CREDIT = "store_credit";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const nowIso = () => new Date().toISOString();

async function helcimCardRefund(params: {
  apiToken: string;
  originalTransactionId: number;
  amount: number;
  currency?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const idempotencyKey = (`BKCX${crypto.randomUUID().replace(/-/g, "").slice(0, 21)}`).toUpperCase();
  const refundPayload = {
    currency: params.currency ?? "CAD",
    transactionAmount: Number(params.amount.toFixed(2)),
    amount: Number(params.amount.toFixed(2)),
    originalTransactionId: params.originalTransactionId,
    ipAddress: "0.0.0.0",
  };
  const resp = await fetch(`${HELCIM_V2}/payment/refund`, {
    method: "POST",
    headers: {
      "api-token": params.apiToken,
      "idempotency-key": idempotencyKey,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(refundPayload),
  });
  const text = await resp.text();
  if (!resp.ok) return { ok: false, error: text.slice(0, 400) };
  return { ok: true };
}

async function applyStoreCreditRefund(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  loyaltyAccountId: string,
  amount: number,
  bookingRef: string,
): Promise<{ ok: boolean; error?: string }> {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return { ok: true };

  const { data: acc, error: accErr } = await supabase
    .from("pos_loyalty_accounts")
    .select("id, store_credit, business_id")
    .eq("id", loyaltyAccountId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (accErr || !acc) {
    return { ok: false, error: "Customer account not found — cannot issue store credit." };
  }

  const before = Number(acc.store_credit) || 0;
  const after = before + n;
  const ts = nowIso();

  const { error: upErr } = await supabase
    .from("pos_loyalty_accounts")
    .update({
      store_credit: after,
      last_activity: ts,
      updated_at: ts,
    })
    .eq("id", loyaltyAccountId)
    .eq("business_id", businessId);

  if (upErr) {
    return { ok: false, error: upErr.message };
  }

  const line: Record<string, unknown> = {
    business_id: businessId,
    loyalty_account_id: loyaltyAccountId,
    transaction_type: TX_STORE_CREDIT,
    amount: n,
    points: null,
    balance_before: before,
    balance_after: after,
    points_before: 0,
    points_after: 0,
    description: `Booking cancellation credit — ${bookingRef}`,
    processed_at: ts,
    store_credit_category: "refund",
  };

  const ins = await supabase.from("pos_loyalty_transactions").insert(line).select("id").maybeSingle();
  if (ins.error) {
    await supabase
      .from("pos_loyalty_accounts")
      .update({ store_credit: before, last_activity: ts, updated_at: ts })
      .eq("id", loyaltyAccountId)
      .eq("business_id", businessId);
    return { ok: false, error: ins.error.message };
  }

  return { ok: true };
}

async function loadBookingPayload(supabase: ReturnType<typeof createClient>, bookingId: string, businessId: string) {
  return loadBookingSelfServicePayload(supabase, bookingId, businessId);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "lookup";
    const token = typeof body.token === "string" ? body.token.trim() : "";

    if (!token) {
      return jsonResponse({ error: "Missing booking management token" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const tokenRow = await resolveBookingSelfServiceToken(supabase, token);
    if (!tokenRow) {
      return jsonResponse({ error: "Booking management link is invalid or expired" }, 404);
    }

    if (action === "lookup") {
      const payload = await loadBookingPayload(supabase, tokenRow.booking_id, tokenRow.business_id);
      return jsonResponse(payload);
    }

    if (action === "availability") {
      const payload = await loadBookingPayload(supabase, tokenRow.booking_id, tokenRow.business_id);
      const { data: sessions, error: sessionsError } = await supabase
        .from("booking_sessions")
        .select("id, session_date, start_time, end_time, available_spots, max_capacity, status")
        .eq("business_id", tokenRow.business_id)
        .eq("activity_id", payload.booking.activity_id)
        .eq("status", "scheduled")
        .gte("session_date", new Date().toISOString().split("T")[0])
        .order("session_date", { ascending: true })
        .order("start_time", { ascending: true })
        .limit(100);

      if (sessionsError) {
        return jsonResponse({ error: sessionsError.message }, 500);
      }

      const availableSessions = (sessions || []).filter((session: any) =>
        session.id === payload.booking.session_id || Number(session.available_spots || 0) > 0
      );

      return jsonResponse({ sessions: availableSessions, canReschedule: payload.canReschedule });
    }

    if (action === "cancel") {
      const payload = await loadBookingPayload(supabase, tokenRow.booking_id, tokenRow.business_id);
      if (!payload.canCancel) {
        return jsonResponse({
          error: "This booking cannot be cancelled online under the current policy. Contact the business if you need help.",
        }, 400);
      }

      const payments = (payload.payments || []) as PaymentSummaryRow[];
      const rawRules = payload.booking.booking_types?.cancellation_rules;
      const rules = normalizeCancellationRules(
        rawRules && typeof rawRules === "object" ? (rawRules as Record<string, unknown>) : {},
      );
      const huCancel = hoursUntilBooking(payload.booking);
      const settlement = resolveSettlementOnCancel(rules, payments, huCancel);
      const bookingRef = String(payload.booking.booking_number || payload.booking.id).slice(0, 40);

      if (settlement.settlement === "helcim_refund" && settlement.amount > 0) {
        const creds = await getHelcimCredentialsForBusiness(supabase, tokenRow.business_id);
        if (!creds?.apiToken) {
          return jsonResponse({
            error:
              "Automatic card refunds are not enabled for this business. Please contact them to complete your refund.",
          }, 400);
        }
        const completed = payments.filter((p) => p.status === "completed");
        for (const row of completed) {
          const amt = Number(row.amount_paid || 0);
          if (amt <= 0) continue;
          const tidRaw = String((row as any).transaction_id || "").trim();
          const tid = Number(tidRaw);
          if (!tidRaw || !Number.isFinite(tid) || tid <= 0) {
            return jsonResponse({
              error:
                "This payment could not be matched to a card transaction for an automatic refund. Please contact the business.",
            }, 400);
          }
          const refundResult = await helcimCardRefund({
            apiToken: creds.apiToken,
            originalTransactionId: tid,
            amount: amt,
          });
          if (!refundResult.ok) {
            return jsonResponse(
              { error: `Card refund could not be completed: ${refundResult.error || "unknown error"}` },
              502,
            );
          }
          await supabase
            .from("booking_payments")
            .update({
              status: "refunded",
              refund_amount: amt,
              refund_reason: "Customer self-service cancellation (card refund)",
              refunded_at: nowIso(),
              updated_at: nowIso(),
            })
            .eq("id", (row as any).id)
            .eq("booking_id", tokenRow.booking_id);
        }
      } else if (settlement.settlement === "loyalty_credit" && settlement.amount > 0) {
        const customerId = payload.booking.customer_id;
        if (!customerId) {
          return jsonResponse({
            error: "No customer account is linked to this booking — store credit cannot be issued. Please contact the business.",
          }, 400);
        }
        const creditResult = await applyStoreCreditRefund(
          supabase,
          tokenRow.business_id,
          String(customerId),
          settlement.amount,
          bookingRef,
        );
        if (!creditResult.ok) {
          return jsonResponse({ error: creditResult.error || "Could not issue store credit" }, 500);
        }
        const completed = payments.filter((p) => p.status === "completed");
        for (const row of completed) {
          const amt = Number(row.amount_paid || 0);
          if (amt <= 0) continue;
          await supabase
            .from("booking_payments")
            .update({
              status: "refunded",
              refund_amount: amt,
              refund_reason: "Customer self-service cancellation (store credit)",
              refunded_at: nowIso(),
              updated_at: nowIso(),
            })
            .eq("id", (row as any).id)
            .eq("booking_id", tokenRow.booking_id);
        }
      } else if (settlement.settlement === "none") {
        /* policy forfeits payment — leave payment rows as completed for audit */
      }

      const reason = typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : "Cancelled by customer via self-service";

      const cancelledAt = nowIso();

      const { error: cancelError } = await supabase
        .from("bookings")
        .update({
          status: "cancelled",
          status_before_cancellation: payload.booking.status || "confirmed",
          cancellation_reason: reason,
          cancelled_at: cancelledAt,
          updated_at: cancelledAt,
        })
        .eq("id", tokenRow.booking_id)
        .eq("business_id", tokenRow.business_id);

      if (cancelError) {
        return jsonResponse({ error: cancelError.message }, 500);
      }

      await insertBookingHistory(supabase, {
        businessId: tokenRow.business_id,
        bookingId: tokenRow.booking_id,
        actionType: "booking.cancelled",
        summary: "Booking cancelled by customer",
        details: {
          reason,
          changes: [{ field: "Status", from: payload.booking.status || "confirmed", to: "cancelled" }],
        },
      });

      try {
        await sendBookingCancellationEmail(supabase, {
          businessId: tokenRow.business_id,
          bookingId: tokenRow.booking_id,
          cancelledBy: "customer",
          reason,
          cancelledAt,
        });
      } catch (emailErr) {
        console.error("[manage-booking-self-service] cancellation email failed:", emailErr);
      }

      const updated = await loadBookingPayload(supabase, tokenRow.booking_id, tokenRow.business_id);
      return jsonResponse(updated);
    }

    if (action === "reschedule") {
      const payload = await loadBookingPayload(supabase, tokenRow.booking_id, tokenRow.business_id);
      if (!payload.canReschedule) {
        return jsonResponse({
          error: "This booking cannot be rescheduled online under the current policy. Contact the business if you need a different time.",
        }, 400);
      }

      const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
      if (!sessionId) {
        return jsonResponse({ error: "Missing target session" }, 400);
      }

      const { data: session, error: sessionError } = await supabase
        .from("booking_sessions")
        .select("id, activity_id, session_date, start_time, status, available_spots")
        .eq("id", sessionId)
        .eq("business_id", tokenRow.business_id)
        .single();

      if (sessionError || !session || session.activity_id !== payload.booking.activity_id) {
        return jsonResponse({ error: "Selected session is not valid for this booking" }, 400);
      }

      if (session.id !== payload.booking.session_id && Number(session.available_spots || 0) <= 0) {
        return jsonResponse({ error: "Selected session is no longer available" }, 400);
      }

      const { error: updateError } = await supabase
        .from("bookings")
        .update({
          session_id: session.id,
          booking_date: session.session_date,
          booking_time: session.start_time,
          updated_at: nowIso(),
        })
        .eq("id", tokenRow.booking_id)
        .eq("business_id", tokenRow.business_id);

      if (updateError) {
        return jsonResponse({ error: updateError.message }, 500);
      }

      const updated = await loadBookingPayload(supabase, tokenRow.booking_id, tokenRow.business_id);
      return jsonResponse(updated);
    }

    if (action === "activity_tab_list") {
      const listAction = typeof body.listAction === "string" ? body.listAction.trim() : "list";
      const tabId = typeof body.tabId === "string" ? body.tabId.trim() : "";
      const listKey = typeof body.listKey === "string" && body.listKey.trim()
        ? body.listKey.trim()
        : "default";
      if (!tabId) {
        return jsonResponse({ error: "Missing tabId" }, 400);
      }

      const { data: tab, error: tabError } = await supabase
        .from("booking_activity_tabs")
        .select("id, business_id, activity_id, is_active, audience, content_blocks")
        .eq("id", tabId)
        .eq("business_id", tokenRow.business_id)
        .maybeSingle();

      if (tabError || !tab || tab.is_active === false) {
        return jsonResponse({ error: "Tab not found" }, 404);
      }
      if (tab.audience === "staff") {
        return jsonResponse({ error: "Tab is not available to customers" }, 403);
      }

      const payload = await loadBookingPayload(supabase, tokenRow.booking_id, tokenRow.business_id);
      if (payload.booking.activity_id !== tab.activity_id) {
        return jsonResponse({ error: "Tab does not belong to this booking" }, 403);
      }

      const blocks = Array.isArray(tab.content_blocks) ? tab.content_blocks : [];
      const listBlock = blocks.find((block: { type?: string; list_key?: string }) =>
        block?.type === "list" && String(block?.list_key || "default") === listKey
      );
      if (!listBlock) {
        return jsonResponse({ error: "List not found on this tab" }, 404);
      }
      const allowCustomerEdit = (listBlock as { allow_customer_edit?: boolean }).allow_customer_edit !== false;

      if (listAction === "list") {
        const { data: items, error: itemsError } = await supabase
          .from("booking_activity_tab_list_items")
          .select("*")
          .eq("business_id", tokenRow.business_id)
          .eq("booking_id", tokenRow.booking_id)
          .eq("tab_id", tabId)
          .eq("list_key", listKey)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
        if (itemsError) return jsonResponse({ error: itemsError.message }, 500);
        return jsonResponse({ items: items || [], allowCustomerEdit });
      }

      if (!allowCustomerEdit) {
        return jsonResponse({ error: "Customers cannot edit this list" }, 403);
      }

      if (listAction === "add") {
        const label = typeof body.label === "string" ? body.label.trim() : "";
        if (!label) return jsonResponse({ error: "Missing label" }, 400);
        const { count } = await supabase
          .from("booking_activity_tab_list_items")
          .select("id", { count: "exact", head: true })
          .eq("booking_id", tokenRow.booking_id)
          .eq("tab_id", tabId)
          .eq("list_key", listKey);
        const { data: inserted, error: insertError } = await supabase
          .from("booking_activity_tab_list_items")
          .insert({
            business_id: tokenRow.business_id,
            booking_id: tokenRow.booking_id,
            tab_id: tabId,
            list_key: listKey,
            label,
            sort_order: count || 0,
            created_source: "customer",
          })
          .select("*")
          .single();
        if (insertError) return jsonResponse({ error: insertError.message }, 500);
        return jsonResponse({ item: inserted });
      }

      if (listAction === "toggle") {
        const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
        if (!itemId) return jsonResponse({ error: "Missing itemId" }, 400);
        const { data: existing, error: existingError } = await supabase
          .from("booking_activity_tab_list_items")
          .select("id, is_done")
          .eq("id", itemId)
          .eq("business_id", tokenRow.business_id)
          .eq("booking_id", tokenRow.booking_id)
          .eq("tab_id", tabId)
          .maybeSingle();
        if (existingError || !existing) return jsonResponse({ error: "Item not found" }, 404);
        const { data: updated, error: updateError } = await supabase
          .from("booking_activity_tab_list_items")
          .update({ is_done: !existing.is_done, updated_at: nowIso() })
          .eq("id", itemId)
          .select("*")
          .single();
        if (updateError) return jsonResponse({ error: updateError.message }, 500);
        return jsonResponse({ item: updated });
      }

      if (listAction === "remove") {
        const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
        if (!itemId) return jsonResponse({ error: "Missing itemId" }, 400);
        const { error: deleteError } = await supabase
          .from("booking_activity_tab_list_items")
          .delete()
          .eq("id", itemId)
          .eq("business_id", tokenRow.business_id)
          .eq("booking_id", tokenRow.booking_id)
          .eq("tab_id", tabId);
        if (deleteError) return jsonResponse({ error: deleteError.message }, 500);
        return jsonResponse({ ok: true });
      }

      return jsonResponse({ error: "Unsupported listAction" }, 400);
    }

    return jsonResponse({ error: "Unsupported action" }, 400);
  } catch (error) {
    console.error("[manage-booking-self-service]", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Server error" },
      500,
    );
  }
});
