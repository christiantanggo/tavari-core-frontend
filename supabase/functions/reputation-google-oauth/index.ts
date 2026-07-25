/**
 * Exchange Google OAuth authorization code for refresh/access tokens and store on the business row.
 * Secrets: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET (Supabase Edge Function secrets)
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

  if (!googleClientId || !googleClientSecret) {
    return new Response(
      JSON.stringify({ error: "Google OAuth is not configured on the server (missing client id/secret)." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

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
    const code = String(body.code || "").trim();
    const redirectUri = String(body.redirectUri || "").trim();
    const businessId = String(body.businessId || "").trim();

    if (!code || !redirectUri || !businessId) {
      return new Response(JSON.stringify({ error: "code, redirectUri, and businessId are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: googleClientId,
        client_secret: googleClientSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }).toString(),
    });

    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || tokenJson.error) {
      console.error("Google token error", tokenJson);
      return new Response(
        JSON.stringify({ error: tokenJson.error_description || tokenJson.error || "Token exchange failed" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const refreshToken = tokenJson.refresh_token as string | undefined;
    const accessToken = tokenJson.access_token as string;
    const expiresIn = Number(tokenJson.expires_in || 3600);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    let email: string | null = null;
    try {
      const ui = await fetch(
        `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${encodeURIComponent(accessToken)}`,
      );
      if (ui.ok) {
        const uj = await ui.json();
        email = uj.email || null;
      }
    } catch (_) {
      /* ignore */
    }

    const upsertPayload: Record<string, unknown> = {
      business_id: businessId,
      refresh_token: refreshToken || (await getExistingRefresh(admin, businessId)),
      access_token: accessToken,
      access_token_expires_at: expiresAt,
      scope: tokenJson.scope || null,
      connected_email: email,
      updated_at: new Date().toISOString(),
    };

    if (!upsertPayload.refresh_token) {
      return new Response(
        JSON.stringify({
          error:
            "Google did not return a refresh token. Revoke Tavari access in Google Account settings and connect again with prompt=consent.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { error: saveErr } = await admin.from("reputation_google_oauth").upsert(upsertPayload, {
      onConflict: "business_id",
    });
    if (saveErr) {
      console.error(saveErr);
      return new Response(JSON.stringify({ error: "Failed to save Google connection" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, connected_email: email }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message || "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function getExistingRefresh(
  admin: ReturnType<typeof createClient>,
  businessId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("reputation_google_oauth")
    .select("refresh_token")
    .eq("business_id", businessId)
    .maybeSingle();
  return data?.refresh_token || null;
}
