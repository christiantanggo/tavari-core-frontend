// Public (anon) customer portal: upsert booking_portal_funnel row for abandonment tracking.
// POST { businessId, activityId, clientSessionKey, stage, customerId?, customerEmail?, pendingHelcimId? }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const ALLOWED_STAGES = new Set([
  "activity_view",
  "date_time",
  "participants",
  "tickets",
  "payment",
  "payment_started",
  "converted",
]);

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const businessId = body.businessId ? String(body.businessId).trim() : "";
    const activityId = body.activityId ? String(body.activityId).trim() : "";
    const clientSessionKey = body.clientSessionKey ? String(body.clientSessionKey).trim() : "";
    const stage = body.stage ? String(body.stage).trim() : "";
    const customerId = body.customerId ? String(body.customerId).trim() : null;
    const customerEmail = body.customerEmail ? String(body.customerEmail).trim().toLowerCase() : null;
    const pendingHelcimId = body.pendingHelcimId ? String(body.pendingHelcimId).trim() : null;

    if (!businessId || !activityId || !clientSessionKey || !stage) {
      return json({ error: "Missing businessId, activityId, clientSessionKey, or stage" }, 400);
    }
    if (!ALLOWED_STAGES.has(stage)) {
      return json({ error: "Invalid stage" }, 400);
    }

    const { data: activity, error: actErr } = await supabase
      .from("booking_activities")
      .select("id, business_id, is_active")
      .eq("id", activityId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (actErr || !activity || activity.is_active === false) {
      return json({ error: "Activity not found" }, 404);
    }

    const now = new Date().toISOString();

    const { data: existing } = await supabase
      .from("booking_portal_funnel")
      .select("id, current_stage, customer_id, customer_email, pending_helcim_id")
      .eq("business_id", businessId)
      .eq("activity_id", activityId)
      .eq("client_session_key", clientSessionKey)
      .maybeSingle();

    const existingRank = stageRank(existing?.current_stage || "activity_view");
    const newRank = stageRank(stage);
    const resolvedStage = existing && existingRank > newRank ? (existing.current_stage as string) : stage;

    const row: Record<string, unknown> = {
      business_id: businessId,
      activity_id: activityId,
      client_session_key: clientSessionKey,
      last_activity_at: now,
      updated_at: now,
      current_stage: resolvedStage,
    };

    if (customerId) row.customer_id = customerId;
    if (customerEmail) row.customer_email = customerEmail;
    if (pendingHelcimId) row.pending_helcim_id = pendingHelcimId;

    if (existing?.id) {
      const patch: Record<string, unknown> = {
        last_activity_at: now,
        updated_at: now,
        current_stage: resolvedStage,
      };
      if (customerId) patch.customer_id = customerId;
      if (customerEmail) patch.customer_email = customerEmail;
      if (pendingHelcimId) patch.pending_helcim_id = pendingHelcimId;
      const { error: upErr } = await supabase
        .from("booking_portal_funnel")
        .update(patch)
        .eq("id", existing.id);
      if (upErr) {
        console.error("[record-booking-funnel-activity]", upErr);
        return json({ error: "Update failed" }, 500);
      }
    } else {
      row.created_at = now;
      const { error: insErr } = await supabase.from("booking_portal_funnel").insert(row);
      if (insErr) {
        console.error("[record-booking-funnel-activity]", insErr);
        return json({ error: "Insert failed" }, 500);
      }
    }

    return json({ ok: true }, 200);
  } catch (e) {
    console.error("[record-booking-funnel-activity]", e);
    return json({ error: e instanceof Error ? e.message : "Server error" }, 500);
  }
});

function stageRank(s: string): number {
  const order: Record<string, number> = {
    activity_view: 1,
    date_time: 2,
    participants: 3,
    tickets: 4,
    payment: 5,
    payment_started: 6,
    converted: 7,
  };
  return order[s] ?? 0;
}
