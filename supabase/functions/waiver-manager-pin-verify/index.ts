import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@3.0.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function looksLikeHashedPin(pin: unknown) {
  const value = String(pin || "");
  return value.startsWith("$2a$") || value.startsWith("$2b$") || value.startsWith("$2y$");
}

async function pinMatches(inputPin: string, storedPin: unknown) {
  const candidate = String(storedPin || "");
  if (!candidate) return false;
  if (looksLikeHashedPin(candidate)) {
    try {
      return await bcrypt.compare(inputPin, candidate);
    } catch (_err) {
      return false;
    }
  }
  return String(inputPin) === candidate;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const { businessId, pin } = await req.json();

    if (!businessId || !pin) {
      return jsonResponse({ ok: false, error: "Missing businessId or pin" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: staffMembers, error: staffError } = await supabase.rpc(
      "get_all_staff_pins_for_unlock",
      { p_business_id: businessId },
    );

    if (staffError) {
      return jsonResponse({ ok: false, error: staffError.message || "Failed to load staff PINs" }, 500);
    }

    const candidates: Array<Record<string, unknown>> = Array.isArray(staffMembers) ? staffMembers : [];
    if (candidates.length === 0) {
      return jsonResponse({ ok: false, error: "No staff members found for this business" }, 404);
    }

    const normalizedPin = String(pin).trim();
    for (const candidate of candidates) {
      if (await pinMatches(normalizedPin, candidate.pin)) {
        return jsonResponse({
          ok: true,
          verified: true,
          userId: candidate.id || null,
          fullName: candidate.full_name || null,
          email: candidate.email || null,
          role: candidate.role || null,
        });
      }
    }

    return jsonResponse({ ok: true, verified: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
