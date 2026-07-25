// Public read-only Name of the Day — same girl/boy picks as Tavari mail-name-of-day.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  extractBearerToken,
  normalizePhone,
  verifyCustomerSessionToken,
} from "../_shared/customerAppSession.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-customer-session",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeName(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, "")
    .replace(/\s+/g, " ");
}

function localDateYmd(timeZone: string, date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    /* fallback */
  }
  return date.toISOString().slice(0, 10);
}

async function loadBusinessTimezone(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
): Promise<string> {
  const { data } = await supabase
    .from("businesses")
    .select("timezone")
    .eq("id", businessId)
    .maybeSingle();
  return String(data?.timezone || "America/Toronto").trim() || "America/Toronto";
}

async function loadFamilyWinnerNames(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  customerId: string,
): Promise<string[]> {
  const { data: waivers } = await supabase
    .from("waiver_signatures")
    .select(`
      first_name,
      last_name,
      waiver_participants (
        first_name,
        last_name,
        participant_type
      )
    `)
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .eq("is_valid", true)
    .limit(50);

  const names = new Set<string>();
  for (const waiver of waivers || []) {
    const signer = normalizeName(`${waiver.first_name || ""} ${waiver.last_name || ""}`.trim());
    if (signer) names.add(signer);
    for (const p of waiver.waiver_participants || []) {
      const n = normalizeName(`${p.first_name || ""} ${p.last_name || ""}`.trim());
      if (n) names.add(n);
      const first = normalizeName(p.first_name);
      if (first) names.add(first);
    }
  }
  return [...names];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    let businessId = url.searchParams.get("businessId")?.trim() || "";
    let localDate = url.searchParams.get("localDate")?.trim() || "";

    if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      businessId = businessId || String(body.businessId || "").trim();
      localDate = localDate || String(body.localDate || "").trim();
    }

    if (!UUID_RE.test(businessId)) {
      return jsonResponse({ error: "Invalid businessId" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const timeZone = await loadBusinessTimezone(supabase, businessId);
    const targetDate = localDate || localDateYmd(timeZone);

    const { data: pick, error } = await supabase
      .from("mail_name_of_day_picks")
      .select(
        "local_date, girl_display_name, boy_display_name, girl_normalized, boy_normalized, pick_source",
      )
      .eq("business_id", businessId)
      .eq("local_date", targetDate)
      .maybeSingle();

    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    const winners = {
      girl: pick?.girl_display_name ? String(pick.girl_display_name).trim() : null,
      boy: pick?.boy_display_name ? String(pick.boy_display_name).trim() : null,
    };

    let youWon: string[] = [];
    const token = extractBearerToken(req);
    if (token) {
      const session = await verifyCustomerSessionToken(token);
      if (session && session.businessId === businessId) {
        const familyNames = await loadFamilyWinnerNames(
          supabase,
          businessId,
          session.customerId,
        );
        const girlNorm = normalizeName(pick?.girl_normalized);
        const boyNorm = normalizeName(pick?.boy_normalized);

        for (const name of familyNames) {
          if ((girlNorm && name === girlNorm) || (boyNorm && name === boyNorm)) {
            youWon.push(name === girlNorm ? winners.girl || name : winners.boy || name);
          }
          const firstOnly = name.split(" ")[0];
          if (
            (girlNorm && firstOnly === girlNorm.split(" ")[0]) ||
            (boyNorm && firstOnly === boyNorm.split(" ")[0])
          ) {
            const display = firstOnly === girlNorm?.split(" ")[0] ? winners.girl : winners.boy;
            if (display && !youWon.includes(display)) youWon.push(display);
          }
        }
        youWon = [...new Set(youWon.filter(Boolean))];
      }
    }

    return jsonResponse({
      businessId,
      localDate: targetDate,
      timeZone,
      winners,
      pickSource: pick?.pick_source || null,
      hasPick: Boolean(winners.girl || winners.boy),
      youWon,
      isWinner: youWon.length > 0,
    });
  } catch (error) {
    console.error("[tavari-api-name-of-day]", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Server error" },
      500,
    );
  }
});
