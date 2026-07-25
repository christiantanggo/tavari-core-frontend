/**
 * Public vending kiosk API — authenticated via per-device kiosk secret (not staff JWT).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  aggregateProductsFromSlots,
  extractInventoryArrayFromDeviceDetail,
  extractInventoryFromTerminalStock,
  getVendingCredentials,
  makeVendingAPIRequest,
  mergeSlotRows,
  normalizeSlotRow,
  parseVendorOnlineFlag,
  resolveDevNo,
  sha256Hex,
  terminalBind,
  terminalGetStockData,
} from "../_shared/vendingYishouyun.ts";
import { syncPendingKioskHelcimFromHelcimApi } from "../_shared/kioskHelcimFinalization.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type KioskRequest = {
  action: string;
  businessId?: string;
  externalDeviceId?: string;
  kioskSecret?: string;
  kioskShortCode?: string;
  goodsId?: string;
  orderNo?: string;
  testVendBypass?: boolean;
  totalFee?: number;
  goodsItems?: Array<{
    orderNo: string;
    goodsId: string;
    goodsName: string;
    price: string;
  }>;
  notifyUrl?: string;
  checkoutToken?: string;
  expectedTotal?: number;
  items?: Array<{
    goodsId: string;
    goodsName?: string;
    price?: number;
    quantity: number;
    posInventoryId?: string | null;
  }>;
  staffUserId?: string;
  staffName?: string;
  batchOrderNo?: string;
  dispenseResults?: Array<{
    goodsId: string;
    goodsName?: string;
    price?: number;
    orderNo: string;
    ok: boolean;
    msg?: string;
  }>;
  commandId?: string;
  ok?: boolean;
  result?: unknown;
  errorMessage?: string;
};

async function verifyKioskDevice(
  businessId: string,
  externalDeviceId: string,
  kioskSecret: string,
) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const hash = await sha256Hex(kioskSecret);

  const { data, error } = await supabase
    .from("vending_devices")
    .select("id, business_id, external_device_id, kiosk_secret_hash, display_name, test_vend_enabled, dispense_mode, kiosk_access_mode")
    .eq("business_id", businessId)
    .eq("external_device_id", externalDeviceId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Device not registered for this business");
  if (data.kiosk_secret_hash !== hash) throw new Error("Invalid kiosk secret");

  return data;
}

async function verifyKioskByShortCode(kioskShortCode: string) {
  const code = String(kioskShortCode ?? "").trim().toUpperCase();
  if (!code || code.length < 4) throw new Error("Invalid kiosk code");

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from("vending_devices")
    .select("id, business_id, external_device_id, kiosk_secret_hash, display_name, kiosk_short_code, test_vend_enabled, dispense_mode, kiosk_access_mode")
    .eq("kiosk_short_code", code)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Unknown kiosk code — check the code from Tavari Vending → Devices");

  return data;
}

async function resolveKioskDevice(body: KioskRequest) {
  const shortCode = String(body.kioskShortCode ?? "").trim();
  if (shortCode) return verifyKioskByShortCode(shortCode);

  const businessId = String(body.businessId ?? "").trim();
  const externalDeviceId = String(body.externalDeviceId ?? "").trim();
  const kioskSecret = String(body.kioskSecret ?? "").trim();
  if (businessId && externalDeviceId && kioskSecret) {
    return verifyKioskDevice(businessId, externalDeviceId, kioskSecret);
  }

  throw new Error("kioskShortCode or businessId+externalDeviceId+kioskSecret required");
}

async function touchKioskBridgeSeen(deviceId: string) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  await supabase
    .from("vending_devices")
    .update({ kiosk_bridge_last_seen_at: new Date().toISOString() })
    .eq("id", deviceId);
}

async function loadTavariSlots(vendingDeviceId: string, businessId: string) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from("vending_device_slots")
    .select(`
      sev_no,
      row_num,
      col_num,
      manufacturer_goods_id,
      rs485_lane_byte,
      dual_vend_col_num,
      rs485_lane_byte_secondary,
      num,
      max_num,
      pos_inventory_id,
      pos_inventory (
        id,
        name,
        price,
        image_url,
        category_id,
        item_tax_overrides
      )
    `)
    .eq("vending_device_id", vendingDeviceId)
    .eq("business_id", businessId);

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const inv = row.pos_inventory as {
      id?: string;
      name?: string;
      price?: number;
      image_url?: string;
      category_id?: string | null;
      item_tax_overrides?: string[] | null;
    } | null;
    return {
      sev_no: row.sev_no,
      row_num: row.row_num,
      col_num: row.col_num,
      manufacturer_goods_id: row.manufacturer_goods_id,
      rs485_lane_byte: row.rs485_lane_byte,
      dual_vend_col_num: row.dual_vend_col_num,
      rs485_lane_byte_secondary: row.rs485_lane_byte_secondary,
      num: row.num ?? 0,
      max_num: row.max_num ?? 0,
      pos_inventory_id: row.pos_inventory_id,
      goods_name: inv?.name ?? "",
      price: inv?.price != null ? Number(inv.price) : undefined,
      pic_url: inv?.image_url ?? "",
      category_id: inv?.category_id ?? null,
      item_tax_overrides: inv?.item_tax_overrides ?? [],
    };
  });
}

type KioskProduct = {
  goodsId: string;
  goodsName: string;
  picUrl: string;
  price: number;
  num: number;
  maxNum: number;
  slots: unknown[];
  posInventoryId?: string | null;
  categoryId?: string | null;
  itemTaxOverrides?: string[];
  rs485LaneByte?: number | null;
  rs485LaneBytes?: number[];
};

async function enrichProductsWithTaxMeta(
  businessId: string,
  products: KioskProduct[],
): Promise<KioskProduct[]> {
  if (!products.length) return products;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: catalogRows } = await supabase
    .from("pos_inventory")
    .select("id, category_id, item_tax_overrides, vending_cloud_goods_id")
    .eq("business_id", businessId)
    .not("vending_cloud_goods_id", "is", null);

  const byGoodsId = new Map<string, {
    id: string;
    category_id: string | null;
    item_tax_overrides: string[] | null;
  }>();

  for (const row of catalogRows ?? []) {
    const gid = String(row.vending_cloud_goods_id ?? "").trim();
    if (!gid) continue;
    byGoodsId.set(gid, {
      id: row.id,
      category_id: row.category_id ?? null,
      item_tax_overrides: row.item_tax_overrides ?? [],
    });
  }

  return products.map((product) => {
    if (product.categoryId != null || product.posInventoryId) return product;
    const inv = byGoodsId.get(product.goodsId);
    if (!inv) return product;
    return {
      ...product,
      posInventoryId: inv.id,
      categoryId: inv.category_id,
      itemTaxOverrides: inv.item_tax_overrides ?? [],
    };
  });
}

function applyTaxFromTavariSlots(
  products: KioskProduct[],
  tavariRows: Array<{
    manufacturer_goods_id: string;
    pos_inventory_id?: string | null;
    category_id?: string | null;
    item_tax_overrides?: string[] | null;
  }>,
): KioskProduct[] {
  const byGoodsId = new Map<string, {
    posInventoryId: string | null;
    categoryId: string | null;
    itemTaxOverrides: string[];
  }>();

  for (const row of tavariRows) {
    const gid = String(row.manufacturer_goods_id ?? "").trim();
    if (!gid || byGoodsId.has(gid)) continue;
    byGoodsId.set(gid, {
      posInventoryId: row.pos_inventory_id ?? null,
      categoryId: row.category_id ?? null,
      itemTaxOverrides: row.item_tax_overrides ?? [],
    });
  }

  return products.map((product) => {
    const meta = byGoodsId.get(product.goodsId);
    if (!meta) return product;
    return {
      ...product,
      posInventoryId: meta.posInventoryId,
      categoryId: meta.categoryId,
      itemTaxOverrides: meta.itemTaxOverrides,
    };
  });
}

async function buildKioskProducts(device: {
  id: string;
  business_id: string;
  external_device_id: string;
  test_vend_enabled?: boolean | null;
  dispense_mode?: string | null;
  kiosk_access_mode?: string | null;
}) {
  const kioskAccessMode = device.kiosk_access_mode === "staff_pin" ? "staff_pin" : "payment";
  const tavariRows = await loadTavariSlots(device.id, device.business_id);
  const rs485Mode = device.dispense_mode === "rs485";

  if (rs485Mode) {
    const catalogRows = filterDualVendPartnerSlotRows(tavariRows);
    const mergedSlots = mergeSlotRows([], catalogRows);
    let products = aggregateProductsFromSlots(mergedSlots);
    products = attachRs485LaneBytes(products, tavariRows);
    let enrichedProducts = applyTaxFromTavariSlots(products, tavariRows);
    enrichedProducts = await enrichProductsWithTaxMeta(device.business_id, enrichedProducts);
    return {
      products: enrichedProducts,
      mergedSlots,
      terminalError: null,
      businessId: device.business_id,
      displayName: device.display_name,
      testVendEnabled: Boolean(device.test_vend_enabled),
      kioskAccessMode,
      dispenseMode: "rs485",
    };
  }

  const credentials = await getVendingCredentials();
  const hasTavariSlots = tavariRows.length > 0;
  const vendorTimeoutMs = hasTavariSlots ? 8000 : 12000;

  let vendorRows: ReturnType<typeof normalizeSlotRow>[] = [];
  let terminalError: string | null = null;

  try {
    const cloudDetail = await makeVendingAPIRequest(
      "/device_detail",
      "POST",
      { device_id: device.external_device_id },
      credentials,
      vendorTimeoutMs,
    );
    const rawData = (cloudDetail?.data ?? cloudDetail) as Record<string, unknown>;
    vendorRows = extractInventoryArrayFromDeviceDetail(rawData).map((row, idx) =>
      normalizeSlotRow(row, idx)
    );
  } catch (e) {
    terminalError = e instanceof Error ? e.message : String(e);
  }

  // Terminal bind is slow and often fails; skip when Tavari slot records already define the catalog.
  if (vendorRows.length === 0 && !hasTavariSlots) {
    try {
      const devNo = await resolveDevNo(device.external_device_id, credentials);
      const { token } = await terminalBind(devNo, credentials);
      const stockHit = await terminalGetStockData(token, credentials);
      if (stockHit) {
        vendorRows = extractInventoryFromTerminalStock(stockHit.payload).map((row, idx) =>
          normalizeSlotRow(row, idx)
        );
      }
    } catch (e) {
      terminalError = terminalError || (e instanceof Error ? e.message : String(e));
    }
  }

  const mergedSlots = mergeSlotRows(vendorRows, tavariRows);
  const products = aggregateProductsFromSlots(mergedSlots);

  if (products.length === 0 && tavariRows.length === 0) {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: catalogRows } = await supabase
      .from("pos_inventory")
      .select("id, name, price, image_url, vending_cloud_goods_id, category_id, item_tax_overrides")
      .eq("business_id", device.business_id)
      .not("vending_cloud_goods_id", "is", null);

    for (const row of catalogRows ?? []) {
      const gid = String(row.vending_cloud_goods_id ?? "").trim();
      if (!gid) continue;
      products.push({
        goodsId: gid,
        goodsName: row.name || `Product ${gid}`,
        picUrl: row.image_url || "",
        price: Number(row.price ?? 0),
        num: 1,
        maxNum: 10,
        slots: [],
        posInventoryId: row.id,
        categoryId: row.category_id ?? null,
        itemTaxOverrides: row.item_tax_overrides ?? [],
      });
    }
  }

  let enrichedProducts = applyTaxFromTavariSlots(products, tavariRows);
  enrichedProducts = await enrichProductsWithTaxMeta(device.business_id, enrichedProducts);
  enrichedProducts = attachRs485LaneBytes(enrichedProducts, tavariRows);

  return {
    products: enrichedProducts,
    mergedSlots,
    terminalError,
    businessId: device.business_id,
    displayName: device.display_name,
    testVendEnabled: Boolean(device.test_vend_enabled),
    kioskAccessMode,
    dispenseMode: "cloud",
  };
}

async function decrementSlotStock(
  supabase: ReturnType<typeof createClient>,
  vendingDeviceId: string,
  goodsId: string,
) {
  const { data: slotRows } = await supabase
    .from("vending_device_slots")
    .select("id, num")
    .eq("vending_device_id", vendingDeviceId)
    .eq("manufacturer_goods_id", goodsId)
    .gt("num", 0)
    .limit(1);

  if (slotRows?.[0]) {
    const nextNum = Math.max(0, Number(slotRows[0].num) - 1);
    await supabase
      .from("vending_device_slots")
      .update({ num: nextNum, updated_at: new Date().toISOString() })
      .eq("id", slotRows[0].id);
  }
}

async function insertStaffDispenseRows(
  supabase: ReturnType<typeof createClient>,
  device: { id: string; business_id: string },
  staffUserId: string,
  staffName: string,
  lines: Array<{
    goodsId: string;
    goodsName: string;
    price: number;
    orderNo: string;
    posInventoryId?: string | null;
  }>,
) {
  if (!lines.length) return;

  const rows = lines.map((line) => ({
    business_id: device.business_id,
    vending_device_id: device.id,
    staff_user_id: staffUserId,
    staff_name: staffName,
    manufacturer_goods_id: line.goodsId,
    goods_name: line.goodsName,
    pos_inventory_id: line.posInventoryId ?? null,
    quantity: 1,
    unit_price: line.price,
    order_no: line.orderNo,
    dispensed_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("vending_staff_dispenses").insert(rows);
  if (error) throw new Error(error.message);

  for (const line of lines) {
    await decrementSlotStock(supabase, device.id, line.goodsId);
  }
}

function filterDualVendPartnerSlotRows(
  rows: Array<{ row_num: number; col_num: number; dual_vend_col_num?: number | null }>,
) {
  const partnerKeys = new Set<string>();
  for (const row of rows) {
    if (row.dual_vend_col_num != null) {
      partnerKeys.add(`${row.row_num}-${row.dual_vend_col_num}`);
    }
  }
  return rows.filter((row) => !partnerKeys.has(`${row.row_num}-${row.col_num}`));
}

function attachRs485LaneBytes(
  products: KioskProduct[],
  tavariRows: Array<{
    manufacturer_goods_id: string;
    rs485_lane_byte?: number | null;
    rs485_lane_byte_secondary?: number | null;
    dual_vend_col_num?: number | null;
    row_num?: number;
    col_num?: number;
  }>,
): KioskProduct[] {
  const partnerKeys = new Set<string>();
  for (const row of tavariRows) {
    if (row.dual_vend_col_num != null && row.row_num != null) {
      partnerKeys.add(`${row.row_num}-${row.dual_vend_col_num}`);
    }
  }

  const byGoods = new Map<string, { laneBytes: number[] }>();

  for (const row of tavariRows) {
    if (row.row_num == null || row.col_num == null) continue;
    const slotKey = `${row.row_num}-${row.col_num}`;
    if (partnerKeys.has(slotKey)) continue;

    const gid = String(row.manufacturer_goods_id ?? "").trim();
    if (!gid || byGoods.has(gid)) continue;

    const rowNum = Number(row.row_num);
    const colNum = Number(row.col_num);
    const primary =
      row.rs485_lane_byte != null
        ? Number(row.rs485_lane_byte)
        : (rowNum - 1) * 10 + (colNum - 1);
    const laneBytes = [primary];

    if (row.dual_vend_col_num != null) {
      const partnerCol = Number(row.dual_vend_col_num);
      const secondary =
        row.rs485_lane_byte_secondary != null
          ? Number(row.rs485_lane_byte_secondary)
          : (rowNum - 1) * 10 + (partnerCol - 1);
      laneBytes.push(secondary);
    }

    byGoods.set(gid, {
      laneBytes,
    });
  }

  return products.map((product) => {
    const cfg = byGoods.get(product.goodsId);
    if (!cfg) return product;
    return {
      ...product,
      rs485LaneByte: cfg.laneBytes[0] ?? null,
      rs485LaneBytes: cfg.laneBytes,
    };
  });
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as KioskRequest;
    const { action } = body;

    const device = await resolveKioskDevice(body);
    const externalDeviceId = device.external_device_id;
    const businessId = device.business_id;

    // Heartbeat for dashboard "tablet connected" — any kiosk API call from the tablet app.
    if (device.dispense_mode === "rs485") {
      await touchKioskBridgeSeen(device.id);
    }

    switch (action) {
      case "getProducts": {
        const payload = await buildKioskProducts(device);
        return new Response(
          JSON.stringify({ err: 0, msg: "OK", data: payload }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "checkMachineOnline": {
        if (device.dispense_mode === "rs485") {
          return new Response(
            JSON.stringify({
              err: 0,
              msg: "OK",
              data: {
                status: true,
                dispenseMode: "rs485",
                pingOnline: true,
                detailOnline: null,
                portalMayShowOnline: false,
              },
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const credentials = await getVendingCredentials();
        const onlineResult = await makeVendingAPIRequest(
          "/check_dev_online",
          "GET",
          { device_id: externalDeviceId },
          credentials,
          8000,
        );
        const pingOnline = parseVendorOnlineFlag(onlineResult.data ?? onlineResult);
        let lastReportAt: string | null = null;
        let detailOnline: boolean | null = null;
        // Only fetch device_detail when ping fails — keeps status checks fast.
        if (!pingOnline) {
          try {
            const detailResult = await makeVendingAPIRequest(
              "/device_detail",
              "POST",
              { device_id: externalDeviceId },
              credentials,
              8000,
            );
            const detailData = (detailResult?.data ?? detailResult) as Record<string, unknown>;
            if (detailData?.last_report_at != null) {
              lastReportAt = String(detailData.last_report_at);
            } else if (detailData?.lastReportAt != null) {
              lastReportAt = String(detailData.lastReportAt);
            }
            detailOnline = parseVendorOnlineFlag(detailData);
          } catch {
            /* optional */
          }
        }
        const online = pingOnline;
        return new Response(
          JSON.stringify({
            err: 0,
            msg: "OK",
            data: {
              status: online,
              lastReportAt,
              detailOnline,
              pingOnline,
              portalMayShowOnline: detailOnline === true && !pingOnline,
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "checkCanOrder": {
        const goodsId = String(body.goodsId ?? "").trim();
        if (!goodsId) {
          return new Response(JSON.stringify({ err: 400, msg: "goodsId is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const credentials = await getVendingCredentials();
        const result = await makeVendingAPIRequest(
          "/check_dev_state",
          "GET",
          { device_id: externalDeviceId, goods_id: goodsId },
          credentials,
        );
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "createOrder": {
        const testBypass = body.testVendBypass === true;
        if (!device.test_vend_enabled && !testBypass) {
          return new Response(
            JSON.stringify({
              err: 403,
              msg: "Test vend is disabled — enable it in Tavari Vending → Devices, or open the kiosk with ?testVend=1.",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const goodsId = String(body.goodsId ?? "").trim();
        if (!goodsId) {
          return new Response(JSON.stringify({ err: 400, msg: "goodsId is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const credentials = await getVendingCredentials();
        const orderNo = String(body.orderNo ?? "").trim() || `TEST-${Date.now()}`;
        const canState = await makeVendingAPIRequest(
          "/check_dev_state",
          "GET",
          { device_id: externalDeviceId, goods_id: goodsId },
          credentials,
        );
        if (typeof canState.err === "number" && canState.err !== 0) {
          const base = String(canState.msg ?? "Cannot vend");
          return new Response(
            JSON.stringify({
              err: canState.err,
              msg: `${base} — Dispense API reports offline. Manufacturer portal may still show Online; restart device 102152 or fix Wi‑Fi.`,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const result = await makeVendingAPIRequest(
          "/order_build",
          "GET",
          {
            device_id: externalDeviceId,
            goods_id: goodsId,
            order_no: orderNo,
          },
          credentials,
        );
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "createOrderWithPayment": {
        const credentials = await getVendingCredentials();
        const result = await makeVendingAPIRequest(
          "/build_order",
          "POST",
          {
            device_id: externalDeviceId,
            order_no: body.orderNo,
            total_fee: body.totalFee,
            goods_items: JSON.stringify(body.goodsItems),
            notify_url: body.notifyUrl,
          },
          credentials,
        );
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "fulfillPaidOrder": {
        const checkoutToken = String(body.checkoutToken ?? "").trim();
        const expectedTotal = Number(body.expectedTotal);
        const items = Array.isArray(body.items) ? body.items : [];

        if (!checkoutToken) {
          return new Response(JSON.stringify({ error: "checkoutToken is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (!Number.isFinite(expectedTotal) || expectedTotal <= 0) {
          return new Response(JSON.stringify({ error: "expectedTotal must be positive" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (!items.length) {
          return new Response(JSON.stringify({ error: "items are required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        await syncPendingKioskHelcimFromHelcimApi(supabase, checkoutToken);

        const { data: helcim, error: helcimErr } = await supabase
          .from("kiosk_helcim_pending")
          .select("id, status, business_id, amount")
          .eq("checkout_token", checkoutToken)
          .maybeSingle();

        if (helcimErr) throw new Error(helcimErr.message);
        if (!helcim) throw new Error("Payment session not found");
        if (helcim.business_id !== businessId) throw new Error("Payment does not match this business");
        if (helcim.status !== "completed") throw new Error("Payment not completed yet");

        const paidAmount = Number(helcim.amount);
        if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - expectedTotal) > 0.02) {
          throw new Error("Paid amount does not match order total");
        }

        const idempotencyKey = `helcim-${helcim.id}`;
        const { data: existingOrder } = await supabase
          .from("vending_processed_orders")
          .select("id")
          .eq("business_id", businessId)
          .eq("external_order_no", idempotencyKey)
          .maybeSingle();

        if (existingOrder) {
          return new Response(
            JSON.stringify({
              err: 0,
              msg: "Already fulfilled",
              data: { alreadyFulfilled: true, dispenseResults: [], clientDispense: device.dispense_mode === "rs485" },
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        if (device.dispense_mode === "rs485") {
          await supabase.from("vending_processed_orders").insert({
            business_id: businessId,
            external_order_no: idempotencyKey,
          });

          return new Response(
            JSON.stringify({
              err: 0,
              msg: "OK",
              data: {
                clientDispense: true,
                items,
                helcimId: helcim.id,
                dispenseResults: [],
                partial: false,
              },
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const credentials = await getVendingCredentials();
        const dispenseResults: Array<{
          goodsId: string;
          orderNo: string;
          ok: boolean;
          msg?: string;
        }> = [];

        for (const item of items) {
          const goodsId = String(item.goodsId ?? "").trim();
          const qty = Math.max(1, Math.min(20, Number(item.quantity) || 1));
          if (!goodsId) continue;

          for (let q = 0; q < qty; q++) {
            const orderNo = `VM-${helcim.id.slice(0, 8)}-${goodsId}-${q}`;
            const result = await makeVendingAPIRequest(
              "/order_build",
              "GET",
              {
                device_id: externalDeviceId,
                goods_id: goodsId,
                order_no: orderNo,
              },
              credentials,
            );
            const ok = typeof result.err === "number" ? result.err === 0 : false;
            dispenseResults.push({
              goodsId,
              orderNo,
              ok,
              msg: String(result.msg ?? ""),
            });

            if (ok) {
              const { data: slotRows } = await supabase
                .from("vending_device_slots")
                .select("id, num")
                .eq("vending_device_id", device.id)
                .eq("manufacturer_goods_id", goodsId)
                .gt("num", 0)
                .limit(1);

              if (slotRows?.[0]) {
                const nextNum = Math.max(0, Number(slotRows[0].num) - 1);
                await supabase
                  .from("vending_device_slots")
                  .update({ num: nextNum, updated_at: new Date().toISOString() })
                  .eq("id", slotRows[0].id);
              }
            }
          }
        }

        const anyOk = dispenseResults.some((r) => r.ok);
        if (!anyOk) {
          throw new Error(
            dispenseResults[0]?.msg || "Could not dispense any items — contact staff for a refund",
          );
        }

        await supabase.from("vending_processed_orders").insert({
          business_id: businessId,
          external_order_no: idempotencyKey,
        });

        return new Response(
          JSON.stringify({
            err: 0,
            msg: "OK",
            data: { dispenseResults, partial: dispenseResults.some((r) => !r.ok) },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "pollRemoteDispense": {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const now = new Date().toISOString();

        const { data: pending } = await supabase
          .from("vending_device_dispense_commands")
          .select("id, lane_byte, lane_byte_secondary, row_num, col_num, status")
          .eq("vending_device_id", device.id)
          .eq("status", "pending")
          .gt("expires_at", now)
          .order("created_at", { ascending: true })
          .limit(1);

        if (!pending?.[0]) {
          return new Response(
            JSON.stringify({ err: 0, msg: "OK", data: { command: null } }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const { data: claimed, error: claimErr } = await supabase
          .from("vending_device_dispense_commands")
          .update({ status: "running", started_at: now })
          .eq("id", pending[0].id)
          .eq("status", "pending")
          .select("id, lane_byte, lane_byte_secondary, row_num, col_num")
          .maybeSingle();

        if (claimErr) throw new Error(claimErr.message);

        return new Response(
          JSON.stringify({
            err: 0,
            msg: "OK",
            data: { command: claimed ?? null },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "completeRemoteDispense": {
        const commandId = String(body.commandId ?? "").trim();
        if (!commandId) {
          return new Response(JSON.stringify({ err: 400, msg: "commandId is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const now = new Date().toISOString();
        const ok = body.ok === true;

        const { error } = await supabase
          .from("vending_device_dispense_commands")
          .update({
            status: ok ? "completed" : "failed",
            completed_at: now,
            result: ok ? (body.result ?? null) : null,
            error_message: ok ? null : String(body.errorMessage ?? "Dispense failed"),
          })
          .eq("id", commandId)
          .eq("vending_device_id", device.id)
          .eq("status", "running");

        if (error) throw new Error(error.message);

        return new Response(
          JSON.stringify({ err: 0, msg: "OK", data: { commandId, ok } }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "fulfillStaffOrder": {
        if (device.kiosk_access_mode !== "staff_pin") {
          return new Response(
            JSON.stringify({
              err: 403,
              msg: "This kiosk is not in staff PIN mode — change it in Tavari Vending → Devices.",
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const staffUserId = String(body.staffUserId ?? "").trim();
        const staffName = String(body.staffName ?? "").trim() || "Staff";
        const items = Array.isArray(body.items) ? body.items : [];
        const dispenseResults = Array.isArray(body.dispenseResults) ? body.dispenseResults : null;
        const batchOrderNo = String(body.batchOrderNo ?? "").trim() || `STAFF-${Date.now()}`;

        if (!staffUserId) {
          return new Response(JSON.stringify({ err: 400, msg: "staffUserId is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (!items.length && !dispenseResults?.length) {
          return new Response(JSON.stringify({ err: 400, msg: "items are required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        if (device.dispense_mode === "rs485" && !dispenseResults) {
          return new Response(
            JSON.stringify({
              err: 0,
              msg: "OK",
              data: {
                clientDispense: true,
                batchOrderNo,
                items,
              },
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const itemByGoodsId = new Map<string, {
          goodsId: string;
          goodsName: string;
          price: number;
          posInventoryId?: string | null;
        }>();
        for (const item of items) {
          const goodsId = String(item.goodsId ?? "").trim();
          if (!goodsId) continue;
          itemByGoodsId.set(goodsId, {
            goodsId,
            goodsName: String(item.goodsName ?? "Item"),
            price: Number(item.price ?? 0),
            posInventoryId: item.posInventoryId ?? null,
          });
        }

        const linesToLog: Array<{
          goodsId: string;
          goodsName: string;
          price: number;
          orderNo: string;
          posInventoryId?: string | null;
        }> = [];

        if (device.dispense_mode === "rs485" && dispenseResults) {
          for (const row of dispenseResults) {
            if (!row.ok) continue;
            const goodsId = String(row.goodsId ?? "").trim();
            const orderNo = String(row.orderNo ?? "").trim();
            if (!goodsId || !orderNo) continue;
            const meta = itemByGoodsId.get(goodsId);
            linesToLog.push({
              goodsId,
              goodsName: String(row.goodsName ?? meta?.goodsName ?? "Item"),
              price: Number(row.price ?? meta?.price ?? 0),
              orderNo,
              posInventoryId: meta?.posInventoryId ?? null,
            });
          }
        } else {
          const credentials = await getVendingCredentials();
          const cloudResults: Array<{
            goodsId: string;
            orderNo: string;
            ok: boolean;
            msg?: string;
          }> = [];

          for (const item of items) {
            const goodsId = String(item.goodsId ?? "").trim();
            const qty = Math.max(1, Math.min(20, Number(item.quantity) || 1));
            if (!goodsId) continue;

            for (let q = 0; q < qty; q += 1) {
              const orderNo = `${batchOrderNo}-${goodsId}-${q}`;
              const result = await makeVendingAPIRequest(
                "/order_build",
                "GET",
                {
                  device_id: externalDeviceId,
                  goods_id: goodsId,
                  order_no: orderNo,
                },
                credentials,
              );
              const ok = typeof result.err === "number" ? result.err === 0 : false;
              cloudResults.push({
                goodsId,
                orderNo,
                ok,
                msg: String(result.msg ?? ""),
              });
              if (ok) {
                linesToLog.push({
                  goodsId,
                  goodsName: String(item.goodsName ?? "Item"),
                  price: Number(item.price ?? 0),
                  orderNo,
                  posInventoryId: item.posInventoryId ?? null,
                });
              }
            }
          }

          const anyOk = cloudResults.some((r) => r.ok);
          if (!anyOk) {
            throw new Error(
              cloudResults[0]?.msg || "Could not dispense any items — try again or contact a manager",
            );
          }

          await insertStaffDispenseRows(supabase, device, staffUserId, staffName, linesToLog);

          return new Response(
            JSON.stringify({
              err: 0,
              msg: "OK",
              data: {
                batchOrderNo,
                dispenseResults: cloudResults,
                partial: cloudResults.some((r) => !r.ok),
                loggedCount: linesToLog.length,
              },
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        if (!linesToLog.length) {
          throw new Error("Nothing dispensed — no items were logged");
        }

        await insertStaffDispenseRows(supabase, device, staffUserId, staffName, linesToLog);

        const partial = dispenseResults!.some((r) => !r.ok) && dispenseResults!.some((r) => r.ok);

        return new Response(
          JSON.stringify({
            err: 0,
            msg: "OK",
            data: {
              batchOrderNo,
              dispenseResults,
              partial,
              loggedCount: linesToLog.length,
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "recordLocalDispense": {
        const goodsId = String(body.goodsId ?? "").trim();
        const orderNo = String(body.orderNo ?? "").trim() || `RS485-${Date.now()}`;
        if (!goodsId) {
          return new Response(JSON.stringify({ err: 400, msg: "goodsId is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: slotRows } = await supabase
          .from("vending_device_slots")
          .select("id, num")
          .eq("vending_device_id", device.id)
          .eq("manufacturer_goods_id", goodsId)
          .gt("num", 0)
          .limit(1);

        if (slotRows?.[0]) {
          const nextNum = Math.max(0, Number(slotRows[0].num) - 1);
          await supabase
            .from("vending_device_slots")
            .update({ num: nextNum, updated_at: new Date().toISOString() })
            .eq("id", slotRows[0].id);
        }

        await supabase.from("vending_processed_orders").upsert(
          {
            business_id: businessId,
            external_order_no: orderNo,
          },
          { onConflict: "business_id,external_order_no", ignoreDuplicates: true },
        );

        return new Response(
          JSON.stringify({ err: 0, msg: "OK", data: { orderNo, goodsId } }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }
  } catch (error) {
    console.error("Vending Kiosk API Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
