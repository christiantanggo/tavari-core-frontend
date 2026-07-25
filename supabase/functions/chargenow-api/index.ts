/**
 * ChargeNow (cdb-open-api) authenticated proxy.
 *
 * Secrets (Supabase project settings → Edge Functions):
 *   CHARGENOW_API_USERNAME
 *   CHARGENOW_API_PASSWORD
 *   CHARGENOW_BASE_URL (optional; default https://developer.chargenow.top/cdb-open-api/v1)
 *
 * Invoked from dashboard with user JWT; only owner/admin/manager on the given business.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_BASE = "https://developer.chargenow.top/cdb-open-api/v1";
const MANAGER_ROLES = new Set(["owner", "manager", "admin"]);

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function basicAuthHeader(user: string, pass: string): string {
  const raw = `${user}:${pass}`;
  const b64 = btoa(raw);
  return `Basic ${b64}`;
}

async function chargenowFetch(
  pathWithQuery: string,
  init: RequestInit,
  authHeader: string,
): Promise<Response> {
  const base = (Deno.env.get("CHARGENOW_BASE_URL") || DEFAULT_BASE).replace(/\/$/, "");
  const url = `${base}${pathWithQuery.startsWith("/") ? "" : "/"}${pathWithQuery}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", authHeader);
  return fetch(url, { ...init, headers });
}

function qp(params: Record<string, string | number | boolean | undefined | null>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeaderIn = req.headers.get("Authorization") || "";
  if (!authHeaderIn) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const userPass = Deno.env.get("CHARGENOW_API_USERNAME");
  const apiPass = Deno.env.get("CHARGENOW_API_PASSWORD");
  if (!userPass || !apiPass) {
    console.error("chargenow-api: missing CHARGENOW_API_USERNAME / CHARGENOW_API_PASSWORD");
    return jsonResponse({ error: "ChargeNow API not configured on server" }, 503);
  }

  const chargeAuth = basicAuthHeader(userPass, apiPass);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeaderIn } },
  });

  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();

  if (userErr || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const action = String(body.action || "").trim();
  const businessId = String(body.businessId || body.business_id || "").trim();

  if (!businessId) {
    return jsonResponse({ error: "businessId is required" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: membership, error: memErr } = await admin
    .from("business_users")
    .select("role")
    .eq("business_id", businessId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (memErr || !membership?.role || !MANAGER_ROLES.has(String(membership.role))) {
    return jsonResponse({ error: "Forbidden for this business" }, 403);
  }

  try {
    let res: Response;

    switch (action) {
      /* -------- Open API / rent -------- */
      case "rentCabinetQuery": {
        const deviceId = String(body.deviceId || "").trim();
        if (!deviceId) return jsonResponse({ error: "deviceId required" }, 400);
        res = await chargenowFetch(`/rent/cabinet/query${qp({ deviceId })}`, { method: "GET" }, chargeAuth);
        break;
      }
      case "rentOrderCreate": {
        const deviceId = String(body.deviceId || "").trim();
        const callbackURL = String(body.callbackURL || "").trim();
        if (!deviceId || !callbackURL) {
          return jsonResponse({ error: "deviceId and callbackURL required" }, 400);
        }
        res = await chargenowFetch(`/rent/order/create${qp({ deviceId, callbackURL })}`, {
          method: "POST",
        }, chargeAuth);
        break;
      }
      case "rentOrderClose": {
        const tradeNo = String(body.tradeNo || "").trim();
        if (!tradeNo) return jsonResponse({ error: "tradeNo required" }, 400);
        res = await chargenowFetch(`/rent/order/close${qp({ tradeNo })}`, { method: "POST" }, chargeAuth);
        break;
      }
      case "rentOrderDetail": {
        const tradeNo = String(body.tradeNo || "").trim();
        if (!tradeNo) return jsonResponse({ error: "tradeNo required" }, 400);
        res = await chargenowFetch(`/rent/order/detail${qp({ tradeNo })}`, { method: "GET" }, chargeAuth);
        break;
      }
      case "rentCabinetList": {
        const coordType = String(body.coordType || "GCJ-02").trim();
        const zoomLevel = String(body.zoomLevel ?? "5").trim();
        const lat = String(body.lat || "").trim();
        const lng = String(body.lng || "").trim();
        const showPrice = body.showPrice !== undefined ? String(body.showPrice) : "true";
        if (!lat || !lng) return jsonResponse({ error: "lat and lng required" }, 400);
        res = await chargenowFetch(
          `/rent/cabinet/list${qp({ coordType, zoomLevel, lat, lng, showPrice })}`,
          { method: "POST" },
          chargeAuth,
        );
        break;
      }

      /* -------- Advance API / cabinet -------- */
      case "cabinetOperation": {
        const cabinetid = String(body.cabinetid || body.cabinetId || "").trim();
        const slotNum = Number(body.slotNum);
        const operationType = String(body.operationType || "").trim();
        const reason = String(body.reason ?? "");
        if (!cabinetid || !operationType || Number.isNaN(slotNum)) {
          return jsonResponse({ error: "cabinetid, slotNum, operationType required" }, 400);
        }
        res = await chargenowFetch(
          `/cabinet/operation${qp({
            cabinetid,
            slotNum,
            operationType,
            reason,
            batcabFault: body.batcabFault as number | undefined,
            batteryFault: body.batteryFault as number | undefined,
            type: body.type as number | undefined,
            gpsTime: body.gpsTime as number | undefined,
          })}`,
          { method: "POST" },
          chargeAuth,
        );
        break;
      }
      case "cabinetEjectByRepair": {
        const cabinetid = String(body.cabinetid || body.cabinetId || "").trim();
        const slotNum = body.slotNum === undefined || body.slotNum === null
          ? 0
          : Number(body.slotNum);
        if (!cabinetid) return jsonResponse({ error: "cabinetid required" }, 400);
        res = await chargenowFetch(
          `/cabinet/ejectByRepair${qp({ cabinetid, slotNum })}`,
          { method: "POST" },
          chargeAuth,
        );
        break;
      }
      case "cabinetEjectByRent": {
        const cabinetid = String(body.cabinetid || body.cabinetId || "").trim();
        const rentOrderId = String(body.rentOrderId || "").trim();
        const slotNum = Number(body.slotNum);
        if (!cabinetid || !rentOrderId || Number.isNaN(slotNum)) {
          return jsonResponse({ error: "cabinetid, rentOrderId, slotNum required" }, 400);
        }
        res = await chargenowFetch(
          `/cabinet/ejectByRent${qp({ cabinetid, rentOrderId, slotNum })}`,
          { method: "POST" },
          chargeAuth,
        );
        break;
      }
      case "cabinetGetAllDevice": {
        res = await chargenowFetch(`/cabinet/getAllDevice`, { method: "GET" }, chargeAuth);
        break;
      }
      case "cabinetDetail": {
        const cabinetId = encodeURIComponent(String(body.cabinetId || "").trim());
        if (!cabinetId) return jsonResponse({ error: "cabinetId required" }, 400);
        res = await chargenowFetch(`/cabinet/detail/${cabinetId}`, { method: "GET" }, chargeAuth);
        break;
      }
      case "cabinetGetDeviceByShopId": {
        const shopid = String(body.shopid || body.shopId || "").trim();
        if (!shopid) return jsonResponse({ error: "shopid required" }, 400);
        res = await chargenowFetch(`/cabinet/getDeviceByShopId${qp({ shopid })}`, { method: "GET" }, chargeAuth);
        break;
      }
      case "cabinetBatteryList": {
        const cabinetId = encodeURIComponent(String(body.cabinetId || "").trim());
        if (!cabinetId) return jsonResponse({ error: "cabinetId required" }, 400);
        res = await chargenowFetch(
          `/cabinet/batteryListByCabinetId/${cabinetId}`,
          { method: "GET" },
          chargeAuth,
        );
        break;
      }
      case "cabinetSlotList": {
        const cabinetId = encodeURIComponent(String(body.cabinetId || "").trim());
        if (!cabinetId) return jsonResponse({ error: "cabinetId required" }, 400);
        res = await chargenowFetch(`/cabinet/slotByCabinetId/${cabinetId}`, { method: "GET" }, chargeAuth);
        break;
      }
      case "cabinetBind2Shop": {
        const qrcode = encodeURIComponent(String(body.qrcode || "").trim());
        const newshopid = encodeURIComponent(String(body.newshopid || body.newShopId || "").trim());
        if (!qrcode || !newshopid) return jsonResponse({ error: "qrcode and newshopid required" }, 400);
        res = await chargenowFetch(`/cabinet/bind2shop/${qrcode}/${newshopid}`, { method: "POST" }, chargeAuth);
        break;
      }
      case "cabinetBindAd": {
        const payload = body.payload;
        if (!payload || typeof payload !== "object") {
          return jsonResponse({ error: "payload (OpenAdPublishDTO object) required" }, 400);
        }
        res = await chargenowFetch(`/cabinet/bindAd`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }, chargeAuth);
        break;
      }

      /* -------- Shop -------- */
      case "shopDetail": {
        const shopid = encodeURIComponent(String(body.shopid || body.shopId || "").trim());
        if (!shopid) return jsonResponse({ error: "shopid required" }, 400);
        res = await chargenowFetch(`/shop/detail/${shopid}`, { method: "GET" }, chargeAuth);
        break;
      }
      case "shopUpdate": {
        const payload = body.payload;
        if (!payload || typeof payload !== "object") {
          return jsonResponse({ error: "payload (CdbShopEntity) required" }, 400);
        }
        res = await chargenowFetch(`/shop/update`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }, chargeAuth);
        break;
      }

      /* -------- Price strategy -------- */
      case "priceStrategyPage": {
        const payload = body.payload;
        if (!payload || typeof payload !== "object") {
          return jsonResponse({ error: "payload (OpenPriceStrategyQueryDto) required" }, 400);
        }
        res = await chargenowFetch(`/shop/priceStrategy/page`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }, chargeAuth);
        break;
      }
      case "priceStrategyDetail": {
        const priceId = encodeURIComponent(String(body.priceId || "").trim());
        if (!priceId) return jsonResponse({ error: "priceId required" }, 400);
        res = await chargenowFetch(`/shop/priceStrategy/detail/${priceId}`, { method: "GET" }, chargeAuth);
        break;
      }
      case "priceStrategySave": {
        const payload = body.payload;
        if (!payload || typeof payload !== "object") {
          return jsonResponse({ error: "payload (OpenPriceStrategySaveDto) required" }, 400);
        }
        res = await chargenowFetch(`/shop/priceStrategy/saveOrUpdate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }, chargeAuth);
        break;
      }
      case "priceStrategyDelete": {
        const ids = body.ids;
        if (!Array.isArray(ids)) return jsonResponse({ error: "ids (number[]) required" }, 400);
        res = await chargenowFetch(`/shop/priceStrategy/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ids),
        }, chargeAuth);
        break;
      }
      case "priceStrategyBindShop": {
        const payload = body.payload;
        if (!payload || typeof payload !== "object") {
          return jsonResponse({ error: "payload (OpenPriceStrategyShopBindDto) required" }, 400);
        }
        res = await chargenowFetch(`/shop/priceStrategy/bindShop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }, chargeAuth);
        break;
      }
      case "priceStrategyUnbindShop": {
        const payload = body.payload;
        if (!payload || typeof payload !== "object") {
          return jsonResponse({ error: "payload (OpenPriceStrategyShopUnbindDto) required" }, 400);
        }
        res = await chargenowFetch(`/shop/priceStrategy/unbindShop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }, chargeAuth);
        break;
      }

      /* -------- Event push config -------- */
      case "eventPushConfig": {
        const payload = body.payload;
        if (!payload || typeof payload !== "object") {
          return jsonResponse({ error: "payload (AgentCabinetEventPushConfig) required" }, 400);
        }
        res = await chargenowFetch(`/cabinet/eventPush/config`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }, chargeAuth);
        break;
      }
      case "eventPushConfigGet": {
        res = await chargenowFetch(`/cabinet/eventPush/config/get`, { method: "GET" }, chargeAuth);
        break;
      }

      default:
        return jsonResponse({
          error: "Unknown action",
          hint: "See chargenow-api index.ts for supported action names",
        }, 400);
    }

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }

    return jsonResponse({
      ok: res.ok,
      status: res.status,
      data: parsed,
    });
  } catch (e) {
    console.error("chargenow-api error", e);
    return jsonResponse({ error: (e as Error)?.message || "ChargeNow request failed" }, 502);
  }
});
