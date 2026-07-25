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



function parsePremiumFromEvent(event: Record<string, unknown>) {

  const entitlements = (event.entitlement_ids as string[]) || [];

  const hasPremium = entitlements.includes(ENTITLEMENT_ID);

  const expiresAt = (event.expiration_at_ms as number)

    ? new Date(event.expiration_at_ms as number).toISOString()

    : null;

  const expired = expiresAt ? new Date(expiresAt) <= new Date() : false;



  let status: "active" | "cancelled" | "expired" = "expired";

  if (hasPremium && !expired) {

    status = event.type === "CANCELLATION" ? "cancelled" : "active";

  }



  return {

    isPremium: hasPremium && !expired,

    productId: (event.product_id as string) || null,

    expiresAt,

    status,

  };

}



function shouldApplyPremiumEvent(parsed: ReturnType<typeof parsePremiumFromEvent>) {

  if (!parsed.isPremium) return false;

  if (parsed.productId && !isOwnAppPremiumProduct(parsed.productId)) return false;

  return true;

}



function isUuid(value: string) {

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

}



function errorMessage(err: unknown) {

  if (err instanceof Error) return err.message;

  if (typeof err === "object" && err !== null && "message" in err) {

    return String((err as { message: unknown }).message);

  }

  return String(err);

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

    const webhookAuth = Deno.env.get("REVENUECAT_WEBHOOK_AUTH");

    if (webhookAuth) {

      const header = req.headers.get("Authorization") || "";

      if (header !== `Bearer ${webhookAuth}`) {

        return json({ error: "Unauthorized webhook" }, 401);

      }

    }



    const payload = await req.json();

    const event = payload?.event as Record<string, unknown> | undefined;

    if (!event) return json({ error: "Missing event" }, 400);



    if (event.type === "TEST") {

      return json({ ok: true, test: true });

    }



    const appUserId = (event.app_user_id as string) || "";

    if (!appUserId || appUserId.startsWith("$RCAnonymousID:")) {

      return json({ ok: true, skipped: true });

    }

    if (!isUuid(appUserId)) {

      return json({ ok: true, skipped: true, reason: "non_uuid_app_user_id" });

    }



    const parsed = parsePremiumFromEvent(event);

    if (parsed.isPremium && parsed.productId && !isOwnAppPremiumProduct(parsed.productId)) {

      return json({ ok: true, skipped: true, reason: "foreign_product" });

    }



    const supabase = createClient(

      Deno.env.get("SUPABASE_URL")!,

      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,

    );



    const { error } = await supabase.from("pullpets_subscriptions").upsert(

      {

        user_id: appUserId,

        status: shouldApplyPremiumEvent(parsed) ? parsed.status : "expired",

        product_id: shouldApplyPremiumEvent(parsed) ? parsed.productId : null,

        expires_at: shouldApplyPremiumEvent(parsed) ? parsed.expiresAt : null,

        revenuecat_app_user_id: appUserId,

        updated_at: new Date().toISOString(),

      },

      { onConflict: "user_id" },

    );

    if (error) {

      // RevenueCat test events or stale users may not exist in auth.users yet.

      if (error.code === "23503") {

        return json({ ok: true, skipped: true, reason: "user_not_found" });

      }

      throw error;

    }



    return json({ ok: true, isPremium: shouldApplyPremiumEvent(parsed) });

  } catch (err) {

    return json({ error: errorMessage(err) }, 500);

  }

});

