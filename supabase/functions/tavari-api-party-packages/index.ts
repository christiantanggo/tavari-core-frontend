// Public birthday party packages for external websites (OTWK).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ACTIVITY_PARTY_PACKAGE_SELECT_COLS,
  DEFAULT_UNLIMITED_PLAY_POLICY,
  INVENTORY_PARTY_PACKAGE_SELECT_COLS,
  mapActivityToPublicPartyPackage,
  mapInventoryOnlyToPublicPartyPackage,
  primaryInventoryIdFromTicketSettings,
  type ActivityRow,
  type InventoryPartyRow,
  type PublicPartyPackage,
} from "../_shared/tavariPublicPartyPackages.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function resolveBusinessId(req: Request, body: Record<string, unknown>): string {
  const url = new URL(req.url);
  return String(
    body.businessId
      ?? body.business_id
      ?? url.searchParams.get("businessId")
      ?? url.searchParams.get("business_id")
      ?? "",
  ).trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const body = req.method === "POST"
      ? await req.json().catch(() => ({})) as Record<string, unknown>
      : {};
    const businessId = resolveBusinessId(req, body);

    if (!businessId || !UUID_RE.test(businessId)) {
      return json({ ok: false, error: "Valid businessId is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const [{ data: activities, error: actErr }, { data: inventoryOnly, error: invErr }] = await Promise.all([
      supabase
        .from("booking_activities")
        .select(ACTIVITY_PARTY_PACKAGE_SELECT_COLS)
        .eq("business_id", businessId)
        .eq("website_show_party_package", true)
        .eq("is_active", true)
        .order("website_sort_order", { ascending: true }),
      supabase
        .from("pos_inventory")
        .select(INVENTORY_PARTY_PACKAGE_SELECT_COLS)
        .eq("business_id", businessId)
        .eq("website_show_party_package", true)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
    ]);

    if (actErr) {
      console.error("[tavari-api-party-packages] activities", actErr);
      return json({ ok: false, error: actErr.message }, 500);
    }
    if (invErr) {
      console.error("[tavari-api-party-packages] inventory", invErr);
      return json({ ok: false, error: invErr.message }, 500);
    }

    const activityRows = (activities ?? []) as ActivityRow[];
    const inventoryOnlyRows = (inventoryOnly ?? []) as InventoryPartyRow[];

    const inventoryIds = new Set<string>();
    for (const activity of activityRows) {
      const id = primaryInventoryIdFromTicketSettings(activity.ticket_settings);
      if (id) inventoryIds.add(id);
    }
    for (const row of inventoryOnlyRows) {
      inventoryIds.add(row.id);
    }

    let inventoryById = new Map<string, InventoryPartyRow>();
    if (inventoryIds.size > 0) {
      const { data: inventoryRows, error: priceErr } = await supabase
        .from("pos_inventory")
        .select(INVENTORY_PARTY_PACKAGE_SELECT_COLS)
        .eq("business_id", businessId)
        .in("id", Array.from(inventoryIds));

      if (priceErr) {
        console.error("[tavari-api-party-packages] inventory prices", priceErr);
        return json({ ok: false, error: priceErr.message }, 500);
      }

      inventoryById = new Map(
        ((inventoryRows ?? []) as InventoryPartyRow[]).map((row) => [row.id, row]),
      );
    }

    const packages: PublicPartyPackage[] = [];
    const linkedInventoryIds = new Set<string>();

    for (const activity of activityRows) {
      const inventoryId = primaryInventoryIdFromTicketSettings(activity.ticket_settings);
      if (inventoryId) linkedInventoryIds.add(inventoryId);
      const inventory = inventoryId ? inventoryById.get(inventoryId) ?? null : null;
      const pkg = mapActivityToPublicPartyPackage(activity, inventory, {
        unlimitedPlayPolicy: DEFAULT_UNLIMITED_PLAY_POLICY,
      });
      if (pkg) packages.push(pkg);
    }

    for (const row of inventoryOnlyRows) {
      if (linkedInventoryIds.has(row.id)) continue;
      const pkg = mapInventoryOnlyToPublicPartyPackage(row, {
        unlimitedPlayPolicy: DEFAULT_UNLIMITED_PLAY_POLICY,
        highlighted: true,
      });
      if (pkg) packages.push(pkg);
    }

    packages.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    return json({
      ok: true,
      businessId,
      unlimitedPlayPolicy: DEFAULT_UNLIMITED_PLAY_POLICY,
      packages: packages.filter((pkg) => pkg.available),
    });
  } catch (e) {
    console.error("[tavari-api-party-packages]", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Internal error" }, 500);
  }
});
