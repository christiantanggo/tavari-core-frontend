// Customer engagement API — streaks + idempotent loyalty ledger awards (OTWK app).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  extractBearerToken,
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

const VALID_EVENTS = new Set(["trivia_correct", "daily_open"]);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function loadEngagementProfile(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  customerId: string,
) {
  const { data: profile } = await supabase
    .from("customer_engagement_profiles")
    .select("current_streak, longest_streak, last_play_date, grace_used_month, updated_at")
    .eq("business_id", businessId)
    .eq("loyalty_account_id", customerId)
    .maybeSingle();

  const { data: recentAwards } = await supabase
    .from("pos_loyalty_engagement_awards")
    .select("source_key, event_type, points_awarded, created_at")
    .eq("business_id", businessId)
    .eq("loyalty_account_id", customerId)
    .order("created_at", { ascending: false })
    .limit(10);

  return {
    streak: {
      current: profile?.current_streak ?? 0,
      longest: profile?.longest_streak ?? 0,
      lastPlayDate: profile?.last_play_date ?? null,
    },
    recentAwards: (recentAwards || []).map((row) => ({
      sourceKey: row.source_key,
      eventType: row.event_type,
      pointsAwarded: row.points_awarded,
      createdAt: row.created_at,
    })),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const token = extractBearerToken(req);
    const session = token ? await verifyCustomerSessionToken(token) : null;
    if (!session) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "load").trim();
    const businessId = String(body.businessId || session.businessId || "").trim();

    if (!UUID_RE.test(businessId)) {
      return json({ error: "Invalid businessId" }, 400);
    }
    if (session.businessId !== businessId) {
      return json({ error: "Session business mismatch" }, 403);
    }
    if (!UUID_RE.test(session.customerId)) {
      return json({ error: "Invalid customer session" }, 403);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "load") {
      const engagement = await loadEngagementProfile(
        supabase,
        businessId,
        session.customerId,
      );
      return json({ ok: true, businessId, customerId: session.customerId, ...engagement });
    }

    if (action === "record") {
      const eventType = String(body.eventType || body.event_type || "").trim();
      if (!VALID_EVENTS.has(eventType)) {
        return json({ error: "Invalid eventType" }, 400);
      }

      const playDate = String(body.playDate || body.play_date || "").trim();
      const metadata = body.metadata && typeof body.metadata === "object"
        ? body.metadata
        : {};

      const { data, error } = await supabase.rpc("pos_loyalty_record_engagement_event", {
        p_business_id: businessId,
        p_customer_id: session.customerId,
        p_event_type: eventType,
        p_play_date: playDate && /^\d{4}-\d{2}-\d{2}$/.test(playDate) ? playDate : undefined,
        p_metadata: metadata,
      });

      if (error) {
        return json({ error: error.message }, 400);
      }

      const result = (data || {}) as Record<string, unknown>;
      const streak = result.streak as Record<string, unknown> | undefined;

      return json({
        ok: true,
        eventType,
        pointsAwarded: Number(result.pointsAwarded) || 0,
        loyaltyActive: Boolean(result.loyaltyActive),
        streak: {
          current: Number(streak?.current) || 0,
          longest: Number(streak?.longest) || 0,
          lastPlayDate: streak?.lastPlayDate ?? null,
        },
        awards: result.awards ?? {},
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("[tavari-api-customer-engagement]", error);
    return json(
      { error: error instanceof Error ? error.message : "Server error" },
      500,
    );
  }
});
