import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createClient } from "npm:@supabase/supabase-js@2";



const ENTITLEMENT_ID = "Pull Together: Pet Care Premium";

const PRODUCT_ID_PREFIX = "pullpets_";



function isOwnAppPremiumProduct(productId: string | null | undefined) {

  return Boolean(productId && productId.startsWith(PRODUCT_ID_PREFIX));

}



function json(body: unknown, status = 200) {

  return new Response(JSON.stringify(body), {

    status,

    headers: { "Content-Type": "application/json" },

  });

}



function parsePremiumFromSubscriber(subscriber: Record<string, unknown> | null | undefined) {

  const entitlements = (subscriber?.entitlements as Record<string, Record<string, unknown>>) || {};

  const premium = entitlements[ENTITLEMENT_ID];

  if (!premium) return { isPremium: false, productId: null, expiresAt: null, status: "expired" as const };



  const expiresAt = (premium.expires_date as string) || null;

  const expired = expiresAt ? new Date(expiresAt) <= new Date() : false;

  if (expired) return { isPremium: false, productId: null, expiresAt, status: "expired" as const };



  const productId = (premium.product_identifier as string) || null;

  if (productId && !isOwnAppPremiumProduct(productId)) {

    return { isPremium: false, productId: null, expiresAt, status: "expired" as const };

  }



  const unsubscribeDetected = Boolean(premium.unsubscribe_detected_at);

  return {

    isPremium: true,

    productId,

    expiresAt,

    status: unsubscribeDetected ? ("cancelled" as const) : ("active" as const),

  };

}



async function syncUserSubscription(userId: string) {

  const rcSecret = Deno.env.get("REVENUECAT_SECRET_API_KEY");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;



  if (!rcSecret) {

    throw new Error("REVENUECAT_SECRET_API_KEY is not configured");

  }



  const rcRes = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {

    headers: {

      Authorization: `Bearer ${rcSecret}`,

      "Content-Type": "application/json",

    },

  });



  if (!rcRes.ok) {

    const text = await rcRes.text();

    throw new Error(`RevenueCat error ${rcRes.status}: ${text}`);

  }



  const rcData = await rcRes.json();

  const parsed = parsePremiumFromSubscriber(rcData?.subscriber);



  const supabase = createClient(supabaseUrl, serviceKey);

  const { error } = await supabase.from("pullpets_subscriptions").upsert(

    {

      user_id: userId,

      status: parsed.status,

      product_id: parsed.productId,

      expires_at: parsed.expiresAt,

      revenuecat_app_user_id: userId,

      updated_at: new Date().toISOString(),

    },

    { onConflict: "user_id" },

  );

  if (error) throw error;



  return { isPremium: parsed.isPremium, status: parsed.status };

}



Deno.serve(async (req) => {

  if (req.method === "OPTIONS") {

    return new Response(null, {

      headers: {

        "Access-Control-Allow-Origin": "*",

        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",

      },

    });

  }



  try {

    const authHeader = req.headers.get("Authorization");

    if (!authHeader) return json({ error: "Missing authorization" }, 401);



    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {

      global: { headers: { Authorization: authHeader } },

    });

    const { data: authData, error: authError } = await userClient.auth.getUser();

    if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);



    const body = await req.json().catch(() => ({}));

    const userId = body.userId || authData.user.id;

    if (userId !== authData.user.id) return json({ error: "Forbidden" }, 403);



    const result = await syncUserSubscription(userId);

    return json(result);

  } catch (err) {

    return json({ error: err instanceof Error ? err.message : String(err) }, 500);

  }

});

