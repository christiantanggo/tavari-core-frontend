import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  fetchRevenueCatSubscriber,
  isPremiumSubscription,
  isProtectedAdminGrant,
  mapSubscriberToRow,
} from "../_shared/pullcoparentSubscription.ts";

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
    const householdId = String(body.householdId || "").trim();
    if (!householdId) return json({ error: "householdId is required" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: membership, error: memberError } = await admin
      .from("pullcoparent_household_members")
      .select("user_id")
      .eq("household_id", householdId)
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (memberError) throw memberError;
    if (!membership) return json({ error: "Not a member of this household" }, 403);

    const { data: existing, error: existingError } = await admin
      .from("pullcoparent_subscriptions")
      .select("product_id, status, expires_at")
      .eq("household_id", householdId)
      .maybeSingle();

    if (existingError) throw existingError;

    if (isProtectedAdminGrant(existing)) {
      return json({
        ok: true,
        synced: false,
        isPremium: true,
        status: existing!.status,
        source: "admin_grant",
      });
    }

    const subscriber = await fetchRevenueCatSubscriber(householdId);
    if (!subscriber) {
      return json({ ok: true, isPremium: false, synced: false });
    }

    const row = mapSubscriberToRow(householdId, subscriber, authData.user.id);
    const { error: upsertError } = await admin.from("pullcoparent_subscriptions").upsert(
      {
        ...row,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "household_id" },
    );

    if (upsertError) throw upsertError;

    return json({
      ok: true,
      synced: true,
      isPremium: isPremiumSubscription(row.status, row.expires_at),
      status: row.status,
    });
  } catch (err) {
    console.error("[pullcoparent-sync-subscription]", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
