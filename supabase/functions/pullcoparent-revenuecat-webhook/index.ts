import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { mapWebhookEventToRow, isProtectedAdminGrant } from "../_shared/pullcoparentSubscription.ts";
import {
  mapCaregiverWebhookEvent,
  parseCaregiverIdFromAppUserId,
} from "../_shared/pullcoparentCaregiverBilling.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_AUTH = (Deno.env.get("REVENUECAT_WEBHOOK_AUTH") || "").trim();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (WEBHOOK_AUTH) {
    const auth = req.headers.get("Authorization") || "";
    if (auth !== `Bearer ${WEBHOOK_AUTH}`) return json({ error: "Unauthorized" }, 401);
  }

  try {
    const payload = await req.json();
    const event = (payload?.event ?? payload) as Record<string, unknown>;
    const appUserId = String(event?.app_user_id || event?.original_app_user_id || "").trim();

    if (!appUserId) return json({ ok: true, skipped: true });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const caregiverId = parseCaregiverIdFromAppUserId(appUserId);
    if (caregiverId) {
      const mapped = mapCaregiverWebhookEvent(caregiverId, event);
      if (!mapped) return json({ ok: true, ignored: String(event.type || ""), kind: "caregiver" });

      const { data: caregiver, error: caregiverError } = await admin
        .from("pullcoparent_caregivers")
        .select("id, status")
        .eq("id", caregiverId)
        .maybeSingle();

      if (caregiverError) throw caregiverError;
      if (!caregiver) return json({ error: "Caregiver not found" }, 404);

      let status = caregiver.status;
      if (mapped.billingStatus === "active") {
        if (status === "pending_payment" || status === "pending_partner_approval") {
          status = "pending_partner_approval";
        } else if (status === "suspended") {
          status = "active";
        }
      } else if (mapped.billingStatus === "past_due" || mapped.billingStatus === "cancelled") {
        if (status === "active") status = "suspended";
      }

      const { error } = await admin
        .from("pullcoparent_caregivers")
        .update({
          billing_status: mapped.billingStatus === "active" ? "active" : "suspended",
          billing_period_end: mapped.periodEnd,
          status,
          billing_suspended_at: mapped.billingStatus === "active" ? null : new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", caregiverId);

      if (error) throw error;
      return json({ ok: true, kind: "caregiver", billingStatus: mapped.billingStatus, status });
    }

    const householdId = appUserId;

    const { data: member } = await admin
      .from("pullcoparent_household_members")
      .select("user_id")
      .eq("household_id", householdId)
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const fallbackPurchaserId = member?.user_id;
    if (!fallbackPurchaserId) return json({ error: "Household not found" }, 404);

    const row = mapWebhookEventToRow(householdId, event, fallbackPurchaserId);
    if (!row) return json({ ok: true, ignored: String(event.type || "") });

    const { data: existing, error: existingError } = await admin
      .from("pullcoparent_subscriptions")
      .select("product_id, status, expires_at")
      .eq("household_id", householdId)
      .maybeSingle();

    if (existingError) throw existingError;

    if (isProtectedAdminGrant(existing) && row.status === "expired") {
      return json({ ok: true, skipped: "admin_grant" });
    }

    const { error } = await admin.from("pullcoparent_subscriptions").upsert(
      {
        ...row,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "household_id" },
    );

    if (error) throw error;
    return json({ ok: true, status: row.status });
  } catch (err) {
    console.error("[pullcoparent-revenuecat-webhook]", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
