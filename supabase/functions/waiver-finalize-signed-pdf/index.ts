/**
 * Thin proxy to waiver-archive-email with sendEmail defaulting to false.
 * Keeps a dedicated URL for "finalize PDF only" while reusing one implementation.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const merged = {
    ...body,
    sendEmail: Object.prototype.hasOwnProperty.call(body, "sendEmail")
      ? body.sendEmail
      : false,
  };

  const authHeader =
    req.headers.get("Authorization")?.trim() ||
    `Bearer ${SUPABASE_ANON_KEY}`;

  const upstream = await fetch(
    `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/waiver-archive-email`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: authHeader,
      },
      body: JSON.stringify(merged),
    },
  );

  const text = await upstream.text();
  const ct = upstream.headers.get("Content-Type") || "application/json";
  return new Response(text, {
    status: upstream.status,
    headers: { ...corsHeaders, "Content-Type": ct },
  });
});
