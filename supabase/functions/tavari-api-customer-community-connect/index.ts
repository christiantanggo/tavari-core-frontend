// Parent QR connect for OTWK app — tokens in Tavari; direct chats in OTWK website Supabase.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  extractBearerToken,
  verifyCustomerSessionToken,
} from "../_shared/customerAppSession.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-customer-session, x-parent-display-name",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const APP_SITE_URL = (Deno.env.get("OTWK_APP_SITE_URL") || "https://www.offthewallkids.ca").replace(
  /\/$/,
  "",
);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function randomToken(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function parseConnectToken(raw: string): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/\/app\/connect\/([a-f0-9]+)/i);
  if (urlMatch) return urlMatch[1].toLowerCase();
  const schemeMatch = trimmed.match(/connect\/([a-f0-9]+)/i);
  if (schemeMatch) return schemeMatch[1].toLowerCase();
  if (/^[a-f0-9]{16,64}$/i.test(trimmed)) return trimmed.toLowerCase();
  return null;
}

function parentConnectUrl(token: string): string {
  return `${APP_SITE_URL}/app/connect/${encodeURIComponent(token)}`;
}

function otwkAdmin() {
  const url = Deno.env.get("OTWK_SUPABASE_URL")?.trim();
  const key = Deno.env.get("OTWK_SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

async function ensureConnectToken(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  customerId: string,
  displayName: string,
) {
  const name = String(displayName || "Parent").trim() || "Parent";
  const { data: existing } = await admin
    .from("business_customer_connect_tokens")
    .select("token, display_name")
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .maybeSingle();

  if (existing?.token) {
    if (name !== existing.display_name) {
      await admin
        .from("business_customer_connect_tokens")
        .update({ display_name: name, updated_at: new Date().toISOString() })
        .eq("business_id", businessId)
        .eq("customer_id", customerId);
    }
    return { token: existing.token, displayName: name };
  }

  const token = randomToken();
  const { error } = await admin.from("business_customer_connect_tokens").insert({
    business_id: businessId,
    customer_id: customerId,
    token,
    display_name: name,
  });
  if (error) throw error;
  return { token, displayName: name };
}

async function findDirectGroupBetween(
  otwk: ReturnType<typeof createClient>,
  customerA: string,
  customerB: string,
): Promise<string | null> {
  const { data: aGroups } = await otwk
    .from("app_community_group_members")
    .select("group_id")
    .eq("tavari_customer_id", customerA);
  const { data: bGroups } = await otwk
    .from("app_community_group_members")
    .select("group_id")
    .eq("tavari_customer_id", customerB);

  const setB = new Set((bGroups || []).map((g) => g.group_id));
  const shared = (aGroups || []).map((g) => g.group_id).filter((id) => setB.has(id));
  if (shared.length === 0) return null;

  const { data: direct } = await otwk
    .from("app_community_groups")
    .select("id, slug, group_type")
    .in("id", shared)
    .limit(20);

  const match = (direct || []).find(
    (g) => g.group_type === "direct" || String(g.slug || "").startsWith("dm-"),
  );
  return match?.id || null;
}

async function getOrCreateDirectGroup(
  otwk: ReturnType<typeof createClient>,
  selfId: string,
  selfName: string,
  otherId: string,
  otherName: string,
) {
  if (selfId === otherId) throw new Error("You cannot connect with yourself");

  const existingId = await findDirectGroupBetween(otwk, selfId, otherId);
  if (existingId) {
    const { data: group } = await otwk
      .from("app_community_groups")
      .select("id, name")
      .eq("id", existingId)
      .maybeSingle();
    return {
      groupId: existingId,
      groupName: group?.name || `${selfName} & ${otherName}`,
      created: false,
    };
  }

  const slug = `dm-${randomToken(8)}`;
  const groupName = `${selfName} & ${otherName}`;
  const baseRow: Record<string, unknown> = {
    slug,
    name: groupName,
    description: "Private chat — connected by QR at OTWK.",
    is_default: false,
    created_by_customer_id: selfId,
  };

  let group: { id: string; name: string } | null = null;
  let insertError: { message: string } | null = null;

  const withType = await otwk
    .from("app_community_groups")
    .insert({
      ...baseRow,
      group_type: "direct",
      is_active: true,
      invite_code: `dm-${randomToken(3)}`,
    })
    .select("id, name")
    .single();

  if (!withType.error && withType.data) {
    group = withType.data;
  } else {
    insertError = withType.error;
    const fallback = await otwk.from("app_community_groups").insert(baseRow).select("id, name").single();
    if (fallback.error || !fallback.data) {
      throw new Error(insertError?.message || fallback.error?.message || "Failed to create chat");
    }
    group = fallback.data;
  }

  const members = [
    { group_id: group.id, tavari_customer_id: selfId, display_name: selfName },
    { group_id: group.id, tavari_customer_id: otherId, display_name: otherName },
  ];
  const { error: memberError } = await otwk.from("app_community_group_members").upsert(members, {
    onConflict: "group_id,tavari_customer_id",
  });
  if (memberError) throw memberError;

  return { groupId: group.id, groupName: group.name, created: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const businessId = (url.searchParams.get("businessId") || "").trim();
    if (!UUID_RE.test(businessId)) {
      return json({ error: "Invalid businessId" }, 400);
    }

    const session = await verifyCustomerSessionToken(extractBearerToken(req) || "");
    if (!session) return json({ error: "Unauthorized" }, 401);
    if (session.businessId !== businessId) {
      return json({ error: "Session does not match this business" }, 403);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (req.method === "GET") {
      let displayName = "Parent";
      const headerName = req.headers.get("x-parent-display-name");
      if (headerName?.trim()) displayName = headerName.trim();

      const { token, displayName: name } = await ensureConnectToken(
        admin,
        businessId,
        session.customerId,
        displayName,
      );
      const connectUrl = parentConnectUrl(token);
      return json({
        token,
        connectUrl,
        displayName: name,
        deepLink: `otwkapp://community/connect/${token}`,
      });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const action = String(body.action || "").trim();

      if (action === "issueToken" || action === "getToken") {
        let displayName = "Parent";
        const headerName = req.headers.get("x-parent-display-name");
        const bodyName = body.displayName;
        if (headerName?.trim()) displayName = headerName.trim();
        else if (typeof bodyName === "string" && bodyName.trim()) displayName = bodyName.trim();

        const { token, displayName: name } = await ensureConnectToken(
          admin,
          businessId,
          session.customerId,
          displayName,
        );
        const connectUrl = parentConnectUrl(token);
        return json({
          token,
          connectUrl,
          displayName: name,
          deepLink: `otwkapp://community/connect/${token}`,
        });
      }

      const parsed = parseConnectToken(String(body.token || ""));
      if (!parsed) return json({ error: "Invalid connect code" }, 400);

      const selfName = String(body.displayName || "Parent").trim() || "Parent";

      const { data: other, error: lookupError } = await admin
        .from("business_customer_connect_tokens")
        .select("customer_id, display_name, business_id")
        .eq("token", parsed)
        .maybeSingle();

      if (lookupError) return json({ error: lookupError.message }, 500);
      if (!other) return json({ error: "Connect code not found" }, 404);
      if (other.business_id !== businessId) {
        return json({ error: "This code is for a different business" }, 400);
      }

      const otwk = otwkAdmin();
      if (!otwk) {
        return json({ error: "Community chat is not configured on the server" }, 503);
      }

      const result = await getOrCreateDirectGroup(
        otwk,
        session.customerId,
        selfName,
        other.customer_id,
        String(other.display_name || "Parent"),
      );

      return json({
        ok: true,
        groupId: result.groupId,
        groupName: result.groupName,
        created: result.created,
        joined: true,
      });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error("[tavari-api-customer-community-connect]", error);
    return json(
      { error: error instanceof Error ? error.message : "Server error" },
      500,
    );
  }
});
