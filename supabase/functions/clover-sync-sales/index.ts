import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  collectPaymentsForSyncDate,
  defaultSyncDateInTimeZone,
} from "../_shared/cloverApi.ts";
import { getCloverCredentialsForBusiness } from "../_shared/cloverBusinessCredentials.ts";
import { upsertCloverTransactionRow } from "../_shared/cloverTransactionStore.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MANAGER_ROLES = new Set(["owner", "manager", "admin"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseSyncDate(value: unknown): string {
  const raw = value != null ? String(value).trim() : '';
  if (raw && DATE_RE.test(raw)) return raw;
  return defaultSyncDateInTimeZone("America/Toronto");
}

function getBearerToken(req: Request): string {
  const authHeader = req.headers.get("Authorization") || '';
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : '';
}

async function authorizeRequest(
  req: Request,
  admin: ReturnType<typeof createClient>,
  businessId: string,
): Promise<{ ok: true; userId?: string } | { ok: false; status: number; error: string }> {
  const bearer = getBearerToken(req);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || '';
  if (bearer && serviceKey && bearer === serviceKey) {
    return { ok: true };
  }

  if (!bearer) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  });

  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const { data: membership } = await admin
    .from("business_users")
    .select("role")
    .eq("business_id", businessId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership?.role || !MANAGER_ROLES.has(String(membership.role))) {
    return { ok: false, status: 403, error: "Forbidden for this business" };
  }

  return { ok: true, userId: user.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const businessId = String(body.businessId || body.business_id || "").trim();
  if (!businessId) {
    return jsonResponse({ error: "businessId is required" }, 400);
  }

  const auth = await authorizeRequest(req, admin, businessId);
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.status);
  }

  const syncDate = parseSyncDate(body.syncDate ?? body.sync_date);
  const creds = await getCloverCredentialsForBusiness(admin, businessId);
  if (!creds) {
    return jsonResponse({ error: "Clover credentials not configured for this business" }, 400);
  }

  const { data: businessRow } = await admin
    .from("businesses")
    .select("timezone")
    .eq("id", businessId)
    .maybeSingle();
  const timeZone = String(businessRow?.timezone || "America/Toronto").trim() || "America/Toronto";

  try {
    const payments = await collectPaymentsForSyncDate(creds, syncDate, timeZone);
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const details of payments) {
      const result = await upsertCloverTransactionRow(admin, {
        businessId,
        details,
        paymentSource: creds.paymentSource,
        eventDate: details.createdTime ?? details.modifiedTime,
      });

      if (!result.ok) {
        failed += 1;
        continue;
      }
      if (result.created) imported += 1;
      else updated += 1;
    }

    if (payments.length === 0) skipped = 0;

    return jsonResponse({
      ok: true,
      syncDate,
      scanned: payments.length,
      imported,
      updated,
      skipped,
      failed,
    });
  } catch (e) {
    console.error("[clover-sync-sales]", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Sync failed" }, 500);
  }
});
