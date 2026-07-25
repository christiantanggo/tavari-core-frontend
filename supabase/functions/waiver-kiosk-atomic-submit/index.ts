import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const waiver = body.waiver as Record<string, unknown> | undefined;
  const participants = Array.isArray(body.participants) ? body.participants as Record<string, unknown>[] : [];
  const consents = Array.isArray(body.consents) ? body.consents as Record<string, unknown>[] : [];

  if (!waiver || typeof waiver !== "object") {
    return json({ success: false, error: "Missing waiver object" }, 400);
  }
  if (participants.length === 0) {
    return json({ success: false, error: "At least one participant is required" }, 400);
  }
  if (consents.length === 0) {
    return json({ success: false, error: "Consent audit rows are required" }, 400);
  }

  console.warn("[waiver-kiosk-atomic-submit] start", {
    business_id: waiver.business_id,
    template_id: waiver.template_id,
    participant_count: participants.length,
    consent_count: consents.length,
  });

  const { data, error } = await admin.rpc("waivers_atomic_submit_package", {
    p_payload: { waiver, participants, consents },
  });

  if (error) {
    console.error("[waiver-kiosk-atomic-submit] rpc error:", error);
    return json({ success: false, error: error.message || "Atomic submit failed" }, 500);
  }

  const row = data as Record<string, unknown> | null;
  if (!row || row.success !== true) {
    console.error("[waiver-kiosk-atomic-submit] rpc returned non-success:", row);
    return json({ success: false, error: (row?.error as string) || "Atomic submit failed" }, 500);
  }

  console.warn("[waiver-kiosk-atomic-submit] ok", {
    waiver_id: row.waiver_id,
    dedup: row.dedup,
    participant_count: row.participant_count,
    consent_count: row.consent_count,
  });

  return json({
    success: true,
    waiver_id: row.waiver_id,
    dedup: row.dedup,
    participant_ids: row.participant_ids,
    participant_count: row.participant_count,
    consent_count: row.consent_count,
  });
});
