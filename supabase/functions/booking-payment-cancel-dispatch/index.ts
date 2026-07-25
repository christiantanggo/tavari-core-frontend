import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { autoCancelBookingsPastPaymentDeadline } from "../_shared/bookingPaymentRequest.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-booking-payment-cancel-dispatch-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

async function authorizeCron(req: Request, admin: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return true;
  const requestSecret = (req.headers.get("x-booking-payment-cancel-dispatch-cron-secret") || "").trim();
  if (!requestSecret) return false;
  const { data } = await admin
    .from("system_runtime_secrets")
    .select("secret_value")
    .eq("key_name", "booking_payment_cancel_dispatch_cron_secret")
    .maybeSingle();
  return Boolean(data?.secret_value && data.secret_value === requestSecret);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  if (!(await authorizeCron(req, admin))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  try {
    const result = await autoCancelBookingsPastPaymentDeadline(admin);
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    console.error("[booking-payment-cancel-dispatch]", err);
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : "Server error",
    }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
