/**
 * Proxy Google Business Profile / My Business APIs with stored OAuth for a business.
 * Actions: listAccounts, listLocations, listReviews, updateReply
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Google’s error text is unchanged; we append context so quota errors aren’t mistaken for double-clicks in the UI. */
function enrichGoogleQuotaMessage(message: string): string {
  if (!/quota|Quota|RESOURCE_EXHAUSTED|rate limit/i.test(message)) {
    return message;
  }
  const m = message.match(/project[_:](?:number:)?(\d+)/i);
  const projHint = m
    ? `GCP project ${m[1]} (the project that owns your OAuth client)`
    : "the Google Cloud project that owns your OAuth client";
  return (
    message +
    " — Each Tavari click sends exactly one HTTP request to Google for this action; there is no background polling. " +
    `This limit applies to ${projHint}: any other app, deployment, teammate, or script using the same OAuth client shares the same per-minute quota. ` +
    "Fix: Google Cloud Console → APIs & Services → Quotas → My Business Account Management API → raise “Requests per minute”, " +
    "or use a dedicated OAuth client in a new project. You can skip “Load accounts” by pasting accounts/…/locations/… manually in Settings."
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const googleClientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const googleClientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const action = String(body.action || "").trim();
    const businessId = String(body.businessId || "").trim();
    if (!action || !businessId) {
      return new Response(JSON.stringify({ error: "action and businessId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.info("[reputation-google-bp] invoke", { action, businessId });

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: role } = await admin
      .from("user_roles")
      .select("id")
      .eq("user_id", userData.user.id)
      .eq("business_id", businessId)
      .eq("active", true)
      .maybeSingle();

    if (!role) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: conn, error: connErr } = await admin
      .from("reputation_google_oauth")
      .select("*")
      .eq("business_id", businessId)
      .maybeSingle();

    if (connErr || !conn?.refresh_token) {
      return new Response(JSON.stringify({ error: "Google Business Profile is not connected for this business." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await ensureAccessToken(admin, businessId, conn, googleClientId, googleClientSecret);

    if (action === "listAccounts") {
      console.info("[reputation-google-bp] listAccounts → Google (1 request)");
      const r = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const j = await r.json();
      if (!r.ok) {
        const msg = enrichGoogleQuotaMessage(j.error?.message || JSON.stringify(j));
        return new Response(JSON.stringify({ error: msg }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(j), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "listLocations") {
      const accountName = String(body.accountName || "").trim();
      if (!accountName) {
        return new Response(JSON.stringify({ error: "accountName required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const parent = encodeURIComponent(accountName);
      const r = await fetch(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${parent}/locations?readMask=name,title,storefrontAddress`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const j = await r.json();
      if (!r.ok) {
        const msg = enrichGoogleQuotaMessage(j.error?.message || JSON.stringify(j));
        return new Response(JSON.stringify({ error: msg }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(j), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "listReviews") {
      let parent = String(body.parent || "").trim();
      if (!parent && conn.selected_location_resource) {
        parent = conn.selected_location_resource as string;
      }
      if (!parent) {
        return new Response(
          JSON.stringify({
            error:
              "Location not set. Paste accounts/…/locations/… into Settings or pass parent (accounts/*/locations/*).",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const encoded = encodeURI(parent);
      const r = await fetch(
        `https://mybusiness.googleapis.com/v4/${encoded}/reviews?pageSize=50`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const j = await r.json();
      if (!r.ok) {
        const msg = enrichGoogleQuotaMessage(j.error?.message || JSON.stringify(j));
        return new Response(JSON.stringify({ error: msg }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(j), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "updateReply") {
      const reviewName = String(body.reviewName || "").trim();
      const comment = String(body.comment || "").trim();
      if (!reviewName || !comment) {
        return new Response(JSON.stringify({ error: "reviewName and comment required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const r = await fetch(
        `https://mybusiness.googleapis.com/v4/${encodeURI(reviewName)}/reply`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ comment }),
        },
      );
      const j = await r.json();
      if (!r.ok) {
        const msg = enrichGoogleQuotaMessage(j.error?.message || JSON.stringify(j));
        return new Response(JSON.stringify({ error: msg }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(j), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function ensureAccessToken(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  conn: Record<string, unknown>,
  clientId: string | undefined,
  clientSecret: string | undefined,
): Promise<string> {
  const expiresAt = conn.access_token_expires_at as string | null | undefined;
  const existing = conn.access_token as string | undefined;
  if (existing && expiresAt && new Date(expiresAt).getTime() > Date.now() + 60_000) {
    return existing;
  }
  if (!clientId || !clientSecret) {
    throw new Error("Server OAuth client not configured");
  }
  const rt = conn.refresh_token as string;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: rt,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }).toString(),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok || tokenJson.error) {
    throw new Error(tokenJson.error_description || tokenJson.error || "Refresh failed");
  }
  const accessToken = tokenJson.access_token as string;
  const expiresIn = Number(tokenJson.expires_in || 3600);
  const newExpires = new Date(Date.now() + expiresIn * 1000).toISOString();
  await admin
    .from("reputation_google_oauth")
    .update({
      access_token: accessToken,
      access_token_expires_at: newExpires,
      updated_at: new Date().toISOString(),
    })
    .eq("business_id", businessId);
  return accessToken;
}
