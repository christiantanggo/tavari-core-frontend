import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  caregiverRevenueCatAppUserId,
  caregiverSeatIsActive,
} from "../_shared/pullcoparentCaregiverBilling.ts";
import { fetchRevenueCatSubscriber } from "../_shared/pullcoparentSubscription.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const caregiverId = String(body.caregiverId || "").trim();
    if (!caregiverId) return json({ error: "caregiverId is required" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: caregiver, error: caregiverError } = await admin
      .from("pullcoparent_caregivers")
      .select("id, household_id, billing_user_id, status, billing_status")
      .eq("id", caregiverId)
      .maybeSingle();

    if (caregiverError) throw caregiverError;
    if (!caregiver) return json({ error: "Caregiver not found" }, 404);

    const { data: membership } = await admin
      .from("pullcoparent_household_members")
      .select("role")
      .eq("household_id", caregiver.household_id)
      .eq("user_id", authData.user.id)
      .maybeSingle();

    const isParent = membership?.role === "owner" || membership?.role === "parent";
    const isBillingUser = caregiver.billing_user_id === authData.user.id;
    if (!isParent && !isBillingUser) return json({ error: "Not allowed" }, 403);

    const rcUserId = caregiverRevenueCatAppUserId(caregiverId);
    const subscriber = await fetchRevenueCatSubscriber(rcUserId);
    if (!subscriber) {
      return json({ ok: true, synced: false, active: false });
    }

    const seat = caregiverSeatIsActive(subscriber);
    const billingStatus = seat.active ? "active" : "suspended";
    const status =
      seat.active && caregiver.status === "suspended"
        ? "active"
        : !seat.active && caregiver.status === "active"
          ? "suspended"
          : caregiver.status;

    const { error: updateError } = await admin
      .from("pullcoparent_caregivers")
      .update({
        billing_status: billingStatus,
        billing_period_end: seat.expiresAt,
        billing_external_id: seat.externalId,
        status,
        billing_suspended_at: seat.active ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", caregiverId);

    if (updateError) throw updateError;

    return json({
      ok: true,
      synced: true,
      active: seat.active,
      billingStatus,
      status,
    });
  } catch (err) {
    console.error("[pullcoparent-sync-caregiver-billing]", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
