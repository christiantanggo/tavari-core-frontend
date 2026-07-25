// Mobile-friendly wrapper around customer portal data (bookings, waivers, family).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  extractBearerToken,
  verifyCustomerSessionToken,
} from "../_shared/customerAppSession.ts";
import {
  loadActiveCustomerOffers,
  loadFeaturedRewardItems,
  syncCustomerLoyaltyOffers,
} from "../_shared/loyaltyOffers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-customer-session",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resolveSession(req: Request) {
  const token = extractBearerToken(req);
  if (!token) return null;
  return verifyCustomerSessionToken(token);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const session = await resolveSession(req);
    if (!session) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const url = new URL(req.url);
    const body = req.method === "POST"
      ? ((await req.json().catch(() => ({}))) as Record<string, unknown>)
      : {};
    const action = String(body.action || url.searchParams.get("action") || "load").trim();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const portalRes = await fetch(`${supabaseUrl}/functions/v1/customer-portal-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify({
        action,
        businessId: session.businessId,
        customerId: session.customerId,
        phone: session.phone,
        ...body,
      }),
    });

    const payload = await portalRes.json().catch(() => ({}));
    if (!portalRes.ok) {
      return jsonResponse(
        { error: String((payload as Record<string, unknown>).error || "Portal request failed") },
        portalRes.status,
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const loyalty = await loadLoyaltySummary(
      supabase,
      session.businessId,
      session.customerId,
    );
    const engagement = await loadEngagementProfile(
      supabase,
      session.businessId,
      session.customerId,
    );

    let featuredRewardItems: Array<Record<string, unknown>> = [];
    let personalOffers: Array<Record<string, unknown>> = [];
    if (loyalty.enabled) {
      try {
        await syncCustomerLoyaltyOffers(supabase, session.businessId, session.customerId);
        featuredRewardItems = await loadFeaturedRewardItems(supabase, session.businessId);
        personalOffers = await loadActiveCustomerOffers(supabase, session.businessId, session.customerId);
      } catch (offerErr) {
        console.warn("[tavari-api-customer-portal] loyalty offers:", offerErr);
      }
    }

    return jsonResponse({
      ...(payload as Record<string, unknown>),
      loyalty: {
        ...loyalty,
        featuredRewardItems,
        personalOffers,
      },
      engagement,
    });
  } catch (error) {
    console.error("[tavari-api-customer-portal]", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Server error" },
      500,
    );
  }
});

async function loadLoyaltySummary(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  customerId: string,
) {
  const { data: settings } = await supabase
    .from("pos_loyalty_settings")
    .select("is_active, loyalty_mode, redemption_rate, min_redemption")
    .eq("business_id", businessId)
    .maybeSingle();

  const enabled = Boolean(settings?.is_active);
  if (!enabled) {
    return {
      enabled: false,
      comingSoon: true,
      mode: "points" as const,
      points: 0,
      balance: 0,
      storeCredit: 0,
      redeemableDollars: 0,
      minRedemptionDollars: null as number | null,
      displayBalance: null as string | null,
      recentTransactions: [] as Array<Record<string, unknown>>,
    };
  }

  const { data: account } = await supabase
    .from("pos_loyalty_accounts")
    .select("points, balance, store_credit, total_earned, total_spent, is_active")
    .eq("business_id", businessId)
    .eq("id", customerId)
    .maybeSingle();

  const mode = String(settings?.loyalty_mode || "points") === "dollars" ? "dollars" : "points";
  const points = Math.max(0, Math.round(Number(account?.points) || 0));
  const balance = Math.max(0, Number(account?.balance) || 0);
  const storeCredit = Math.max(0, Number(account?.store_credit) || 0);
  const rate = Number(settings?.redemption_rate) || 10000;
  const pointsDollarValue = (points * 10) / rate;
  const redeemableDollars = mode === "points" ? storeCredit + pointsDollarValue : storeCredit + balance;
  const minRedemptionRaw = settings?.min_redemption != null
    ? Number(settings.min_redemption)
    : null;
  const minRedemptionDollars = minRedemptionRaw == null
    ? null
    : mode === "points"
      ? (minRedemptionRaw / rate) * 10
      : minRedemptionRaw;

  const displayBalance = mode === "points"
    ? `${points.toLocaleString()} pts`
    : `$${redeemableDollars.toFixed(2)}`;

  const { data: transactions } = await supabase
    .from("pos_loyalty_transactions")
    .select("id, transaction_type, points, amount, description, created_at")
    .eq("business_id", businessId)
    .eq("loyalty_account_id", customerId)
    .order("created_at", { ascending: false })
    .limit(8);

  return {
    enabled: true,
    comingSoon: false,
    mode,
    points,
    balance,
    storeCredit,
    redeemableDollars: Math.round(redeemableDollars * 100) / 100,
    minRedemptionDollars: minRedemptionDollars != null
      ? Math.round(minRedemptionDollars * 100) / 100
      : null,
    minRedemptionPoints: mode === "points" ? minRedemptionRaw : null,
    displayBalance,
    totalEarned: Number(account?.total_earned) || 0,
    totalSpent: Number(account?.total_spent) || 0,
    recentTransactions: (transactions || []).map((row) => ({
      id: row.id,
      type: row.transaction_type,
      pointsChange: row.points,
      balanceChange: row.amount,
      description: row.description,
      createdAt: row.created_at,
    })),
  };
}

async function loadEngagementProfile(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  customerId: string,
) {
  const { data: profile } = await supabase
    .from("customer_engagement_profiles")
    .select("current_streak, longest_streak, last_play_date")
    .eq("business_id", businessId)
    .eq("loyalty_account_id", customerId)
    .maybeSingle();

  return {
    streak: {
      current: profile?.current_streak ?? 0,
      longest: profile?.longest_streak ?? 0,
      lastPlayDate: profile?.last_play_date ?? null,
    },
  };
}
